/* 휴대폰 리워드 트래커 — plain JS, localStorage 저장, 상대 경로만 사용 */
(() => {
  'use strict';

  const KEY = 'phone-reward-tracker-v1';
  const VERSION = 2;
  const HINT_KEY = 'phone-reward-tracker-hint-dismissed';
  const app = document.getElementById('app');
  const titleEl = document.getElementById('title');
  const backBtn = document.getElementById('backBtn');

  /* ---------- utils ---------- */
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
  const man = (n) => {
    n = Math.round(n || 0);
    if (n < 10000) return won(n);
    const m = Math.floor(n / 10000), r = n % 10000;
    return r === 0 ? `${m}만원` : `${m}만 ${r.toLocaleString('ko-KR')}원`;
  };
  const addMonths = (ym, k) => {
    let [y, m] = ym.split('-').map(Number);
    m += k;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  };
  const ymLabel = (ym) => (ym ? ym.replace('-', '.') : '-');
  const ymKo = (ym) => { if (!ym) return '-'; const [y, m] = ym.split('-'); return `${y}년 ${Number(m)}월`; };
  const nowYM = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

  /* ---------- seed ---------- */
  // 2027년 7월 번호이동 예정 → 멤버십 쿠폰은 2026.11 ~ 2027.06 (8회)
  const MEMBERSHIP_START = '2026-11';
  const MEMBERSHIP_COUNT = 8;
  const membershipItem = (i) => ({ id: uid(), groupId: 'g-membership', name: `멤버십 쿠폰 ${i + 1}/${MEMBERSHIP_COUNT}`, amount: 5000,
    month: addMonths(MEMBERSHIP_START, i), when: '매월 1일', received: false });

  function seedGroups() {
    return [
      { id: 'g-membership', name: '멤버십 쿠폰', summary: '월 5,000원 × 8회 (2026.11 ~ 2027.06)',
        desc: '매월 1일 홈페이지 > 혜택 > 멤버십에서 받아 Npay로 등록 (2027년 7월 번호이동 예정 → 8회)', uncertain: false, cash: false, excludable: false, excluded: false },
      { id: 'g-npay', name: 'Npay 웰컴', summary: '50,000원 · 2027년 3월',
        desc: 'Npay 웰컴 혜택 50,000원 (2027년 3월 지급 예정)', uncertain: false, cash: false, excludable: false, excluded: false },
      { id: 'g-honey', name: '꿀머니', summary: '월 10,000원 × 6회 (2027.01 ~ 06 월말)',
        desc: '응모 완료(고객센터 확인) — 2027년 1월부터 6회 월말 입금. 입금되면 현금전환까지 체크하세요.',
        uncertain: false, cash: true, excludable: false, excluded: false }
    ];
  }

  function seedLine1() {
    const groups = seedGroups();
    const items = [];
    for (let i = 0; i < MEMBERSHIP_COUNT; i++) items.push(membershipItem(i));
    items.push({ id: uid(), groupId: 'g-npay', name: 'Npay 웰컴', amount: 50000, month: '2027-03', when: '2027년 3월', received: false });
    for (let i = 0; i < 6; i++) {
      items.push({ id: uid(), groupId: 'g-honey', name: `꿀머니 ${i + 1}회차`, amount: 10000,
        month: addMonths('2027-01', i), when: '월 말', received: false, cashed: false });
    }
    return {
      id: 'line-1',
      number: '010-7913-6907',
      carrier: '우리WON모바일',
      openMonth: '2026-11',
      openNote: '친구추천',
      plan: '우리WON LTE 500MB/50분',
      fee: 2100,
      feeDiscount: 1000,
      memo: '',
      cautions: [
        '마케팅·SMS 동의 및 우리WON멤버스 유지',
        '요금제 변경·정지·번호이동 금지',
        '번호이동은 2027년 7월 1일 이후 (6번째 꿀머니 확인 뒤)'
      ],
      groups,
      items
    };
  }

  /* ---------- migration ---------- */
  // 기본 그룹(g-membership / g-npay / g-honey)만 새 기본값으로 갱신. 사용자 회선·그룹·체크 기록은 유지.
  function migrate(s) {
    if ((Number(s.version) || 1) >= VERSION) return false;
    const defs = Object.fromEntries(seedGroups().map((g) => [g.id, g]));
    for (const line of s.lines) {
      if (!line || !Array.isArray(line.groups) || !Array.isArray(line.items)) continue;
      for (const g of line.groups) {
        if (g.id === 'g-membership') {
          const d = defs[g.id];
          g.summary = d.summary; g.desc = d.desc;
          const old = line.items.filter((i) => i.groupId === g.id);
          const byMonth = new Map(old.map((i) => [i.month, i]));
          const fresh = [];
          for (let k = 0; k < MEMBERSHIP_COUNT; k++) {
            const base = membershipItem(k);
            const prev = byMonth.get(base.month);
            // 남는 달은 체크 기록(received 등)과 id 유지, 이름만 n/8로
            fresh.push(prev ? { ...prev, name: base.name } : base);
          }
          const firstIdx = line.items.findIndex((i) => i.groupId === g.id);
          const rest = line.items.filter((i) => i.groupId !== g.id);
          const at = firstIdx < 0 ? rest.length : line.items.slice(0, firstIdx).filter((i) => i.groupId !== g.id).length;
          rest.splice(at, 0, ...fresh);
          line.items = rest;
        } else if (g.id === 'g-honey') {
          const d = defs[g.id];
          // 응모 완료(고객센터 확인) → 확정 포함. 항목·받음/현금전환 체크는 그대로.
          Object.assign(g, { summary: d.summary, desc: d.desc, uncertain: false, excludable: false, excluded: false });
        }
        // g-npay: 변경 없음
      }
    }
    s.version = VERSION;
    return true;
  }

  /* ---------- storage ---------- */
  function load() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.lines)) {
          if (migrate(s)) {
            localStorage.setItem(KEY + '-pre-v' + VERSION, raw); // 이전 데이터 백업
            localStorage.setItem(KEY, JSON.stringify(s));
          }
          return s;
        }
      } catch (e) { /* fall through */ }
      // 손상된 데이터는 지우지 않고 백업해 둠
      localStorage.setItem(KEY + '-corrupt-' + Date.now(), raw);
    }
    const s = { version: VERSION, lines: [seedLine1()] };
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  }
  let state = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));
  const findLine = (id) => state.lines.find((l) => l.id === id);

  /* ---------- calculations ---------- */
  const groupOf = (line, item) => line.groups.find((g) => g.id === item.groupId) || {};
  const activeItems = (line) => line.items.filter((it) => !groupOf(line, it).excluded);

  function totals(line) {
    let confirmed = 0, max = 0, received = 0, cashed = 0, cashTotal = 0, all = 0;
    for (const it of line.items) {
      const g = groupOf(line, it);
      all += it.amount;
      if (g.excluded) continue;
      max += it.amount;
      if (!g.uncertain) confirmed += it.amount;
      if (it.received) received += it.amount;
      if (g.cash) { cashTotal += it.amount; if (it.cashed) cashed += it.amount; }
    }
    const hasExcluded = line.groups.some((g) => g.excluded);
    const months = planMonths(line);
    const planCost = (Number(line.fee) || 0) * months;
    return { confirmed, max, all, received, remaining: max - received, cashed, cashTotal, hasExcluded,
      planMonths: months, planCost, net: confirmed - planCost };
  }

  // 요금 개월 수: 개통월 ~ 마지막 리워드 월 (포함). 예) 2026.11 ~ 2027.06 = 8개월
  function planMonths(line) {
    if (!line.openMonth) return 0;
    const last = line.items.reduce((m, it) => (it.month && it.month > m ? it.month : m), '');
    if (!last || last < line.openMonth) return 0;
    const [y1, m1] = line.openMonth.split('-').map(Number);
    const [y2, m2] = last.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1) + 1;
  }

  function schedule(line) {
    const map = new Map();
    for (const it of activeItems(line)) {
      if (!it.month) continue;
      if (!map.has(it.month)) map.set(it.month, []);
      map.get(it.month).push(it);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, items]) => {
      const total = items.reduce((s, i) => s + i.amount, 0);
      const got = items.filter((i) => i.received).reduce((s, i) => s + i.amount, 0);
      return { month, items, total, got };
    });
  }

  function nextDeposit(line) {
    const cur = nowYM();
    const row = schedule(line).find((r) => r.got < r.total && r.month >= cur) ||
                schedule(line).find((r) => r.got < r.total);
    return row ? { month: row.month, amount: row.total - row.got } : null;
  }

  /* ---------- UI helpers ---------- */
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }
  const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const chevron = '<svg class="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- views ---------- */
  function viewHome() {
    titleEl.textContent = '휴대폰 리워드 트래커';
    backBtn.hidden = true;
    let sumRecv = 0, sumMax = 0, sumConf = 0, sumCost = 0;
    state.lines.forEach((l) => { const t = totals(l); sumRecv += t.received; sumMax += t.max; sumConf += t.confirmed; sumCost += t.planCost; });

    const hint = (!isStandalone() && !localStorage.getItem(HINT_KEY)) ? `
      <div class="hint">
        <p>📲 <b>홈 화면에 추가하려면</b><br>iPhone Safari에서 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>를 누르세요.</p>
        <button type="button" data-act="dismiss-hint" aria-label="닫기">×</button>
      </div>` : '';

    const cards = state.lines.map((l, idx) => {
      const t = totals(l);
      const nx = nextDeposit(l);
      return `
        <a class="card line-card" href="#/line/${encodeURIComponent(l.id)}">
          <div class="top">
            <div class="badge-num">${idx + 1}</div>
            <div>
              <div class="num">${esc(l.number || '번호 미입력')}</div>
              <div class="carrier">${esc(l.carrier || '통신사 미입력')}${l.openMonth ? ` · ${ymKo(l.openMonth)} 개통` : ''}</div>
            </div>
            ${chevron}
          </div>
          <div class="kv-row">
            <div class="kv"><span>받은 금액</span><b class="ok">${won(t.received)}</b></div>
            <div class="kv"><span>남은 금액</span><b>${won(t.remaining)}</b></div>
            <div class="kv"><span>확정</span><b>${man(t.confirmed)}</b></div>
            <div class="kv"><span>최대</span><b>${man(t.max)}</b></div>
          </div>
          ${t.planCost > 0 ? `<div class="profit-line">총 요금 <b>${won(t.planCost)}</b> · 순수익 <b class="${t.net < 0 ? 'neg' : 'ok'}">${man(t.net)}</b></div>` : ''}
          <div class="bar"><i style="width:${pct(t.received, t.max)}%"></i></div>
          ${nx ? `<div class="next">다음 입금: <b>${ymLabel(nx.month)} · ${won(nx.amount)}</b></div>` : (t.max > 0 ? '<div class="next">🎉 모든 리워드를 받았어요</div>' : '')}
        </a>`;
    }).join('');

    app.innerHTML = `
      ${hint}
      <section class="hero">
        <div class="label">전체 ${state.lines.length}개 회선 · 받은 금액</div>
        <div class="big">${won(sumRecv)}</div>
        <div class="bar"><i style="width:${pct(sumRecv, sumMax)}%"></i></div>
        <div class="row">
          <div><span class="label">남은 금액</span><b>${won(sumMax - sumRecv)}</b></div>
          <div><span class="label">확정 / 최대</span><b>${man(sumConf)} / ${man(sumMax)}</b></div>
        </div>
        ${sumCost > 0 ? `<div class="hero-net">순수익 <b>${man(sumConf - sumCost)}</b> <span>(확정 − 총 요금 ${won(sumCost)})</span></div>` : ''}
      </section>
      <div class="section-title">내 회선</div>
      ${cards || '<div class="card empty">등록된 회선이 없어요.<br>아래 버튼으로 회선을 추가하세요.</div>'}
      <a class="btn block" href="#/new">＋ 회선 추가</a>
      <div class="footer-tools">
        <button class="btn ghost small" type="button" data-act="export">백업 내보내기</button>
        <button class="btn ghost small" type="button" data-act="import">백업 가져오기</button>
      </div>
      <p class="foot">데이터는 이 기기의 브라우저(localStorage)에만 저장됩니다.</p>`;
  }

  // 화면 상태 (메모리)
  const openGroups = new Set();
  let showAllSchedule = false;

  function viewDetail(id) {
    const line = findLine(id);
    if (!line) { location.hash = '#/'; return; }
    titleEl.textContent = line.number || '회선 상세';
    backBtn.hidden = false;
    const t = totals(line);
    const cur = nowYM();

    // 일정
    const rows = schedule(line);
    const firstOpen = Math.max(0, rows.findIndex((r) => r.month >= cur || r.got < r.total));
    const LIMIT = 9;
    const visible = showAllSchedule ? rows : rows.slice(0, Math.max(LIMIT, firstOpen + 3));
    const schedHtml = visible.map((r) => {
      let st;
      if (r.got >= r.total) st = '<span class="status done">완료</span>';
      else if (r.got > 0) st = '<span class="status part">일부</span>';
      else if (r.month < cur) st = '<span class="status late">확인 필요</span>';
      else st = '<span class="status plan">예정</span>';
      const chips = r.items.map((it) => {
        const g = groupOf(line, it);
        const cash = g.cash && it.cashed ? ' · 전환' : '';
        return `<span class="chip ${it.received ? 'ok' : ''}">${it.received ? '✓ ' : ''}${esc(g.name || it.name)} ${(it.amount / 1000).toLocaleString('ko-KR')}천${cash}</span>`;
      }).join('');
      const cls = [r.month === cur ? 'current' : '', r.got >= r.total ? 'done' : ''].join(' ');
      return `<li class="${cls}">
          <div class="m">${ymLabel(r.month)}${r.month === cur ? '<small>이번 달</small>' : ''}</div>
          <div class="chips">${chips}</div>
          <div class="amt">${won(r.total)}<small>${st} ${r.got > 0 && r.got < r.total ? won(r.got) : ''}</small></div>
        </li>`;
    }).join('');
    const moreBtn = rows.length > visible.length || showAllSchedule
      ? `<button class="btn ghost small sched-more" type="button" data-act="toggle-sched">${showAllSchedule ? '접기' : `전체 ${rows.length}개월 보기 (${ymLabel(rows[rows.length - 1].month)}까지)`}</button>` : '';

    // 리워드 그룹
    const groupsHtml = line.groups.map((g) => {
      const its = line.items.filter((i) => i.groupId === g.id);
      if (!its.length) return '';
      const gTotal = its.reduce((s, i) => s + i.amount, 0);
      const gGot = its.filter((i) => i.received).reduce((s, i) => s + i.amount, 0);
      const key = line.id + ':' + g.id;
      const isOpen = openGroups.has(key) || (!openGroups.has('init:' + key) && its.length <= 6);
      const itemsHtml = its.map((it) => `
        <div class="item ${it.received ? 'got' : ''}">
          <div class="iname"><b>${esc(it.name)}</b><span>${ymLabel(it.month)}${it.when ? ' · ' + esc(it.when) : ''} · ${won(it.amount)}</span></div>
          <div class="checks">
            <label class="chk"><input type="checkbox" data-act="recv" data-item="${it.id}" ${it.received ? 'checked' : ''} ${g.excluded ? 'disabled' : ''}><em>받음</em></label>
            ${g.cash ? `<label class="chk cash"><input type="checkbox" data-act="cash" data-item="${it.id}" ${it.cashed ? 'checked' : ''} ${g.excluded ? 'disabled' : ''}><em>현금전환</em></label>` : ''}
          </div>
        </div>`).join('');
      const exclude = g.excludable ? `
        <label class="switch-row">
          <p><b>1월 말 입금 없음 → ${esc(g.name)} 전체 제외</b>켜면 합계·월별 일정에서 빠집니다.</p>
          <input class="switch" type="checkbox" data-act="exclude" data-group="${g.id}" ${g.excluded ? 'checked' : ''}>
        </label>` : '';
      return `
        <details class="group ${g.excluded ? 'excluded' : ''}" data-key="${esc(key)}" ${isOpen ? 'open' : ''}>
          <summary>
            <div class="gtitle"><b>${esc(g.name)}${g.uncertain ? '<span class="tag unsure">불확실</span>' : ''}${g.cash ? '<span class="tag cash">현금전환</span>' : ''}</b>
              <span>${esc(g.summary || '')}</span></div>
            <div class="gsum"><b>${won(gGot)}</b>/ ${won(gTotal)}</div>
          </summary>
          <div class="gbody">
            ${g.desc ? `<div class="howto">${esc(g.desc)}</div>` : ''}
            ${exclude}
            ${g.excluded ? '<div class="note-excluded">제외됨 — 합계와 월별 일정에 포함되지 않아요.</div>' : ''}
            ${itemsHtml}
          </div>
        </details>`;
    }).join('');

    const cautions = (line.cautions || []).filter(Boolean);
    const excludedNames = line.groups.filter((g) => g.excluded).map((g) => g.name).join(', ');

    app.innerHTML = `
      <section class="card">
        <h2>회선 정보</h2>
        <dl class="info-grid">
          <dt>번호</dt><dd>${esc(line.number || '-')}</dd>
          <dt>통신사</dt><dd>${esc(line.carrier || '-')}</dd>
          <dt>개통</dt><dd>${ymKo(line.openMonth)} 개통${line.openNote ? ` (${esc(line.openNote)})` : ''}</dd>
          <dt>요금제</dt><dd>${esc(line.plan || '-')}</dd>
          <dt>월 요금</dt><dd><span class="fee-main">${line.fee ? won(line.fee) : '-'}</span>${line.feeDiscount ? `<span class="fee-alt">추가회선 할인 시 ${won(line.feeDiscount)}</span>` : ''}</dd>
        </dl>
        ${line.memo ? `<div class="memo">${esc(line.memo)}</div>` : ''}
      </section>

      ${cautions.length ? `<section class="card caution"><h2>⚠️ 주의사항</h2><ul>${cautions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>` : ''}

      <section class="card">
        <h2>리워드 합계</h2>
        <div class="totals">
          <div class="total confirmed"><span>확정</span><b>${man(t.confirmed)}</b><small>${won(t.confirmed)}</small></div>
          <div class="total"><span>최대</span><b>${man(t.max)}</b><small>${won(t.max)}</small></div>
          <div class="total received"><span>받은 금액</span><b>${won(t.received)}</b><small>${pct(t.received, t.max)}%</small></div>
          <div class="total remaining"><span>남은 금액</span><b>${won(t.remaining)}</b><small>미수령</small></div>
          ${t.planCost > 0 ? `<div class="total cost"><span>총 요금</span><b>${won(t.planCost)}</b><small>${won(line.fee)} × ${t.planMonths}개월</small></div>
          <div class="total net ${t.net < 0 ? 'neg' : ''}"><span>순수익</span><b>${man(t.net)}</b><small>확정 − 총 요금</small></div>` : ''}
          ${t.cashTotal > 0 ? `<div class="total wide"><span>현금전환 완료</span><b>${won(t.cashed)} / ${won(t.cashTotal)}</b></div>` : ''}
        </div>
        <div class="bar"><i style="width:${pct(t.received, t.max)}%"></i></div>
        ${t.hasExcluded ? `<div class="note-excluded">${esc(excludedNames)} 제외됨 → 최대 ${man(t.max)} (원래 ${man(t.all)})</div>` : ''}
      </section>

      <div class="section-title">월별 입금 예정</div>
      <section class="card">
        ${rows.length ? `<ul class="sched">${schedHtml}</ul>${moreBtn}` : '<p class="empty">일정이 없어요.</p>'}
      </section>

      <div class="section-title">리워드 항목</div>
      ${groupsHtml || '<div class="card empty">리워드 항목이 없어요. 편집에서 추가하세요.</div>'}

      <div class="btn-row" style="margin-top:20px">
        <a class="btn ghost" href="#/edit/${encodeURIComponent(line.id)}">편집</a>
        <button class="btn danger" type="button" data-act="delete-line" data-line="${line.id}">삭제</button>
      </div>`;
  }

  function rewardDraftHtml() {
    return `
      <div class="reward-draft">
        <button type="button" class="btn danger small rm" data-act="rm-draft" aria-label="이 항목 삭제">삭제</button>
        <label class="field"><span>리워드 이름</span><input name="r-name" placeholder="예: 웰컴 상품권" required></label>
        <div class="grid2">
          <label class="field"><span>금액(원)</span><input name="r-amount" type="number" inputmode="numeric" min="0" step="100" placeholder="10000" required></label>
          <label class="field"><span>시작 월</span><input name="r-month" type="month" required></label>
        </div>
        <div class="grid2">
          <label class="field"><span>반복 (개월 수)</span><input name="r-repeat" type="number" inputmode="numeric" min="1" max="60" value="1"></label>
          <label class="field"><span>받는 방법 / 메모</span><input name="r-desc" placeholder="선택"></label>
        </div>
        <div class="flags">
          <label class="flag"><input type="checkbox" name="r-cash"> 현금전환 체크</label>
          <label class="flag"><input type="checkbox" name="r-unsure"> 불확실 (최대에만 포함)</label>
        </div>
      </div>`;
  }

  function viewForm(id) {
    const line = id ? findLine(id) : null;
    if (id && !line) { location.hash = '#/'; return; }
    titleEl.textContent = line ? '회선 편집' : '회선 추가';
    backBtn.hidden = false;
    const v = line || { number: '', carrier: '', openMonth: nowYM(), openNote: '', plan: '', fee: '', feeDiscount: '', memo: '', cautions: [], groups: [], items: [] };

    const existing = (v.groups || []).map((g) => {
      const its = v.items.filter((i) => i.groupId === g.id);
      const sum = its.reduce((s, i) => s + i.amount, 0);
      return `<div class="existing" data-group="${g.id}">
          <div><b>${esc(g.name)}</b><span>${its.length}개 · ${won(sum)}</span></div>
          <button type="button" class="btn danger small" data-act="rm-group">삭제</button>
        </div>`;
    }).join('');

    app.innerHTML = `
      <form id="lineForm" autocomplete="off" novalidate>
        <section class="card">
          <h2>기본 정보</h2>
          <label class="field"><span>번호 *</span><input name="number" type="tel" inputmode="tel" placeholder="010-0000-0000" value="${esc(v.number)}" required></label>
          <label class="field"><span>통신사</span><input name="carrier" placeholder="예: 우리WON모바일" value="${esc(v.carrier)}"></label>
          <div class="grid2">
            <label class="field"><span>개통월</span><input name="openMonth" type="month" value="${esc(v.openMonth)}"></label>
            <label class="field"><span>개통 메모</span><input name="openNote" placeholder="예: 친구추천" value="${esc(v.openNote)}"></label>
          </div>
          <label class="field"><span>요금제</span><input name="plan" placeholder="예: LTE 500MB/50분" value="${esc(v.plan)}"></label>
          <div class="grid2">
            <label class="field"><span>월 요금(원)</span><input name="fee" type="number" inputmode="numeric" min="0" value="${esc(v.fee)}"></label>
            <label class="field"><span>할인 시 요금(원)</span><input name="feeDiscount" type="number" inputmode="numeric" min="0" placeholder="선택" value="${esc(v.feeDiscount)}"></label>
          </div>
          <label class="field"><span>메모</span><textarea name="memo" placeholder="자유 메모">${esc(v.memo)}</textarea></label>
          <label class="field"><span>주의사항 (한 줄에 하나)</span><textarea name="cautions" placeholder="예: 요금제 변경 금지">${esc((v.cautions || []).join('\n'))}</textarea></label>
        </section>

        ${existing ? `<section class="card"><h2>기존 리워드</h2><p class="help">삭제하면 해당 그룹의 체크 기록도 함께 지워집니다 (저장 시 반영).</p>${existing}</section>` : ''}

        <section class="card">
          <h2>리워드 추가</h2>
          <p class="help">반복 개월 수를 넣으면 시작 월부터 매달 항목이 만들어지고, 각각 받음 체크를 할 수 있어요.</p>
          <div id="drafts">${line ? '' : rewardDraftHtml()}</div>
          <button type="button" class="btn ghost block" data-act="add-draft">＋ 리워드 항목 추가</button>
        </section>

        <div class="btn-row">
          <a class="btn ghost" href="${line ? '#/line/' + encodeURIComponent(line.id) : '#/'}">취소</a>
          <button class="btn" type="submit">저장</button>
        </div>
      </form>`;
  }

  function submitForm(form, id) {
    const fd = new FormData(form);
    const number = String(fd.get('number') || '').trim();
    if (!number) { toast('번호를 입력하세요'); form.number.focus(); return; }

    const existing = id ? findLine(id) : null;
    const line = existing ? existing : { id: uid(), groups: [], items: [] };
    line.number = number;
    line.carrier = String(fd.get('carrier') || '').trim();
    line.openMonth = String(fd.get('openMonth') || '');
    line.openNote = String(fd.get('openNote') || '').trim();
    line.plan = String(fd.get('plan') || '').trim();
    line.fee = Number(fd.get('fee')) || 0;
    line.feeDiscount = Number(fd.get('feeDiscount')) || 0;
    line.memo = String(fd.get('memo') || '').trim();
    line.cautions = String(fd.get('cautions') || '').split('\n').map((s) => s.trim()).filter(Boolean);

    // 삭제 표시된 그룹 제거
    const removed = [...form.querySelectorAll('.existing.removed')].map((el) => el.dataset.group);
    if (removed.length) {
      line.groups = line.groups.filter((g) => !removed.includes(g.id));
      line.items = line.items.filter((i) => !removed.includes(i.groupId));
    }

    // 새 리워드
    for (const d of form.querySelectorAll('.reward-draft')) {
      const name = d.querySelector('[name="r-name"]').value.trim();
      const amount = Number(d.querySelector('[name="r-amount"]').value) || 0;
      const month = d.querySelector('[name="r-month"]').value || line.openMonth || nowYM();
      const repeat = Math.min(60, Math.max(1, parseInt(d.querySelector('[name="r-repeat"]').value, 10) || 1));
      const desc = d.querySelector('[name="r-desc"]').value.trim();
      const cash = d.querySelector('[name="r-cash"]').checked;
      const uncertain = d.querySelector('[name="r-unsure"]').checked;
      if (!name && !amount) continue; // 빈 항목 무시
      if (!name || !amount) { toast('리워드 이름과 금액을 입력하세요'); return; }
      const gid = 'g-' + uid();
      line.groups.push({
        id: gid, name, desc, cash, uncertain, excludable: uncertain, excluded: false,
        summary: repeat > 1 ? `월 ${won(amount)} × ${repeat}개월 (${ymLabel(month)} ~ ${ymLabel(addMonths(month, repeat - 1))})` : `${won(amount)} · ${ymLabel(month)}`
      });
      for (let i = 0; i < repeat; i++) {
        const it = { id: uid(), groupId: gid, name: repeat > 1 ? `${name} ${i + 1}/${repeat}` : name, amount, month: addMonths(month, i), received: false };
        if (cash) it.cashed = false;
        line.items.push(it);
      }
    }

    if (!existing) state.lines.push(line);
    save();
    toast('저장했어요');
    location.hash = '#/line/' + encodeURIComponent(line.id);
  }

  /* ---------- backup ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `phone-reward-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        if (!s || !Array.isArray(s.lines)) throw new Error('bad');
        if (!confirm('현재 데이터를 백업 파일로 덮어쓸까요?')) return;
        migrate(s);
        state = s; save(); render(); toast('가져오기 완료');
      } catch (e) { toast('올바른 백업 파일이 아니에요'); }
    };
    input.click();
  }

  /* ---------- router ---------- */
  let lastRoute = '';
  function render() {
    const h = location.hash || '#/';
    const parts = h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    if (h !== lastRoute) { showAllSchedule = false; }
    if (parts[0] === 'line' && parts[1]) viewDetail(parts[1]);
    else if (parts[0] === 'new') viewForm(null);
    else if (parts[0] === 'edit' && parts[1]) viewForm(parts[1]);
    else viewHome();
    if (h !== lastRoute) window.scrollTo(0, 0);
    lastRoute = h;
  }
  const currentLineId = () => { const m = (location.hash || '').match(/^#\/line\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };

  /* ---------- events ---------- */
  app.addEventListener('change', (e) => {
    const el = e.target;
    const act = el.dataset && el.dataset.act;
    if (!act) return;
    const line = findLine(currentLineId());
    if (!line) return;
    if (act === 'recv' || act === 'cash') {
      const it = line.items.find((i) => i.id === el.dataset.item);
      if (!it) return;
      if (act === 'recv') { it.received = el.checked; if (!el.checked && 'cashed' in it) it.cashed = false; }
      else { it.cashed = el.checked; if (el.checked) it.received = true; }
    } else if (act === 'exclude') {
      const g = line.groups.find((x) => x.id === el.dataset.group);
      if (!g) return;
      g.excluded = el.checked;
      toast(el.checked ? `${g.name} 제외 — 합계에서 빠졌어요` : `${g.name} 다시 포함`);
    } else return;
    save();
    render();
  });

  // details 열림 상태 기억
  app.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return;
    const key = d.dataset.key;
    openGroups.add('init:' + key);
    if (d.open) openGroups.add(key); else openGroups.delete(key);
  }, true);

  app.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const act = btn.dataset.act;
    if (act === 'dismiss-hint') { localStorage.setItem(HINT_KEY, '1'); render(); }
    else if (act === 'export') exportData();
    else if (act === 'import') importData();
    else if (act === 'toggle-sched') { showAllSchedule = !showAllSchedule; render(); }
    else if (act === 'delete-line') {
      const line = findLine(btn.dataset.line);
      if (line && confirm(`${line.number} 회선을 삭제할까요?\n체크 기록도 모두 지워집니다.`)) {
        state.lines = state.lines.filter((l) => l.id !== line.id);
        save(); toast('삭제했어요'); location.hash = '#/';
      }
    } else if (act === 'add-draft') {
      document.getElementById('drafts').insertAdjacentHTML('beforeend', rewardDraftHtml());
      const all = document.querySelectorAll('.reward-draft');
      all[all.length - 1].querySelector('input').focus();
    } else if (act === 'rm-draft') btn.closest('.reward-draft').remove();
    else if (act === 'rm-group') {
      const row = btn.closest('.existing');
      row.classList.toggle('removed');
      btn.textContent = row.classList.contains('removed') ? '되돌리기' : '삭제';
    }
  });

  app.addEventListener('submit', (e) => {
    if (e.target.id !== 'lineForm') return;
    e.preventDefault();
    const m = (location.hash || '').match(/^#\/edit\/(.+)$/);
    submitForm(e.target, m ? decodeURIComponent(m[1]) : null);
  });

  backBtn.addEventListener('click', () => {
    const m = (location.hash || '').match(/^#\/edit\/(.+)$/);
    location.hash = m ? '#/line/' + m[1] : '#/';
  });

  // 다른 탭에서 변경 시 동기화
  window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) { try { state = JSON.parse(e.newValue); render(); } catch (_) {} } });
  window.addEventListener('hashchange', render);
  render();

  /* ---------- service worker (상대 경로) ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => console.warn('SW 등록 실패', err));
    });
  }
})();
