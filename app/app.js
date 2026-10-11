/* =========================================================================
 * app.js —— 界面逻辑
 * =========================================================================
 * 严格约束：界面只做「展示 + 收集输入」，不做任何安全判断。
 * 所有红线和排布都由 plan.js / safety.js 决定，这里只负责把它们显示出来。
 * 如果你在界面上想加一个动作，引擎不允许 —— 这是有意的。
 * ========================================================================= */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const STATUS_CLS = { ok: 'ok', caution: 'warn', banned: 'danger' };
  const STATUS_TXT = { ok: '推荐可用', caution: '能用但注意', banned: '别用这台' };

  let KIT_INDEX = null;
  let curPage = 'kit';
  const st0 = () => Log.load();

  /* ====================================================================
   * 启动
   * ==================================================================== */
  function boot() {
    window.__fitcoachBooted = true;
    const bf = document.getElementById('bootFail');
    if (bf) bf.hidden = true;

    // 归一化 + 打红线标记，顺序不能反
    IdAlias.normalizeExercises(EXERCISES);
    EXERCISES.forEach(e => Safety.markSafety(e));
    KIT_INDEX = Recognize.index(MACHINES);

    // 开发期自检：发现红线漏洞直接在界面上报，不静默
    const audit = IdAlias.auditMachines(MACHINES, EXERCISES);
    if (!audit.ok) {
      console.error('[红线自检] 动作引用了不存在的器材：', audit.missing);
    }

    bindTabs();
    bindSearch();
    bindReact();
    bindDataBtns();
    renderKitAll();
    renderTour();
    renderTodayTour();
    renderShots();
    renderGoal();
    renderPlan();
    renderLog();
    renderAssess();

    // Service Worker：离线可用。file:// 下会失败，属预期，静默即可。
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // 恢复上次反馈的显示
    if (st0().lastSignal) showReaction(st0().lastSignal);

    const st = Log.load();
    $('#hdrSub').textContent = st.goal
      ? `目标：${st.goal.short} · 第 ${st.week} 周 · ${Goal.PHASES[st.phaseIndex].name}`
      : '还没定目标 · 先做一次 1 分钟的引导';
  }

  /* ====================================================================
   * 导航
   * ==================================================================== */
  function bindTabs() {
    $$('#tabbar button').forEach(b => {
      b.addEventListener('click', () => go(b.dataset.page));
    });
  }

  function go(page) {
    curPage = page;
    $$('#tabbar button').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.page === page)));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    window.scrollTo(0, 0);

    const titles = {
      kit: ['器材图鉴', '认不出就描述，或直接拍照'],
      goal: ['我的目标', '做一次，8 周不改'],
      plan: ['今天的训练', '任务清单 · 做几项都行'],
      react: ['训练反馈', '如实说，尤其是不舒服的时候']
    };
    $('#hdrTitle').textContent = titles[page][0];
    $('#hdrSub').textContent = titles[page][1];

    if (page === 'plan') renderPlan();
    if (page === 'goal') renderGoal();
    if (page === 'kit') renderTodayTour();
    if (page === 'react') renderLog();
    if (page === 'react') renderAssess();
    if (page === 'react') renderEvidence();
  }

  /* ====================================================================
   * 器材：搜索
   * ==================================================================== */
  function bindSearch() {
    const inp = $('#kitSearch');
    let t = null;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => runSearch(inp.value), 180);
    });
  }

  function runSearch(q) {
    const box = $('#kitResults');
    if (!q || !q.trim()) { box.innerHTML = ''; return; }

    const hits = Recognize.search(q, MACHINES, { index: KIT_INDEX, limit: 6 });
    box.innerHTML = '';

    if (!hits.length) {
      box.appendChild(el('div', 'empty',
        '没匹配到。换个说法试试，比如「躺着推的」「两个腿分开的」。<br>或者直接拍照，回头发给我确认。'));
      return;
    }

    // 真实歧义时会有多台差不多像的，标题必须说清楚这是"候选"而不是"答案"
    box.appendChild(el('div', 'hint',
      hits.length > 1 ? `匹配到 ${hits.length} 台，最像的在下面。认错了就点下一台。` : '找到一台，看看对不对：'));

    hits.forEach((h, i) => box.appendChild(machineCard(h.m, {
      score: h.score, rank: i + 1, cues: h.cues
    })));
  }

  function machineCard(m, extra) {
    const cls = 'card mach ' + (STATUS_CLS[m.status] || '');
    const n = el('div', cls);

    const head = el('div', 'row');
    head.appendChild(el('div', 'nm', esc(m.name)));
    const right = el('div');
    right.style.textAlign = 'right';
    right.appendChild(el('span', 'badge ' + (STATUS_CLS[m.status] || 'plain'), STATUS_TXT[m.status] || m.status));
    if (extra && extra.rank) {
      const sc = el('div', 'score',
        '候选 ' + extra.rank + ' · 匹配 ' + (extra.score || 0).toFixed(2));
      sc.style.marginTop = '4px';
      right.appendChild(sc);
    }
    head.appendChild(right);
    n.appendChild(head);

    if (extra && extra.cues && extra.cues.length) {
      n.appendChild(el('div', 'hint', '因为你说「' + extra.cues.map(c => c.split('：')[1]).join('、') + '」'));
    }

    n.appendChild(el('div', 'look', '<b>长什么样：</b>' + esc(m.look)));

    if (m.tells && m.tells.length) {
      const ul = el('ul');
      m.tells.forEach(t => ul.appendChild(el('li', null, esc(t))));
      const w = el('div');
      w.appendChild(el('div', 'hint', '认它的三个要点：'));
      w.appendChild(ul);
      n.appendChild(w);
    }

    const note = el('div', 'mt');
    const cls2 = m.status === 'banned' ? 'stop' : (m.status === 'caution' ? 'card warn' : 'card ok');
    note.appendChild(el('div', cls2,
      m.status === 'banned'
        ? '<span class="lb">别用这台</span>' + esc(m.statusNote)
        : (m.status === 'ok' ? '<b>能用。</b>' : '<b>能用但注意。</b>') + esc(m.statusNote)));
    note.firstChild.style.marginTop = '0';
    n.appendChild(note);

    if (m.adjust && m.adjust.length) {
      const d = el('details', 'more');
      d.appendChild(el('summary', null, '怎么调这台机器'));
      const inner = el('div', 'inner');
      const ul = el('ul');
      m.adjust.forEach(a => ul.appendChild(el('li', null, esc(a))));
      inner.appendChild(ul);
      d.appendChild(inner);
      n.appendChild(d);
    }

    if (m.lookalike && m.lookalike.length) {
      n.appendChild(el('div', 'hint mt', '容易和它搞混：' + m.lookalike.map(esc).join('、')));
    }
    return n;
  }

  function renderKitAll() {
    const box = $('#kitAll');
    const order = { ok: 0, caution: 1, banned: 2 };
    const list = MACHINES.slice().sort((a, b) => order[a.status] - order[b.status]);
    list.forEach(m => box.appendChild(machineCard(m)));
  }

  function renderTour() {
    const box = $('#tourList');
    box.innerHTML = '';
    Recognize.BODY_GROUPS.forEach(g => {
      const n = el('div', 'card accent');
      n.appendChild(el('h3', null, esc(g.label)));
      n.appendChild(el('div', 'hint', esc(g.ask)));
      const ul = el('ul');
      g.tips.forEach(t => ul.appendChild(el('li', null, esc(t))));
      n.appendChild(ul);
      const names = Recognize.byBody(g.part, MACHINES)
        .filter(m => m.status !== 'banned')
        .map(m => m.name).join('、');
      n.appendChild(el('div', 'hint mt', '这一带通常有：' + esc(names)));
      box.appendChild(n);
    });
  }

  /* ====================================================================
   * 器材：今天练什么 -> 去哪台机器
   * 参考 Keep 的「健身房入门」标签：新手进健身房的第一障碍是"不知道该去哪台机器"。
   * 这里把「今天计划里要练的部位」直接映射到该区域的白名单器械，一键展开。
   * ==================================================================== */
  function renderTodayTour() {
    const box = $('#todayTour');
    if (!box) return;
    box.innerHTML = '';
    const st = Log.load();
    if (!st.goal) {
      box.appendChild(el('div', 'hint', '先定目标，这里会直接告诉你今天该去哪台机器。'));
      return;
    }
    const ph = Goal.PHASES[st.phaseIndex];
    const w = Plan.buildWeek(st.goal, ph.id, st);

    // 收集今天每一课要用到的部位
    const partOrder = [];
    w.days.forEach(d => {
      d.tasks.forEach(t => {
        const p = Plan.partOf(t.ex);
        if (p && partOrder.indexOf(p) < 0) partOrder.push(p);
      });
    });

    if (!partOrder.length) {
      box.appendChild(el('div', 'hint', '今天的计划里没有可映射的部位。'));
      return;
    }

    box.appendChild(el('div', 'hint', '按本周计划要练的部位，找出你要用的机器：'));

    partOrder.forEach(part => {
      const card = el('div', 'card ok');
      card.appendChild(el('h3', null,
        `${Plan.PART_LABEL[part] || part}`));

      // 该部位本周实际会被用到的机器（从计划里取，比分区导览更准）
      const usedIds = [];
      w.days.forEach(d => d.tasks.forEach(t => {
        if (Plan.partOf(t.ex) === part && usedIds.indexOf(t.machineId) < 0) {
          usedIds.push(t.machineId);
        }
      }));

      const ul = el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px';
      usedIds.forEach(id => {
        const m = MACHINES.find(x => x.id === id);
        if (!m) return;
        const li = el('li');
        li.innerHTML = '<b>' + esc(m.name) + '</b>';
        li.style.marginBottom = '7px';
        const d = el('div', 'hint', esc(m.look));
        d.style.marginLeft = '-12px';
        li.appendChild(d);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      box.appendChild(card);
    });

    // 禁用提醒：把本周计划里绝对不会出现的雷区列出来
    const bannedHit = MACHINES.filter(m => m.status === 'banned');
    if (bannedHit.length) {
      const warn = el('div', 'card danger');
      warn.appendChild(el('h3', null, '这 ' + bannedHit.length + ' 台别碰'));
      const wul = el('ul');
      wul.style.cssText = 'margin:8px 0 0;padding-left:18px';
      bannedHit.forEach(m => {
        const li = el('li');
        li.innerHTML = '<b>' + esc(m.name) + '</b>';
        li.style.marginBottom = '5px';
        li.appendChild(el('div', 'hint', esc(m.dangerNote)));
        wul.appendChild(li);
      });
      warn.appendChild(wul);
      box.appendChild(warn);
    }
  }

  /* ====================================================================
   * 器材：拍照存证
   * ==================================================================== */
  function bindDataBtns() {
    $('#camInput').addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      files.forEach(shrinkThenAdd);
      e.target.value = '';
    });
  }

  function shrinkThenAdd(file) {
    const r = new FileReader();
    r.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 720;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          const s = MAX / Math.max(w, h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        Recognize.addPhoto(c.toDataURL('image/jpeg', 0.7), '');
        renderShots();
        toast('已存到本机');
      };
      img.onerror = () => toast('这张图读不出来，换一张');
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  }

  function renderShots() {
    const box = $('#shotList');
    const acts = $('#shotActions');
    box.innerHTML = ''; acts.innerHTML = '';
    const list = Recognize.getPhotos();
    if (!list.length) {
      box.appendChild(el('div', 'hint', '还没有照片。'));
      return;
    }
    list.forEach(p => {
      const s = el('div', 'shot');
      const im = el('img');
      im.src = p.data;
      im.alt = p.note || '器械照片';
      s.appendChild(im);
      const b = el('button', 'del', '×');
      b.setAttribute('aria-label', '删除这张');
      b.addEventListener('click', () => { Recognize.removePhoto(p.id); renderShots(); });
      s.appendChild(b);
      box.appendChild(s);
    });
    acts.appendChild(el('button', 'btn primary', '复制清单并发给教练'));
    acts.lastChild.addEventListener('click', () => {
      const txt = Recognize.exportForCoach();
      if (!txt) return toast('还没有照片');
      navigator.clipboard.writeText(txt).then(
        () => toast('已复制，去聊天窗口粘贴给教练'),
        () => { $('#exportOut') && ($('#exportOut').textContent = txt); toast('复制失败，文本已显示在下面'); }
      );
    });
  }

  /* ====================================================================
   * 目标引导
   * ==================================================================== */
  function renderGoal() {
    const st = Log.load();
    const wiz = $('#goalWizard');
    const res = $('#goalResult');
    wiz.innerHTML = ''; res.innerHTML = '';
    res.hidden = false;

    if (!st.goal) { buildWizard(); return; }

    const g = st.goal;
    const ph = Goal.PHASES[st.phaseIndex];

    const c = el('div', 'card accent');
    c.appendChild(el('h3', null, '你的 8 周目标'));
    c.appendChild(el('div', 'lead', esc(g.statement)));
    c.appendChild(el('p', 'mt', '<b>为什么是它：</b>' + esc(g.why)));
    c.appendChild(el('p', null, '<b>及格线：</b>' + esc(g.minPass)));
    c.appendChild(el('p', 'mb0', '<b>注意：</b>' + esc(g.caution)));
    res.appendChild(c);

    const phc = el('div', 'card ok');
    phc.appendChild(el('h3', null, `第 ${st.week} 周 · ${ph.name}`));
    const lvl = el('div', 'badge accent', `${ph.level} · ${ph.levelLabel}`);
    lvl.style.marginBottom = '10px';
    phc.appendChild(lvl);
    phc.appendChild(el('div', 'lead', esc(ph.headline)));
    const ul = el('ul');
    ul.style.cssText = 'margin:10px 0 0;padding-left:18px;font-size:13px';
    ph.rules.forEach(r => {
      const li = el('li', null, esc(r));
      li.style.marginBottom = '6px';
      ul.appendChild(li);
    });
    phc.appendChild(ul);
    const ex = el('div', 'mt');
    ex.innerHTML = '<b>进入下一阶段的条件：</b>' + esc(ph.exitCondition);
    ex.style.fontSize = '13px';
    ex.style.color = 'var(--ok)';
    phc.appendChild(ex);
    res.appendChild(phc);

    const mc = el('div', 'card');
    mc.appendChild(el('h3', null, '怎么算做到了'));
    g.metrics.forEach(m => {
      const row = el('div', 'metric');
      row.appendChild(el('div', 'box'));
      const b = el('div', 'body');
      b.appendChild(el('div', null, esc(m.text)));
      b.appendChild(el('div', 'how', '怎么测：' + esc(m.how)));
      row.appendChild(b);
      mc.appendChild(row);
    });
    res.appendChild(mc);

    const fc = el('div', 'card warn');
    fc.appendChild(el('h3', null, '这几个目标我建议你别定'));
    const ful = el('ul');
    ful.style.cssText = 'margin:0;padding-left:18px;font-size:13px';
    g.forbidden.forEach(f => {
      const li = el('li');
      li.innerHTML = '<b>' + esc(f.goal) + '</b> —— ' + esc(f.why);
      li.style.marginBottom = '7px';
      ful.appendChild(li);
    });
    fc.appendChild(ful);
    res.appendChild(fc);

    const adv = el('button', 'btn primary',
      st.phaseIndex < 3 ? '我这阶段做到了，进入下一阶段' : '重新选一次目标');
    adv.addEventListener('click', () => {
      if (st.phaseIndex < 3) { Log.advancePhase(); toast('已进入 ' + Goal.PHASES[st.phaseIndex + 1] || '' + '下一阶段'); }
      else { Log.resetAll(); }
      boot();
    });
    res.appendChild(adv);
    res.appendChild(el('div', 'hint center mt', '阶段由你推进，不是日期自动推进。做不到就停在原地。'));
  }

  function buildWizard() {
    const wiz = $('#goalWizard');
    const ans = {};
    wiz.appendChild(el('h2', null, '1 · 你现在最想解决什么'));
    wiz.appendChild(el('p', 'lead', '不用想"目标"，选一个你现在最烦的情况就行。'));

    const mk = (items, key) => {
      const box = el('div', 'opts mt');
      items.forEach(it => {
        const b = el('button', 'opt');
        b.innerHTML = '<span class="t">' + esc(it.label) + '</span>' +
                      (it.short ? '<span class="d">' + esc(it.short) + '</span>' : '');
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          ans[key] = it.id != null ? it.id : it;
          box.querySelectorAll('.opt').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          after(key);
        });
        box.appendChild(b);
      });
      wiz.appendChild(box);
    };

    mk(Goal.PAINS.map(p => ({ label: p.label, short: p.short, id: p.id })), 'pain');
    wiz.appendChild(el('h2', null, '2 · 一周能练几次'));
    wiz.appendChild(el('p', 'lead', '按你能保证的次数选，不是按你想练几次。'));
    mk(Goal.FREQ.map(f => ({ label: f.label, short: f.note, id: f.days })), 'freq');
    wiz.appendChild(el('h2', null, '3 · 每次能待多久'));
    mk(Goal.SESSION.map(s => ({ label: s.label, short: s.note, id: s.id })), 'session');

    function after(key) {
      const next = { pain: 'freq', freq: 'session', session: null }[key];
      if (next) {
        const h = next === 'freq' ? '2 · 一周能练几次' : '3 · 每次能待多久';
        wiz.querySelectorAll('h2').forEach(x => { if (x.textContent === h) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      } else {
        const g = Goal.derive(ans);
        Log.setGoal(g);
        renderTodayTour();
        boot();
        go('plan');
        toast('目标定好了');
      }
    }
  }

  /* ====================================================================
   * 计划
   * ==================================================================== */
  function renderPlan() {
    const box = $('#planBody');
    box.innerHTML = '';
    const st = Log.load();

    if (!st.goal) {
      box.appendChild(el('div', 'empty',
        '还没有目标。先去「目标」页花 1 分钟定一个，计划会自动生成。'));
      const b = el('button', 'btn primary', '去定目标');
      b.addEventListener('click', () => go('goal'));
      box.appendChild(b);
      return;
    }

    const g = st.goal;
    const ph = Goal.PHASES[st.phaseIndex];
    const week = Plan.buildWeek(g, ph.id, st);

    // 顶部：本周排布
    const tl = el('div', 'card');
    // 标题把频率和时长写死进去，参考 Keep「7天运动3次挑战」的命名习惯：
    // 不用让人自己算，一眼就知道这一周要练几次、每次多久
    tl.appendChild(el('h3', null, `本周安排 · 每周 ${g.freq.days} 次 · 每次约 ${g.session.minutes} 分钟`));
    const kb = el('div', 'badge accent',
      `${ph.level} · ${ph.levelLabel}｜${ph.name}｜第 ${st.week} 周`);
    kb.style.marginBottom = '8px';
    tl.appendChild(kb);
    tl.appendChild(el('div', 'hint', '难度 K 值只标 K1–K3。出现 K4/K5 通常意味着该加重量了——你现在还不需要。'));
    tl.appendChild(el('div', 'hint', '每周练几次可以自己选。J Sports Sci 2019 的系统综述结论是：总训练量相同时，' +
      '每周 2 次和 3 次没有显著差异，按个人偏好定就行（PMID 30558493）。'));
    const row = el('div', 'tl');
    week.schedule.forEach(d => {
      const n = el('div', 'd' + (d.isTraining ? ' on' : ''));
      n.appendChild(el('span', 'n', d.name));
      n.appendChild(el('span', null, d.isTraining ? '训练' : '休息'));
      row.appendChild(n);
    });

    // 评估结论也要出现在计划页顶部 —— 那是每次训练必看的地方，
    // 只放在反馈页等于没有。
    const asr = Assess.evaluate(st);
    const adj = Assess.applyIntensity(asr, ph.id);
    if (asr.verdict === 'stop' || asr.verdict === 'retreat' || adj.changed) {
      const w = el('div', 'card ' + (asr.verdict === 'stop' ? 'danger' : 'warn'));
      w.style.marginTop = '10px';
      w.appendChild(el('h3', null, '⚠ ' + esc(asr.headline)));
      w.appendChild(el('p', 'mb0',
        asr.verdict === 'stop'
          ? '本课建议：立刻停止相关动作，不要加重量。详见「反馈」页。'
          : '本课建议：降低一档强度。原因和依据见「反馈」页的「我现在的状态」。'));
      tl.appendChild(w);
    } else if (asr.verdict === 'advance') {
      const w = el('div', 'card ok');
      w.style.marginTop = '10px';
      w.appendChild(el('h3', null, '✓ ' + esc(asr.headline)));
      w.appendChild(el('p', 'mb0', '可以在「反馈」页按建议推进阶段。'));
      tl.appendChild(w);
    }
    tl.appendChild(row);
    box.appendChild(tl);

    // 安全自检结果要显性展示，不藏在后台
    if (week.adjusted) {
      const an = el('div', 'card warn');
      an.appendChild(el('h3', null, '强度已按你的记录自动下调'));
      an.appendChild(el('div', 'mb0', esc(week.adjustNote || '')));
      an.appendChild(el('div', 'hint mt', '依据和是否恢复见「反馈」页。调整只降不升——自动加量风险更大。'));
      box.appendChild(an);
    }

    // 安全自检结果要显性展示，不藏在后台
    const chk = el('div', 'card ' + (week.safetyCheck.ok ? 'ok' : 'danger'));
    chk.appendChild(el('h3', null, week.safetyCheck.ok ? '✓ 安全自检通过' : '✗ 计划有问题，请勿执行'));
    chk.appendChild(el('p', 'mb0',
      `本次共 ${week.stats.totalTasks} 个任务，全部来自你的白名单器械。` +
      '禁用动作（自由重量、单臂、肩推类）已在生成阶段剔除，不出现在这里。'));
    if (!week.safetyCheck.ok) {
      const ul = el('ul');
      week.safetyCheck.violations.forEach(v => ul.appendChild(el('li', null, esc(v))));
      chk.appendChild(ul);
    }
    box.appendChild(chk);

    // 上次反馈如果需要处理，优先显示
    if (st.lastSignal) {
      const r = Plan.react(st.lastSignal);
      const rc = el('div', 'card react' + (r.stop ? '' : ' soft'));
      rc.appendChild(el('h3', null, '上次你的反馈：' + esc(r.label)));
      rc.appendChild(el('p', 'mb0', esc(r.headline)));
      box.appendChild(rc);
    }

    // 每次训练课
    week.days.forEach((d, di) => {
      const card = el('div', 'card accent');
      card.appendChild(el('h3', null, `第 ${di + 1} 练 · ${esc(d.name)}`));
      if (d.lightNote) {
        const w = el('div', 'card warn');
        w.appendChild(el('div', 'mb0', esc(d.lightNote)));
        w.style.marginTop = '0';
        card.appendChild(w);
      }

      // 热身
      const wu = el('details', 'more');
      wu.appendChild(el('summary', null, '热身（5–8 分钟，必做）'));
      const wi = el('div', 'inner');
      wi.appendChild(el('div', 'hint', '臀部激活是必选项，不是可选项。'));
      const wul = el('ul');
      wul.style.cssText = 'margin:6px 0 0;padding-left:18px';
      d.warmup.forEach(w => {
        const li = el('li');
        li.innerHTML = '<b>' + esc(w.name) + '</b> · ' + esc(w.dur) + (w.why ? '<br><span style="color:var(--text-faint)">' + esc(w.why) + '</span>' : '');
        li.style.marginBottom = '7px';
        wul.appendChild(li);
      });
      wi.appendChild(wul);
      wu.appendChild(wi);
      card.appendChild(wu);

      // 任务
      d.tasks.forEach(t => card.appendChild(taskCard(t, st)));

      // 收尾
      const cd = el('details', 'more');
      cd.appendChild(el('summary', null, '收尾拉伸（每个 30–45 秒）'));
      const ci = el('div', 'inner');
      const cul = el('ul');
      cul.style.cssText = 'margin:6px 0 0;padding-left:18px';
      d.cooldown.forEach(c => {
        const li = el('li');
        li.innerHTML = '<b>' + esc(c.name) + '</b> · ' + esc(c.dur) + (c.why ? ' <span style="color:var(--warn)">（' + esc(c.why) + '）</span>' : '');
        li.style.marginBottom = '5px';
        cul.appendChild(li);
      });
      ci.appendChild(cul);
      ci.appendChild(el('div', 'hint mt', '喝够水。练完 1 小时内吃点东西（香蕉、鸡蛋、牛奶之类）。'));
      cd.appendChild(ci);
      card.appendChild(cd);

      card.appendChild(el('div', 'hint center mt', esc(d.minPass)));
      box.appendChild(card);
    });

    // 训练日打勾 + 反馈
    const done = el('div', 'card');
    done.appendChild(el('h3', null, '练完勾一下，然后去反馈页'));
    week.days.forEach((d, di) => {
      const lab = el('label', 'check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        Log.logSession(d.key, d.tasks.filter(t => cb.checked).map(t => t.ex.id), 'ok');
        toast(cb.checked ? '记下了' : '已取消');
      });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, `第 ${di + 1} 练 · ${esc(d.name)}`));
      done.appendChild(lab);
    });
    box.appendChild(done);

    const fb = el('button', 'btn ghost', '反馈今天的感觉 →');
    fb.addEventListener('click', () => go('react'));
    box.appendChild(fb);
  }

  function taskCard(t, st) {
    const c = el('div', 'card task');
    c.appendChild(el('div', 'nm', esc(t.name)));

    const sp = el('div', 'specs');
    sp.appendChild(el('span', 'spec', t.timeBased ? t.weight : (t.weight + ' · ' + t.sets + ' 组 × ' + t.reps + ' 次')));
    if (!t.timeBased) sp.appendChild(el('span', 'spec', '组间休息 ' + t.rest + ' 秒'));
    sp.appendChild(el('span', 'spec', '上限 ' + t.hardCap + ' kg'));
    c.appendChild(sp);

    const mach = el('div', 'hint');
    mach.innerHTML = '<b>' + esc(t.machineName) + '</b> —— ' + esc(t.machineLook);
    c.appendChild(mach);

    if (t.hardCapNote) {
      const hc = el('div', 'hint');
      hc.style.color = 'var(--danger)';
      hc.textContent = '⚠ ' + t.hardCapNote;
      c.appendChild(hc);
    }

    const cues = el('ul', 'cues');
    (t.cues || []).forEach(q => cues.appendChild(el('li', null, esc(q))));
    c.appendChild(cues);

    const stop = el('div', 'stop');
    stop.appendChild(el('span', 'lb', '出现这些立刻停：'));
    const sul = el('ul');
    (t.stopSignals || []).forEach(s => sul.appendChild(el('li', null, esc(s))));
    stop.appendChild(sul);
    c.appendChild(stop);

    const more = el('details', 'more');
    more.appendChild(el('summary', null, '怎么坐、怎么调、常见错误'));
    const inner = el('div', 'inner');
    inner.innerHTML =
      '<b>怎么准备：</b>' + esc(t.setup) + '<br><br>' +
      '<b>常见错误：</b><br>' + (t.mistakes || []).map(esc).join('<br>') + '<br><br>' +
      '<b>风险提示：</b>' + esc(t.risk) + '<br><br>' +
      '<b>下次怎么加：</b>' + esc(t.progression) + '<br><br>' +
      '<b>找教学视频：</b>手机搜「' + esc(t.searchHint) + '」';
    more.appendChild(inner);
    c.appendChild(more);

    // 记录按钮
    const btn = el('button', 'btn sm', '记一次执行');
    btn.addEventListener('click', () => {
      let bad = false;
      const cbPain = el('label', 'check');
      const p = el('input'); p.type = 'checkbox';
      p.addEventListener('change', () => { bad = bad || p.checked; });
      cbPain.appendChild(p); cbPain.appendChild(el('span', null, '有哪里痛（不是酸）'));
      const cbC = el('label', 'check');
      const cc = el('input'); cc.type = 'checkbox';
      cc.addEventListener('change', () => { bad = bad || cc.checked; });
      cbC.appendChild(cc); cbC.appendChild(el('span', null, '有代偿（耸肩/歪斜/单侧酸）'));
      c.appendChild(cbPain); c.appendChild(cbC);
      btn.textContent = '保存这次记录';
      btn.onclick = () => {
        Log.logExercise(t.ex.id, { kg: t.kg, sets: t.sets, reps: t.reps, pain: p.checked, compensation: cc.checked });
        toast(bad ? '已记录。看到痛/代偿了，去反馈页看怎么办' : '已记录');
        btn.remove(); cbPain.remove(); cbC.remove();
        // 记录直接影响评估结论，必须立即重算
        renderAssess(); renderLog();
      };
    });
    c.appendChild(btn);
    return c;
  }

  /* ====================================================================
   * 反馈
   * ==================================================================== */
  function bindReact() {
    $$('#reactOpts .opt').forEach(b => {
      b.addEventListener('click', () => {
        const sig = b.dataset.sig;
        $$('#reactOpts .opt').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        Log.setLastSignal(sig);
        showReaction(sig);
      });
    });
  }

  function showReaction(sig) {
    const r = Plan.react(sig);
    const box = $('#reactOut');
    box.innerHTML = '';
    const c = el('div', 'card react' + (r.stop ? '' : ' soft'));
    c.appendChild(el('h3', null, esc(r.headline)));
    const ul = el('ul');
    r.lines.forEach(l => ul.appendChild(el('li', null, esc(l))));
    c.appendChild(ul);
    if (r.warning) {
      const w = el('div', 'card warn');
      w.appendChild(el('div', 'mb0', '<b>注意区分：</b>' + esc(r.warning)));
      c.appendChild(w);
    }
    if (r.urgent) {
      const u = el('div', 'stop');
      u.appendChild(el('span', 'lb', '什么时候该去看医生'));
      u.appendChild(el('div', null, esc(r.urgent)));
      c.appendChild(u);
    }
    box.appendChild(c);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ====================================================================
   * 表现评估：把训练日志变成一个能读懂的判断
   * 替换掉原来"你点一下就+1"的设计。
   * ==================================================================== */
  function renderAssess() {
    const box = $('#assessBox');
    if (!box) return;
    box.innerHTML = '';
    const st = Log.load();

    if (!st.goal) {
      box.appendChild(el('div', 'hint', '先定目标，再有评估。'));
      return;
    }

    const a = Assess.evaluate(st);
    const cur = Goal.PHASES[st.phaseIndex];
    const adj = Assess.applyIntensity(a, cur.id);

    // 结论卡
    const tone = { advance: 'ok', hold: 'accent', retreat: 'warn', stop: 'danger',
                   complete: 'ok', stale: 'warn', insufficient: 'warn',
                   no_data: 'plain', unknown: 'plain' }[a.verdict] || 'plain';
    const card = el('div', 'card ' + tone);
    card.appendChild(el('h3', null, esc(a.headline)));

    // 依据行：让用户知道"这个结论是怎么来的"
    if (a.sample > 0) {
      const sp = el('div', 'specs');
      sp.appendChild(el('span', 'spec', '最近 ' + a.sample + ' 次记录'));
      if (a.metrics.clean != null) {
        sp.appendChild(el('span', 'spec',
          '干净 ' + a.metrics.clean + ' / ' + a.metrics.sample));
      }
      if (a.metrics.comp) sp.appendChild(el('span', 'spec', '代偿 ' + a.metrics.comp + ' 次'));
      if (a.metrics.pain) sp.appendChild(el('span', 'spec', '疼痛 ' + a.metrics.pain + ' 次'));
      if (a.metrics.cramp) sp.appendChild(el('span', 'spec', '抽筋 ' + a.metrics.cramp + ' 次'));
      if (a.metrics.cleanStreak != null) {
        sp.appendChild(el('span', 'spec', '连续干净 ' + a.metrics.cleanStreak + ' 次'));
      }
      if (a.daysSinceLast != null) {
        sp.appendChild(el('span', 'spec', '距上次 ' + a.daysSinceLast + ' 天'));
      }
      card.appendChild(sp);
    }

    const ul = el('ul');
    ul.style.cssText = 'margin:10px 0 0;padding-left:18px;font-size:14px';
    a.reasons.forEach(r => {
      const li = el('li', null, esc(r));
      li.style.marginBottom = '6px';
      ul.appendChild(li);
    });
    card.appendChild(ul);
    box.appendChild(card);

    // 强度建议
    if (adj.changed) {
      const w = el('div', 'card ' + (a.intensityAdjust < 0 ? 'warn' : 'ok'));
      w.appendChild(el('h3', null,
        `强度建议：${adj.from} → ${adj.to}（${adj.level}）`));
      w.appendChild(el('p', 'mb0',
        a.intensityAdjust < 0
          ? '按你最近的记录，下一课建议用更轻的强度开始。这一条只是建议，不强制。'
          : '按你最近的记录，可以进入更进阶的强度。'));
      box.appendChild(w);
    }

    // 操作按钮
    const acts = el('div');
    if (a.verdict === 'advance') {
      const b = el('button', 'btn primary', '按建议进入 ' + Goal.PHASES[st.phaseIndex + 1].name);
      b.onclick = () => {
        Log.advancePhase();
        renderAssess(); renderPlan(); renderGoal();
        toast('已进入 ' + Goal.PHASES[Log.load().phaseIndex].name);
      };
      acts.appendChild(b);

      const stay = el('button', 'btn ghost', '先不升，再练一周');
      stay.onclick = () => { toast('好，保持当前强度'); };
      acts.appendChild(stay);
    } else if (a.verdict === 'retreat' || a.verdict === 'stop') {
      if (st.phaseIndex > 0) {
        const b = el('button', 'btn', '退回上一个阶段');
        b.onclick = () => {
          Log.retreatPhase();
          renderAssess(); renderPlan(); renderGoal();
          toast('已退回 ' + Goal.PHASES[Log.load().phaseIndex].name);
        };
        acts.appendChild(b);
      }
      const keep = el('button', 'btn ghost', '保持当前阶段');
      keep.onclick = () => { toast('好，保持当前阶段'); };
      acts.appendChild(keep);
    } else if (a.verdict === 'complete') {
      const b = el('button', 'btn primary', '重新选一次目标');
      b.onclick = () => { Log.resetAll(); boot(); go('goal'); };
      acts.appendChild(b);
    } else {
      const b = el('button', 'btn ghost', '手动进入下一阶段（不建议）');
      b.onclick = () => {
        Log.advancePhase();
        renderAssess(); renderPlan(); renderGoal();
        toast('已手动进入 ' + Goal.PHASES[Log.load().phaseIndex].name);
      };
      acts.appendChild(b);
    }
    box.appendChild(acts);

    box.appendChild(el('div', 'hint center mt',
      '评估基于你自己填的记录（勾选 + 报有无代偿）。' +
      '它给建议，不做强制——是否推进由你决定。'));
  }

  /* ====================================================================
   * 参数依据
   * ==================================================================== */
  function renderEvidence() {
    const box = $('#evidenceBox');
    if (!box) return;
    box.innerHTML = '';
    const weak = Evidence.weakCount();
    box.appendChild(el('div', 'hint',
      `共 ${Evidence.ITEMS.length} 条参数，其中 ${weak} 条没有文献依据（标为 C 级）。`));
    Evidence.renderInto(box);
  }

  function renderLog() {
    const box = $('#logSummary');
    box.innerHTML = '';
    const st = Log.load();
    const s = Log.stats(st);
    const a = Log.attendance(st);

    if (!st.goal) { box.appendChild(el('div', 'hint', '先定目标，再记录。')); return; }

    const c = el('div', 'card');
    const sp = el('div', 'specs');
    sp.appendChild(el('span', 'spec', '累计训练 ' + s.totalSessions + ' 次'));
    sp.appendChild(el('span', 'spec', '近 7 天 ' + s.thisWeek + ' 次'));
    if (a) sp.appendChild(el('span', 'spec', '出勤率 ' + a.rate + '%'));
    c.appendChild(sp);

    const alerts = [];
    if (s.painCount) alerts.push('记录里有 ' + s.painCount + ' 次「痛」');
    if (s.crampCount) alerts.push(s.crampCount + ' 次抽筋');
    if (s.compensationCount) alerts.push(s.compensationCount + ' 次代偿');
    if (alerts.length) {
      const w = el('div', 'card danger mt');
      w.appendChild(el('div', 'mb0', '⚠ ' + esc(alerts.join('，')) + '。这些不会被当成「练得狠」，下次计划会自动往回退。'));
      c.appendChild(w);
    }
    box.appendChild(c);

    // 用 onclick 而非 addEventListener：renderLog 会被反复调用，
    // addEventListener 会叠加监听器，导致点一次触发多次。
    $('#btnExport').onclick = () => {
      const txt = Log.exportAll();
      const o = $('#exportOut');
      o.textContent = txt;
      navigator.clipboard && navigator.clipboard.writeText(txt).then(() => toast('已复制'), () => {});
    };
    $('#btnReset').onclick = () => {
      if (confirm('清空全部数据？目标、计划、日志都会没。')) {
        Log.resetAll(); boot(); toast('已清空');
      }
    };

    // 可选的 API 按钮（重复绑定前先解绑，避免多次进入此页叠加监听）
    const ab = $('#btnApi');
    if (ab) {
      ab.onclick = async () => {
        ab.disabled = true;
        ab.textContent = '拉取中…';
        const r = await Api.fetchLibrary();
        ab.disabled = false;
        ab.textContent = '重新拉取';
        const st = $('#apiStatus');
        if (r) st.textContent = `已缓存 ${r.length} 条开源动作数据，示意图已可用。`;
        else st.textContent = '拉取失败（离线或接口不可达），已自动降级为纯本地数据，功能不受影响。';
        toast(r ? '拉取完成' : '拉取失败，已降级');
      };
    }
  }

  /* ====================================================================
   * 小工具
   * ==================================================================== */
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();