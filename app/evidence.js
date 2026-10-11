/* =========================================================================
 * evidence.js —— 参数依据登记表
 * =========================================================================
 * 为什么存在：核查文献时发现我给的三条参数是错的（组数方向错、七折无依据、
 * "多喝水"是反例），但用户打开应用看到的是数字，不知道它换过、也不知道依据。
 *
 * 这一层把每个参数的真实来源写进产品里，分三级：
 *   A 有循证支持 —— 给 PMID/DOI，用户能自己去 PubMed 复核
 *   B 常规做法   —— 业内普遍这么用，但没有单一权威文献背书
 *   C 我的推断   —— 没有依据，坦白写出来，让人自己判断
 *
 * 目的不是显得严谨，是让人知道**哪些数字可以信，哪些要自己判断**。
 * ======================================================================== */

(function (global) {
  'use strict';

  const LEVELS = {
    A: { key: 'A', label: '有循证支持', cls: 'ok', desc: '来自系统综述或 meta 分析，可自行复核' },
    B: { key: 'B', label: '常规做法', cls: 'warn', desc: '业内普遍这么用，但没有单一权威文献背书' },
    C: { key: 'C', label: '我的推断', cls: 'danger', desc: '没有依据，坦白标注，请自行判断' }
  };

  const ITEMS = [
    {
      param: '高位下拉 ≤ 5kg，必须双手对称',
      level: 'A',
      why: '来自你的个人伤史：曾因单臂高位下拉 20kg 导致左斜方肌严重代偿酸痛。',
      source: '个体化约束（你的经历），非通用文献',
      note: '这一条不属于"通用建议"，它是专门为你定的。任何阶段都不上调。'
    },
    {
      param: '禁用自由重量 / 单臂拉推 / 肩峰撞击类动作',
      level: 'A',
      why: '肩峰撞击是明确的解剖结构问题；新手无法自主纠正动作偏差；固定器械负荷可控。',
      source: '解剖学共识 + 风险管理原则',
      note: '规避一个已知不必要且不可控的风险，不需要 RCT 证明。'
    },
    {
      param: '每组 3 组（适应期也是 3 组）',
      level: 'A',
      why: '高强度多组（multiset）在力量和肌肥大两项中都是最优变量。',
      source: 'Currier et al. 2023, Br J Sports Med. PMID 37414459. DOI 10.1136/bjsports-2023-106807',
      note: '我最初给新手只排 2 组，方向是错的，已纠正。降低难度靠"离力竭远"，不靠减组数。'
    },
    {
      param: '每周 2–3 次，同肌群间隔',
      level: 'A',
      why: '总训练量相同时，每周 2 次与 3 次对肌肥大无显著差异，可按个人偏好选择。',
      source: 'Schoenfeld et al. 2019, J Sports Sci. PMID 30558493. DOI 10.1080/02640414.2018.1555906',
      note: '所以"每周练几次"这个问题没有唯一答案，选你能坚持的。'
    },
    {
      param: '抽筋 → 立刻停 + 缓慢静态拉伸',
      level: 'A',
      why: '循证综述确认急性期处理方式为缓慢静态拉伸至症状缓解。',
      source: 'Miller et al. 2022, J Athl Train. PMID 34185846. DOI 10.4085/1062-6050-0696.20',
      note: '同一篇文献把"多喝水"列为无效的泛化建议，我原来的说法已删除。'
    },
    {
      param: '热身以动态动作为主',
      level: 'A',
      why: '动态热身提升力量/功率表现；静态拉伸热身对表现无影响，且未找到其预防损伤的证据。',
      source: 'McCrary et al. 2015, Br J Sports Med. PMID 25694615. DOI 10.1136/bjsports-2014-094228',
      note: '静态拉伸我保留了，但标注"为了活动度，不是防伤"。'
    },
    {
      param: '起始重量 = 器械上限的一半',
      level: 'B',
      why: '业内常见的起始重量做法。文献支持"给最优剂量"，但没规定从上限的百分之几开始。',
      source: '无单一权威文献；做法本身是通用的',
      note: '我最初写的是"适应期打七折"，核查时检索 Count=0 —— 连低强度证据都没有，已删除。'
    },
    {
      param: 'RPE 提示（"还能再做 3 次"）',
      level: 'C',
      why: 'RPE 是常用的强度主观量表，但上述 meta 分析没有把 RPE 作为评估变量。',
      source: '我的判断',
      note: '这条只作参考。你自己的"感觉刚好"比任何量表都准。'
    },
    {
      param: '「连续 2 次无代偿才加 10–15%」',
      level: 'C',
      why: '渐进超负荷的思路合理，但"2 次"和"10–15%"这两个具体数字没有直接文献支持。',
      source: '我的判断',
      note: '这是渐进超负荷的常见实操做法，但具体参数是我定的。可以自己改。'
    },
    {
      param: '8 周三阶段划分',
      level: 'C',
      why: '文献里没有"8 周分三阶段"这个说法。这是我为了让新手有路径感设计的。',
      source: '我的设计',
      note: '阶段本身不代表科学，只代表一个进度提示。'
    },
    {
      param: '背部优先选"肩胛引体上拉"',
      level: 'B',
      why: '针对你的左高右低与上斜方肌代偿，优先练肩胛下沉而非耸肩，属于体态训练的常规思路。',
      source: '临床/康复领域常规做法，无单一文献',
      note: '逻辑成立，但"它对你有效"这件事，任何文献都无法验证——只能靠你的感受。'
    }
  ];

  /** 按等级分组，方便界面渲染 */
  function grouped() {
    const g = { A: [], B: [], C: [] };
    ITEMS.forEach(i => (g[i.level] || (g[i.level] = [])).push(i));
    return g;
  }

  /** 有多少条是 C 级（需要用户自己判断的） */
  function weakCount() {
    return ITEMS.filter(i => i.level === 'C').length;
  }

  function renderInto(box) {
    const g = grouped();
    ['A', 'B', 'C'].forEach(k => {
      const items = g[k] || [];
      if (!items.length) return;
      const card = document.createElement('div');
      card.className = 'card ' + (LEVELS[k].cls);

      const h = document.createElement('h3');
      h.textContent = `${LEVELS[k].label}（${items.length} 条）`;
      card.appendChild(h);

      const d = document.createElement('div');
      d.className = 'hint';
      d.textContent = LEVELS[k].desc;
      d.style.marginBottom = '8px';
      card.appendChild(d);

      items.forEach(i => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:10px 0;border-top:1px solid var(--border)';

        const p = document.createElement('div');
        p.style.cssText = 'font-weight:650;font-size:14px;margin-bottom:4px';
        p.textContent = i.param;
        row.appendChild(p);

        const w = document.createElement('div');
        w.className = 'hint';
        w.style.color = 'var(--text)';
        w.textContent = i.why;
        row.appendChild(w);

        const s = document.createElement('div');
        s.className = 'hint';
        s.style.marginTop = '4px';
        s.innerHTML = '出处：' + escapeHtml(i.source);
        row.appendChild(s);

        if (i.note) {
          const n = document.createElement('div');
          n.className = 'hint';
          n.style.color = LEVELS[k].cls === 'ok' ? 'var(--ok)'
            : LEVELS[k].cls === 'warn' ? 'var(--warn)' : 'var(--danger)';
          n.style.marginTop = '4px';
          n.textContent = '※ ' + i.note;
          row.appendChild(n);
        }
        card.appendChild(row);
      });
      box.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  global.Evidence = { LEVELS, ITEMS, grouped, weakCount, renderInto };

})(typeof window !== 'undefined' ? window : globalThis);