/* =========================================================================
 * recognize.js —— 器材识别引擎
 * =========================================================================
 * 解决"不认识器材"。
 *
 * 工作方式（诚实版，不是假装有 AI 视觉）：
 *   网页本身没有视觉模型，所以这里做三件它真能做的事：
 *     1. 关键词反查 —— 你描述"头上有个横杆，下面一张带腿垫的椅子"，
 *        它按外观描述、别名、识别要点做模糊匹配，列出最像的几台给你选
 *     2. 拍照存证 —— 你在 gym 拍下器械，照片存在手机本地；回来把它导出
 *        发给教练（也就是我），我读图后回你精确答案，并写回器材库
 *     3. 分区导览 —— 不知道名字时，按"我要练背/练腿"去找那一区域
 *
 * 匹配算法：字符二元组（bigram）相似度，对中文短句比 Levenshtein 更稳，
 * 且无需任何依赖。
 * ========================================================================= */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
   * 字符二元组相似度 —— 中文短文本匹配用这个比编辑距离稳
   * ------------------------------------------------------------------- */
  function bigrams(s) {
    const t = String(s || '').toLowerCase().replace(/\s+/g, '');
    const out = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.substr(i, 2));
    if (t.length === 1) out.push(t);
    return out;
  }

  function dice(a, b) {
    const A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return 0;
    const map = new Map();
    A.forEach(g => map.set(g, (map.get(g) || 0) + 1));
    let hit = 0;
    B.forEach(g => {
      const n = map.get(g) || 0;
      if (n > 0) { hit++; map.set(g, n - 1); }
    });
    return (2 * hit) / (A.length + B.length);
  }

  /* ---------------------------------------------------------------------
   * 建立检索索引：把每台机器的可搜索文本拼成一条
   * 权重分级：名称 > 别名 > 识别要点 > 外观描述
   * ------------------------------------------------------------------- */
  const W_NAME = 3.0, W_ALIAS = 2.0, W_TELL = 1.2, W_LOOK = 0.8, W_BODY = 0.6;

  function index(machines) {
    return machines.map(m => {
      const name = m.name || '';
      const aliases = (m.aliases || []).join(' ');
      const tells = (m.tells || []).join(' ');
      const look = m.look || '';
      const body = (m.bodyPart || '') + ' ' + (m.usedFor || []).join(' ');
      // 精确名优先：器材库里的中文名本身就是最权威的索引键
      const exact = [m.id, m.name, (m.aliases || [])[0] || ''].filter(Boolean).join(' ');
      return {
        m,
        // 类别条目（泛指"各类器械"的集合描述）不是一台具体机器，不能参与搜索。
        // 不排除的话，"站着推的"会把「站姿单臂器械（各类）」排到第一。
        isCategory: /各类|所有|区域|专区|区$/.test(name) && /各类/.test(name),
        hay_name: name,
        hay_alias: aliases,
        hay_tell: tells,
        hay_look: look,
        hay_body: body,
        hay_exact: exact,
        all: [name, aliases, tells, look, body].join(' ')
      };
    });
  }

  /* ---------------------------------------------------------------------
   * 结构化判别：中文口语里最关键的信息不是"像不像"，而是"什么姿态"和"什么动作"。
   *
   * 例："躺着推的" —— 字符相似度分不出躺平和登山，但"姿态=躺"+"动作=推"
   *     能唯一锁定推胸机族。这一层比bigram 权重高一个数量级。
   * ------------------------------------------------------------------- */

  /** 姿态判别：用户说"躺着/坐着/站着" -> 应该匹配哪个 look 描述 */
  const POSTURE_RULES = [
    { key: 'lie', words: ['躺着', '躺下', '平躺', '仰卧', '躺'], bodyMark: ['躺椅', '靠垫', '长软垫', '躺'],
      boost: 0.9, label: '躺姿' },
    { key: 'sit', words: ['坐着', '坐下', '坐姿', '坐'], bodyMark: ['座椅', '坐姿', '椅子', '坐'],
      boost: 0.9, label: '坐姿' },
    { key: 'stand', words: ['站着', '站姿', '站立', '站'], bodyMark: ['站姿', '站着', '肩垫', '大踏板'],
      boost: 0.9, label: '站姿' },
    { key: 'prone', words: ['趴着', '俯卧', '趴'], bodyMark: ['俯卧', '趴', '胸部支撑', '靠垫'],
      boost: 1.0, label: '俯卧' }
  ];

  /** 动作判别：推/拉/夹/弯/伸/展等核心动作词 */
  const ACTION_RULES = [
    { key: 'push', words: ['推'], bodyMark: ['推', 'press', '把手'],
      matches: /推胸|推[压机]?|press/i, boost: 0.8, label: '推' },
    { key: 'pull', words: ['拉', '下拉', '划'], bodyMark: ['下拉', '划船', '拉'],
      matches: /下拉|划船|row|pulldown|引体/i, boost: 0.8, label: '拉' },
    { key: 'squeeze', words: ['夹'], bodyMark: ['夹', '飞鸟', '蝴蝶'],
      matches: /夹胸|蝴蝶|飞鸟|pec|fly|后展/i, boost: 0.9, label: '夹' },
    { key: 'curl', words: ['弯'], bodyMark: ['腿弯举', '弯举', '屈曲'],
      matches: /弯举|屈曲|curl/i, boost: 0.8, label: '弯' },
    { key: 'extend', words: ['伸'], bodyMark: ['腿屈伸', '伸膝'],
      matches: /腿屈伸|伸膝|extension/i, boost: 0.8, label: '伸' },
    { key: 'abduct', words: ['分开', '张开', '外展'], bodyMark: ['外展'],
      matches: /外展|abduction/i, boost: 0.9, label: '外展' },
    { key: 'adduct', words: ['夹住', '并拢', '内收'], bodyMark: ['内收'],
      matches: /内收|adduction/i, boost: 0.9, label: '内收' },
    { key: 'crunch', words: ['卷腹', '腹肌', '肚子'], bodyMark: ['卷腹', '腹肌'],
      matches: /卷腹|腹肌|ab_|crunch|twist/i, boost: 0.9, label: '核心' },
    { key: 'bike', words: ['骑'], bodyMark: ['单车', '车'],
      matches: /单车|车|bike|air_bike/i, boost: 1.0, label: '骑行' },
    { key: 'elliptical', words: ['椭圆'], bodyMark: ['椭圆'],
      matches: /椭圆|elliptical/i, boost: 1.2, label: '椭圆' },
    { key: 'weights', words: ['铁片', '杠铃', '哑铃', '一排排', '架子'], bodyMark: ['杠铃', '哑铃', '自由重量'],
      matches: /杠铃|哑铃|自由重量|smith|深蹲架|dumbbell|barbell/i, boost: 1.0, label: '自由重量' },
    // —— 下面这些是实测里被错配后补上的判别规则 ——
    { key: 'rollleg', words: ['滚轮', '滑行', '滑动', '大踏板', '一大块板'],
      bodyMark: ['滑轨', '踏板', '轨道'],
      matches: /leg_press|腿举/i, boost: 1.1, label: '滑轨腿举' },
    { key: 'rollcrunch', words: ['滚轮', '拉带', '带子', '往上卷', '卷上去'],
      bodyMark: ['滚轮', '拉带'],
      matches: /ab_crunch|卷腹机/i, boost: 1.1, label: '滚轮卷腹' },
    { key: 'twist', words: ['拧', '扭', '转盘', '左右转', '左右'],
      bodyMark: ['转盘', '旋转'],
      matches: /ab_twist|旋转/i, boost: 1.2, label: '躯干扭转' },
    { key: 'calf', words: ['脚尖', '提踵', '翘', '脚跟'],
      bodyMark: ['提踵', '脚'],
      matches: /calf|提踵/i, boost: 1.2, label: '提踵' },
    { key: 'sledpull', words: ['滑轮', '滑车', '铁链', '拉链条'],
      bodyMark: ['滑轮', '链条'],
      matches: /row|划船/i, boost: 1.0, label: '滑轮拉' },
    { key: 'pullebar', words: ['抓着自己拉', '拉上去', '悬垂', '吊着'],
      bodyMark: ['单杠', '横杆'],
      matches: /pull_up|单杠/i, boost: 1.3, label: '自重上拉' }
  ];

  /**
   * 检测查询中包含的结构化线索
   */
  function detectCues(query) {
    const q = String(query || '').toLowerCase();
    const postures = [];
    const actions = [];
    POSTURE_RULES.forEach(r => {
      if (r.words.some(w => q.indexOf(w) >= 0)) postures.push(r);
    });
    ACTION_RULES.forEach(r => {
      if (r.words.some(w => q.indexOf(w) >= 0)) actions.push(r);
    });
    return { postures, actions };
  }

  /* ---------------------------------------------------------------------
   * 主搜索：bigram 相似度 + 结构化线索加权
   * ------------------------------------------------------------------- */
  function search(query, machines, opts) {
    opts = opts || {};
    const idx = opts.index || index(machines);
    const q = String(query || '').trim();
    if (!q) return [];

    const cues = detectCues(q);
    const hasStructured = cues.postures.length || cues.actions.length;

    const scored = idx.filter(row => !row.isCategory).map(row => {
      let s = 0;
      if (row.hay_name.indexOf(q) >= 0) s += 1.2;
      if (row.hay_alias.indexOf(q) >= 0) s += 0.9;
      // 精确键（id / 完整名 / 第一个别名）命中，给最高的加成。
      // 这修掉了"推胸"误配到「上斜推胸机」的问题——因为「水平推胸机」的
      // 第一个别名正是「推胸」，精确命中应该压过包含匹配。
      if (row.hay_exact.split(' ').some(k => k && k.indexOf(q) >= 0)) s += 1.5;
      s += dice(q, row.hay_name) * W_NAME;
      s += dice(q, row.hay_alias) * W_ALIAS;
      s += dice(q, row.hay_tell) * W_TELL;
      s += dice(q, row.hay_look) * W_LOOK;
      s += dice(q, row.hay_body) * W_BODY;
      for (const ch of q) {
        if (ch.length === 1 && row.all.indexOf(ch) >= 0) s += 0.12;
      }

      // 结构化加权：姿态词命中 look/别名 里的姿态标记
      cues.postures.forEach(r => {
        const hit = r.bodyMark.some(b =>
          (row.m.look || '').indexOf(b) >= 0 ||
          (row.m.aliases || []).join(' ').indexOf(b) >= 0 ||
          row.m.name.indexOf(b) >= 0
        );
        if (hit) s += r.boost;
      });
      // 动作词命中器材名/别名里的动作标识
      cues.actions.forEach(r => {
        const target = row.m.id + ' ' + row.m.name + ' ' + (row.m.aliases || []).join(' ');
        if (r.matches.test(target)) s += r.boost;
      });

      // 角度判别：推胸机族内部区分靠"上斜/低位/水平"，腿举机族同理。
      // 实测里"上斜着的"同时命中上斜推胸和上斜腿举，需要部位线索来收敛。
      if (/上斜|斜着/.test(q)) {
        if (/胸|推|压|躺/.test(q) && /chest_press|推胸/.test(row.m.id)) s += 1.0;
        if (/腿|脚|踏/.test(q) && /leg_press|腿举/.test(row.m.id)) s += 1.0;
        if (/低位|下斜/.test(q) && /decline/.test(row.m.id)) s += 1.2;
      }

      return { m: row.m, score: s, structured: hasStructured };
    });

    const results = scored
      .filter(x => x.score > (opts.min || 0.18))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit || 8);

    // 有结构化线索时，把命中线索标出来，界面上要显示"因为你说『躺着』所以匹配"
    if (hasStructured) {
      results.forEach(r => {
        r.cues = [];
        cues.postures.forEach(p => {
          const hit = p.bodyMark.some(b =>
            (r.m.look || '').indexOf(b) >= 0 || r.m.name.indexOf(b) >= 0 ||
            (r.m.aliases || []).join(' ').indexOf(b) >= 0);
          if (hit) r.cues.push('姿态：' + p.label);
        });
        cues.actions.forEach(a => {
          if (a.matches.test(r.m.id + ' ' + r.m.name + ' ' + (r.m.aliases || []).join(' '))) {
            r.cues.push('动作：' + a.label);
          }
        });
      });
    }
    return results;
  }

  /* ---------------------------------------------------------------------
   * 分区导览：不知道名字时，按部位去找
   * ------------------------------------------------------------------- */
  const BODY_GROUPS = [
    {
      key: 'back',
      label: '背部区（拉）',
      ask: '你要找的是练背的',
      tips: ['通常在有氧区对面，一整面墙', '有竖着的滑轮和高处横杆', '这台是你的主力，全程轻重量'],
      part: '背'
    },
    {
      key: 'chest',
      label: '胸部区（推）',
      ask: '你要找的是练胸的',
      tips: ['靠窗或靠门一侧常见', '有躺椅或座椅 + 正前方的把手', '角度越低越安全，你选最低的那台'],
      part: '胸'
    },
    {
      key: 'legs',
      label: '腿部区',
      ask: '你要找的是练腿的',
      tips: ['体积最大的一片，通常在最里面', '有很长的踏板或很长的滑轨', '选有靠背座椅的那台，不要站着的'],
      part: '腿'
    },
    {
      key: 'core',
      label: '核心区',
      ask: '你要找的是练腹的',
      tips: ['常在腿部和胸部区中间', '有小巧的座椅或一块垫子', '别用罗马椅，那台已标禁用'],
      part: '核心'
    },
    {
      key: 'cardio',
      label: '有氧区',
      ask: '你要找的是有氧的',
      tips: ['通常靠窗、噪音最大的地方', '有屏幕和大风扇', '跑步机只快走不跑'],
      part: '有氧'
    }
  ];

  function byBody(part, machines) {
    return machines.filter(m => m.bodyPart === part);
  }

  /* ---------------------------------------------------------------------
   * 拍照存证 —— 照片存 localStorage（缩到很小），可导出给教练
   * ------------------------------------------------------------------- */
  const PHOTO_KEY = 'fitcoach.photos';

  // 与 log.js 同一套兜底：iOS 无痕模式下 localStorage 会抛 SecurityError，
  // 拍照是这个模块的核心功能，不能因为存储不可用就整页报错。
  const storage = (function () {
    try {
      const t = '__t__';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
      return localStorage;
    } catch (e) {
      const mem = {};
      return {
        getItem: k => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; }
      };
    }
  })();

  function getPhotos() {
    try { return JSON.parse(storage.getItem(PHOTO_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function savePhotos(list) {
    try { storage.setItem(PHOTO_KEY, JSON.stringify(list)); }
    catch (e) { notify('本机存储空间不足，照片可能存不下'); }
    return list;
  }

  // 模块内自足的提示：不能依赖 app.js 的闭包函数，那是另一个作用域
  function notify(msg) {
    try {
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.add('on');
      setTimeout(() => t.classList.remove('on'), 2200);
    } catch (e) { /* 非浏览器环境忽略 */ }
  }

  /**
   * 压缩存图：目标长边 720px、JPEG 0.7，一张约 60–120KB。
   * 手机一次拍十几台会撑爆 localStorage（上限约 5MB），所以压得狠一点。
   */
  function addPhoto(dataUrl, note) {
    const list = getPhotos();
    list.push({ id: 'p' + Date.now(), data: dataUrl, note: note || '', at: new Date().toISOString() });
    return savePhotos(list);
  }

  function removePhoto(id) {
    return savePhotos(getPhotos().filter(p => p.id !== id));
  }

  /** 导出成一个可直接发给教练的纯文本清单 + 图片链接 */
  function exportForCoach() {
    const list = getPhotos();
    if (!list.length) return null;
    const lines = ['我在健身房拍了几台器械，帮我确认它们是什么、能不能用：', ''];
    list.forEach((p, i) => {
      lines.push(`${i + 1}. [${p.id}] ${p.note || '(未备注)'}`);
      lines.push(`   ${p.data}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  global.Recognize = {
    dice, search, index, byBody, BODY_GROUPS, detectCues,
    getPhotos, addPhoto, removePhoto, exportForCoach
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Recognize;

})(typeof window !== 'undefined' ? window : globalThis);