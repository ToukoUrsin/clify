// RACE dashboard: consumes the server's SSE stream (live or replay) and draws
// both lanes, the cumulative token/cost charts, the per-site timeline and the
// final scoreboard. All times come from the race clock, never the page clock.
const $ = id => document.getElementById(id);
const COLORS = {browser: '#5fd3ff', clify: '#ffb35c'};
const R = ['browser', 'clify'];
let tasks = [], model = null, lanes = null, baseline = null, clock = 0, clockAt = performance.now(), speed = 1, replay = false;
const racer = () => ({start: null, finish: null, fresh: 0, total: 0, cost: 0, calls: 0, tools: 0, cpu: 0, ram: 0, peakRam: 0,
  series: [], sites: {}, ticks: [], verify: {}, summary: null});
const S = {browser: racer(), clify: racer()};

const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(2) + 'k' : String(Math.round(n));
const fmtUsd = n => '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(3));
const fmtSec = ms => (ms / 1000).toFixed(1) + 's';
const fmtClock = ms => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const fmtRam = mb => mb >= 1000 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB';
const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const nowMs = () => clock + (performance.now() - clockAt) * speed;
const elapsed = r => S[r].start == null ? 0 : Math.max(0, (S[r].finish ?? nowMs()) - S[r].start);

function buildLanes() {
  for (const r of R) {
    $(`${r}-metrics`).innerHTML = [['time', 'TIME'], ['fresh', 'FRESH TOKENS'], ['total', 'ALL TOKENS'], ['cost', 'COST'], ['turns', 'TURNS · TOOLS'], ['res', 'CPU · RAM']]
      .map(([k, l]) => `<div class="metric"><span>${l}</span><strong id="${r}-${k}">—</strong><small id="${r}-${k}-sub">&nbsp;</small></div>`).join('');
    $(`${r}-sites`).innerHTML = tasks.map(t => `<div class="site" id="${r}-site-${t.id}">${t.label}<b></b><small></small></div>`).join('');
  }
}

// When a racer worked on a site: its RACE_TASK_START/RESULT marks widened by the tool calls that touched the site.
function siteSpan(r, id) {
  const s = S[r].sites[id] || {}, ticks = S[r].ticks.filter(t => t.task === id).map(t => t.ms);
  const start = Math.min(s.start ?? Infinity, ...ticks), end = Math.max(s.end ?? -Infinity, ...ticks);
  return start === Infinity ? null : {start, end: end === -Infinity ? start : end, open: s.end == null && S[r].finish == null};
}

function renderLane(r) {
  const s = S[r];
  $(`${r}-time`).textContent = s.start == null ? '—' : fmtSec(elapsed(r));
  $(`${r}-time-sub`).textContent = s.finish != null ? 'finished' : s.start != null ? 'running' : ' ';
  $(`${r}-fresh`).textContent = fmtTok(s.fresh);
  $(`${r}-fresh-sub`).textContent = 'in + out + cache write';
  $(`${r}-total`).textContent = fmtTok(s.total);
  $(`${r}-total-sub`).textContent = 'incl. cache reads';
  $(`${r}-cost`).textContent = fmtUsd(s.cost);
  $(`${r}-cost-sub`).textContent = 'list price';
  $(`${r}-turns`).textContent = `${s.calls} · ${s.tools}`;
  $(`${r}-turns-sub`).textContent = 'model calls · tools';
  $(`${r}-res`).innerHTML = `${Math.round(s.cpu)}<span style="display:inline;font-size:15px;letter-spacing:0">%</span> · ${fmtRam(s.ram)}`;
  $(`${r}-res-sub`).textContent = `peak ${fmtRam(s.peakRam)}`;
  for (const t of tasks) {
    const box = $(`${r}-site-${t.id}`), v = s.verify[t.id], site = s.sites[t.id] || {}, span = siteSpan(r, t.id);
    const cls = v ? (v.ok ? 'ok' : 'fail') : site.claim ? 'claimed' : span && span.open ? 'active' : '';
    box.className = `site ${cls}`;
    box.querySelector('b').textContent = v ? (v.ok ? '✓' : '✗') : span && span.open && !site.claim ? '…' : '';
    box.querySelector('small').textContent = span ? fmtSec(Math.max(0, (span.open ? nowMs() : span.end) - span.start)) : '';
  }
}

// Canvas helper: crisp at device pixel ratio, drawing in CSS px.
function ctx2d(c) {
  const w = c.clientWidth, h = c.clientHeight, d = window.devicePixelRatio || 1;
  if (c.width !== w * d || c.height !== h * d) { c.width = w * d; c.height = h * d; }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h); return {x, w, h};
}
const domainMs = () => Math.max(60000, ...R.map(r => elapsed(r) * 1.1));
const niceStep = (max, n) => { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw); };
function timeAxis(x, l, w, h, b, dom, rgt = 12) {
  const step = niceStep(dom / 1000, 6);
  x.font = '11px DM Mono, monospace'; x.fillStyle = '#5d6b82'; x.textAlign = 'center';
  for (let t = 0; t <= dom / 1000; t += step) x.fillText(`${t}s`, l + (t * 1000 / dom) * (w - l - rgt), h - b + 16);
}

function chart(id, key, fmt) {
  const {x, w, h} = ctx2d($(id)), l = 58, b = 22, top = 14, rgt = 64, dom = domainMs();
  const max = Math.max(1e-9, ...R.flatMap(r => S[r].series.map(p => p[key])));
  const step = niceStep(max, 4), ymax = Math.ceil(max / step) * step || step;
  x.strokeStyle = '#18202e'; x.lineWidth = 1; x.font = '11px DM Mono, monospace'; x.fillStyle = '#5d6b82'; x.textAlign = 'right';
  for (let v = 0; v <= ymax + 1e-12; v += step) { const py = h - b - (v / ymax) * (h - b - top); x.beginPath(); x.moveTo(l, py); x.lineTo(w - rgt, py); x.stroke(); x.fillText(fmt(v), l - 8, py + 4); }
  timeAxis(x, l, w, h, b, dom, rgt);
  const P = ([t, v]) => [l + (t / dom) * (w - l - rgt), h - b - (v / ymax) * (h - b - top)];
  const ends = [];
  for (const r of R) {
    const s = S[r]; if (s.start == null) continue;
    const pts = [[0, 0], ...s.series.map(p => [Math.max(0, p.ms - s.start), p[key]])];
    pts.push([elapsed(r), pts.at(-1)[1]]);
    x.strokeStyle = COLORS[r]; x.lineWidth = 2.5; x.lineJoin = 'round'; x.beginPath();
    pts.forEach((p, i) => { const [px, py] = P(p); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
    const [ex, ey] = P(pts.at(-1)); x.fillStyle = COLORS[r]; x.beginPath(); x.arc(ex, ey, 4, 0, 7); x.fill();
    ends.push({r, ex, ey, v: pts.at(-1)[1]});
  }
  // Direct end labels, nudged apart when the lines end close together.
  ends.sort((a, b) => a.ey - b.ey);
  if (ends.length === 2 && ends[1].ey - ends[0].ey < 18) { ends[0].ey -= 10; ends[1].ey += 10; }
  for (const e of ends) { x.fillStyle = COLORS[e.r]; x.font = '500 13px DM Mono, monospace'; x.textAlign = 'left'; x.fillText(fmt(e.v), Math.min(e.ex + 9, w - rgt + 6), Math.max(12, e.ey + 4)); }
}

function timeline() {
  const {x, w, h} = ctx2d($('timeline')), l = 160, b = 22, top = 2, dom = domainMs();
  const rowH = (h - b - top) / Math.max(1, tasks.length), X = t => l + (t / dom) * (w - l - 12);
  timeAxis(x, l, w, h, b, dom);
  tasks.forEach((t, i) => {
    const y0 = top + i * rowH;
    x.fillStyle = i % 2 ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.035)'; x.fillRect(l, y0, w - l - 12, rowH - 2);
    x.textAlign = 'left'; x.fillStyle = '#c9d3e2'; x.font = '500 13px DM Mono, monospace'; x.fillText(t.label, 2, y0 + rowH / 2 - 2);
    x.fillStyle = '#56637a'; x.font = '10.5px DM Mono, monospace'; x.fillText(t.kind, 2, y0 + rowH / 2 + 13);
    R.forEach((r, k) => {
      const s = S[r]; if (s.start == null) return;
      const bh = (rowH - 12) / 2 - 1, by = y0 + 5 + k * (bh + 2);
      const span = siteSpan(r, t.id);
      if (span) {
        const a = X(Math.max(0, span.start - s.start)), z = X((span.open ? nowMs() : span.end) - s.start);
        x.fillStyle = COLORS[r] + (span.open ? '99' : '4d'); x.fillRect(a, by, Math.max(4, z - a), bh);
      }
      x.fillStyle = COLORS[r];
      for (const tk of s.ticks) if (tk.task === t.id) x.fillRect(X(tk.ms - s.start) - 1, by, 2.5, bh);
      const v = s.verify[t.id];
      if (v && span) { x.font = '700 15px Space Grotesk, sans-serif'; x.fillStyle = v.ok ? '#4fdc98' : '#ff6b80'; x.textAlign = 'left'; x.fillText(v.ok ? '✓' : '✗', X(span.end - s.start) + 8, by + bh - 1); }
    });
  });
  for (const r of R) if (S[r].start != null) { // finish (or now) line per racer
    const px = X(elapsed(r)); x.strokeStyle = COLORS[r]; x.setLineDash([4, 4]); x.lineWidth = 1.2; x.beginPath(); x.moveTo(px, top); x.lineTo(px, h - b); x.stroke(); x.setLineDash([]);
  }
}

// Form/CSRF tokens are session-bound but still not for the screen: show their first 6 chars.
const mask = t => String(t).replace(/(authenticity_token|csrfmiddlewaretoken)(["'=:\s]+)([\w+\/=-]{6})[\w+\/=-]{10,}/g, '$1$2$3…').replace(/\b([\w-]{6})[\w-]{50,}\b/g, '$1…');
function terminal(e) {
  const box = $('term'), div = document.createElement('div');
  if (e.kind === 'tool') { let a = {}; try { a = JSON.parse(e.args); } catch {} div.className = 'term-line'; div.innerHTML = `<span class="p">$ </span>${esc(mask(a.command || e.name))}`; }
  else if (e.kind === 'tool_result') { div.className = 'term-line out'; div.textContent = mask(e.text || '').replace(/\s+/g, ' ').slice(0, 240); }
  else if (e.kind === 'text') { const t = e.text.replace(/RACE_(TASK_START|RESULT):[^\n]*\n?/g, '').trim(); if (!t) return; div.className = 'term-line say'; div.textContent = t.replace(/\s+/g, ' ').slice(0, 180); }
  else return;
  box.appendChild(div); while (box.children.length > 24) box.removeChild(box.firstChild);
}
function caption(e) {
  let a = {}; try { a = JSON.parse(e.args); } catch {}
  const detail = a.url || a.element || (a.function || a.code || '').replace(/\s+/g, ' ') || a.text || '';
  $('browser-caption').innerHTML = `<b>${esc(e.name)}</b>${esc(String(detail).slice(0, 120))}`;
}

function mult(label, b, c, fmt, better, worse) {
  if (!(c > 0)) return '';
  const k = b / c, even = Math.abs(k - 1) < 0.05, up = k >= 1;
  return `<div class="mult"><span>${label}</span><strong class="${even ? 'even' : up ? '' : 'worse'}">${even ? '≈1×' : (up ? k : 1 / k).toFixed(1) + '×'}</strong><em>${even ? 'about even' : up ? better : worse}</em><small>browser ${fmt(b)} · clify ${fmt(c)}</small></div>`;
}
// The strong baseline (mode B, browser + page JavaScript) is not raced live in
// the two-panel view; its mean over the recorded runs is printed under the score.
function baselineNote() {
  const m = baseline?.B; if (!m) return '';
  return `<div class="foot base">${esc(m.label)} on the same tasks, mean of ${m.runs} runs: ${fmtSec(m.timeMs)} · ${fmtTok(m.fresh)} fresh · ${fmtUsd(m.cost)} · ${fmtRam(m.peakRamMB)} · ${Number.isInteger(m.success) ? m.success : m.success.toFixed(1)}/${tasks.length} verified. C (clify) mean: ${fmtSec(baseline.C.timeMs)} · ${fmtUsd(baseline.C.cost)}.</div>`;
}
function showScore() {
  const b = S.browser.summary, c = S.clify.summary; if (!b || !c) return;
  const n = tasks.length, invalid = [b, c].filter(s => s.invalid);
  const cell = (r, s, t) => { const v = s.tasks[t.id] || {}, sp = siteSpan(r, t.id); return `<td class="${r[0]}">${sp ? fmtSec(sp.end - sp.start) : '—'} <span class="${v.ok ? 'ok' : 'fail'}">${v.ok ? '✓' : '✗'}</span><small>${esc(v.detail || '')}</small></td>`; };
  $('score').innerHTML = `
    <div class="score-top"><h3>Result · same model, same six tasks</h3><span>${esc(model)} · ${replay ? 'REPLAY OF A LIVE RUN' : 'LIVE RUN'}</span></div>
    ${invalid.length ? `<div class="invalid-banner">INVALID RUN — ${invalid.map(s => `${s.racer}: ${esc(s.invalidReason)}`).join('; ')}. Not counted.</div>` : `
    <div class="mults">
      ${mult('TIME', b.elapsedMs, c.elapsedMs, fmtSec, 'faster with clify', 'slower with clify')}
      ${mult('FRESH TOKENS', b.freshTokens, c.freshTokens, fmtTok, 'fewer with clify', 'more with clify')}
      ${mult('COST', b.costUsd, c.costUsd, fmtUsd, 'cheaper with clify', 'pricier with clify')}
      ${mult('PEAK RAM', b.peakRamMB, c.peakRamMB, fmtRam, 'less with clify', 'more with clify')}
      <div class="mult"><span>VERIFIED ON LIVE SITES</span><strong class="even">${b.success}/${n} · ${c.success}/${n}</strong><em>browser · clify</em><small>answers checked against live data</small></div>
    </div>`}
    <table><tr><th>SITE</th><th>TASK</th><th>${lanes ? `${lanes.browser.key} · BROWSER` : 'BROWSER'}</th><th>${lanes ? `${lanes.clify.key} · CLIFY` : 'CLIFY'}</th></tr>${tasks.map(t => `<tr><td>${t.label}</td><td style="color:#7d8aa1">${t.kind}</td>${cell('browser', b, t)}${cell('clify', c, t)}</tr>`).join('')}</table>
    ${baselineNote()}
    <div class="foot">Cost at list price incl. cache reads (${b.reportedCostUsd != null ? 'as reported by the agent CLI' : 'computed from token counts'}). CPU = % of one core; RAM = agent process tree; the browser's includes its Chrome (screencast on for this dashboard). All tokens incl. cache reads: browser ${fmtTok(b.totalTokens)} · clify ${fmtTok(c.totalTokens)}.</div>`;
  setTimeout(() => $('score').classList.add('show'), 1500);
}

function handle(e) {
  if (e.kind === 'hello') { replay = e.replay; baseline = e.baseline || null; $('mode').textContent = e.replay ? 'REPLAY OF A LIVE RUN' : 'LIVE'; return; }
  if (e.kind === 'clock') { clock = e.ms; clockAt = performance.now(); speed = e.speed; $('speed').textContent = `${e.speed}× SPEED`; $('speed').classList.toggle('on', e.speed > 1); return; }
  if (e.kind === 'run_start') {
    tasks = e.tasks; model = e.model; lanes = e.lanes || null; $('model').textContent = e.model; buildLanes();
    if (lanes) for (const r of R) { $(`${r}-kicker`).textContent = lanes[r].kicker; $(`${r}-title`).textContent = lanes[r].title; }
    if (e.title) $('dek').textContent = `${e.title} Same model, same prompt.`;
    return;
  }
  if (e.kind === 'browser_frame') { $('frame').src = `/frames/${e.file}`; $('frame-empty').style.display = 'none'; return; }
  const r = e.racer, s = S[r]; if (!s) return;
  switch (e.kind) {
    case 'racer_start': s.start = e.ms; $(`${r}-status`).textContent = 'RUNNING'; $(`${r}-status`).className = 'status running'; break;
    case 'model': if (e.model !== model) { $(`${r}-status`).textContent = 'WRONG MODEL'; $(`${r}-status`).className = 'status invalid'; } break;
    case 'usage': Object.assign(s, {fresh: e.fresh, total: e.total, cost: e.cost ?? 0, calls: e.calls, tools: e.toolCalls}); s.series.push({ms: e.ms, fresh: e.fresh, cost: e.cost ?? 0}); break;
    case 'resource': s.cpu = e.cpu; s.ram = e.rssMB; s.peakRam = Math.max(s.peakRam, e.rssMB); break;
    case 'tool': if (e.task) s.ticks.push({ms: e.ms, task: e.task}); if (r === 'clify') terminal(e); else caption(e); break;
    case 'tool_result': case 'text': if (r === 'clify') terminal(e); break;
    case 'task_start': (s.sites[e.task] ||= {}).start ??= e.ms; break;
    case 'task_claim': Object.assign(s.sites[e.task] ||= {}, {end: e.ms, claim: e.claim}); break;
    case 'verify': s.verify[e.task] = {ok: e.ok, detail: e.detail}; break;
    case 'racer_finish':
      s.summary = e; s.finish = e.finishedMs; s.start = e.startedMs;
      Object.assign(s, {fresh: e.freshTokens, total: e.totalTokens, cost: e.costUsd, calls: e.modelCalls, tools: e.toolCalls, peakRam: e.peakRamMB});
      s.series.push({ms: e.finishedMs, fresh: e.freshTokens, cost: e.costUsd});
      $(`${r}-status`).textContent = e.invalid ? 'INVALID' : `DONE · ${e.success}/${tasks.length} VERIFIED`; $(`${r}-status`).className = `status ${e.invalid ? 'invalid' : 'finished'}`;
      if (r === 'browser') $('browser-caption').textContent = '';
      showScore(); break;
  }
}

function frame() {
  $('clock').textContent = fmtClock(Math.max(0, ...R.map(elapsed)));
  if (tasks.length) { for (const r of R) renderLane(r); chart('chart-tokens', 'fresh', fmtTok); chart('chart-cost', 'cost', v => '$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2))); timeline(); }
  requestAnimationFrame(frame);
}
new EventSource('/events').onmessage = m => { try { handle(JSON.parse(m.data)); } catch (err) { console.error(err); } };
requestAnimationFrame(frame);
