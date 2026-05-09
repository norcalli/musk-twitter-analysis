// Created by claude
// Client-side time-budget computation + all visualizations.
// All data is inlined as <script type="application/json">; we read it on load.

(() => {
'use strict';

// --- Load inlined data ----------------------------------------------------
const J = id => JSON.parse(document.getElementById(id).textContent);
const META       = J('data-meta');
const TWEETS     = J('data-tweets-min');     // {unix:[], kind:[], chars:[]} per-tweet, sorted by unix
let   SESSIONS   = J('data-sessions');       // re-derived from TWEETS when session_gap_min changes
const DAILY      = J('data-daily');
const MONTHLY    = J('data-monthly');
const HOURLY     = J('data-hourly');
const YEAR_HOUR  = J('data-year-hour');
const TOP_SESS   = J('data-top-sessions');
const TOP_DAYS   = J('data-top-days');

const N_TWEETS = TWEETS.unix.length;
let N_SESS = SESSIONS.start_unix.length;

// --- Client-side sessionization ------------------------------------------
// Re-derive SESSIONS from per-tweet data given a gap threshold (in seconds).
// Result is the same shape as the pre-baked SESSIONS (columnar arrays).
function sessionizeFromTweets(gapSec) {
  const u = TWEETS.unix, k = TWEETS.kind, c = TWEETS.chars;
  const start_unix = [];
  const span_sec = [];
  const n_original = [], n_reply = [], n_quote = [], n_rt = [];
  const chars_original = [], chars_reply = [], chars_quote = [];
  const hour = [], dow = [], year = [], month = [], day_iso = [];

  let sStart = 0, sLast = 0;
  let no=0, nr=0, nq=0, nx=0, co=0, cr=0, cq=0;
  const flush = () => {
    start_unix.push(sStart);
    span_sec.push(sLast - sStart);
    n_original.push(no); n_reply.push(nr); n_quote.push(nq); n_rt.push(nx);
    chars_original.push(co); chars_reply.push(cr); chars_quote.push(cq);
    const d = new Date(sStart * 1000);
    hour.push(d.getUTCHours());
    dow.push(d.getUTCDay());
    year.push(d.getUTCFullYear());
    month.push(d.getUTCMonth() + 1);
    day_iso.push(d.toISOString().slice(0, 10));
  };

  if (N_TWEETS === 0) return { start_unix, span_sec, n_original, n_reply, n_quote, n_rt,
                               chars_original, chars_reply, chars_quote, hour, dow, year, month, day_iso };

  sStart = sLast = u[0];
  const accum = (i) => {
    const ki = k[i], ci = c[i];
    if (ki === 0) { no++; co += ci; }
    else if (ki === 1) { nr++; cr += ci; }
    else if (ki === 2) { nq++; cq += ci; }
    else { nx++; }
  };
  accum(0);
  for (let i = 1; i < N_TWEETS; i++) {
    if (u[i] - sLast > gapSec) {
      flush();
      sStart = u[i];
      no=0; nr=0; nq=0; nx=0; co=0; cr=0; cq=0;
    }
    sLast = u[i];
    accum(i);
  }
  flush();
  return { start_unix, span_sec, n_original, n_reply, n_quote, n_rt,
           chars_original, chars_reply, chars_quote, hour, dow, year, month, day_iso };
}

function reSessionize(gapMin) {
  SESSIONS = sessionizeFromTweets(gapMin * 60);
  N_SESS = SESSIONS.start_unix.length;
  buildIndexes();
}

// --- Knob definitions -----------------------------------------------------
const KNOB_DEFS = [
  { id: 'read_context', label: 'Read parent (replies/quotes)', def: 8,  min: 0,  max: 120, step: 1, unit: 's',
    desc: 'Time to read the tweet you are replying to or quoting before composing.' },
  { id: 'think_original', label: 'Think — original post', def: 30, min: 0, max: 600, step: 5, unit: 's',
    desc: 'Time to come up with the take from a blank slate.' },
  { id: 'think_reply', label: 'Think — reply', def: 10, min: 0, max: 180, step: 1, unit: 's',
    desc: 'Time to think of a reaction once parent is read.' },
  { id: 'think_quote', label: 'Think — quote tweet', def: 15, min: 0, max: 240, step: 1, unit: 's',
    desc: 'Composing a quote takes more thought than a plain reply.' },
  { id: 'think_rt', label: 'Think — retweet', def: 2, min: 0, max: 60, step: 1, unit: 's',
    desc: 'Almost no thought — see, tap RT, done.' },
  { id: 'type_cps', label: 'Typing speed', def: 3, min: 0.5, max: 10, step: 0.25, unit: 'cps',
    desc: 'Characters per second. Mobile thumbing ~3, desktop ~5–7.' },
  { id: 'send', label: 'Send / post overhead', def: 3, min: 0, max: 60, step: 1, unit: 's',
    desc: 'Tap, confirm, occasional edit.' },
  { id: 'edge_pad', label: 'Session edge padding', def: 30, min: 0, max: 1800, step: 10, unit: 's',
    desc: 'Extra time at start+end of every session — opening the app, scrolling before/after.' },
  { id: 'session_gap_min', label: 'Session gap (split threshold)', def: 30, min: 5, max: 120, step: 5, unit: 'min',
    desc: 'If two posts are this many minutes apart, treat them as separate sessions. Lower = stricter; higher = bundles loosely-connected activity into one binge.' },
];

const PRESETS = {
  conservative: { read_context:4,  think_original:15, think_reply:5,  think_quote:8,  think_rt:1,  type_cps:6,    send:2,  edge_pad:15,  session_gap_min:15 },
  default:      { read_context:8,  think_original:30, think_reply:10, think_quote:15, think_rt:2,  type_cps:3,    send:3,  edge_pad:30,  session_gap_min:30 },
  heavy:        { read_context:20, think_original:90, think_reply:25, think_quote:40, think_rt:5,  type_cps:2,    send:5,  edge_pad:120, session_gap_min:60 },
  doomscroll:   { read_context:30, think_original:180,think_reply:45, think_quote:75, think_rt:10, type_cps:1.5,  send:10, edge_pad:900, session_gap_min:90 },
};

// --- Build knob UI --------------------------------------------------------
const knobsContainer = document.getElementById('knobs');
const KNOBS = {};

// Debounced rerender — avoids recomputing mid-drag.
// We use trailing-edge debounce so the *last* slider value lands.
let rerenderTimer = null;
function scheduleRerender(delay = 80) {
  if (rerenderTimer) clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => { rerenderTimer = null; rerender(); }, delay);
}

KNOB_DEFS.forEach(def => {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  wrap.innerHTML = `
    <label>${def.label}</label>
    <div class="row">
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.def}" data-id="${def.id}">
      <span class="v"><span class="num">${def.def}</span> <span class="unit">${def.unit}</span></span>
    </div>
    <div class="desc">${def.desc}</div>`;
  knobsContainer.appendChild(wrap);
  const slider = wrap.querySelector('input');
  const numEl  = wrap.querySelector('.num');
  KNOBS[def.id] = +def.def;
  slider.addEventListener('input', () => {
    const v = +slider.value;
    KNOBS[def.id] = v;
    numEl.textContent = v;
    document.querySelectorAll('button.preset').forEach(b => b.classList.remove('active'));
    // session_gap is expensive (re-sessionize); use slightly longer debounce.
    if (def.id === 'session_gap_min') {
      if (rerenderTimer) clearTimeout(rerenderTimer);
      rerenderTimer = setTimeout(() => {
        rerenderTimer = null;
        reSessionize(KNOBS.session_gap_min);
        rerender();
      }, 140);
    } else {
      scheduleRerender(80);
    }
  });
});

// preset buttons (only on the time-cost preset row, not the TZ buttons)
document.querySelectorAll('.preset-row button.preset[data-preset]').forEach(b => {
  b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset];
    if (!p) return;
    document.querySelectorAll('.preset-row button.preset[data-preset]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    let needsResessionize = false;
    KNOB_DEFS.forEach(def => {
      if (!(def.id in p)) return;
      const slider = document.querySelector(`input[data-id="${def.id}"]`);
      if (slider.value !== String(p[def.id])) {
        slider.value = p[def.id];
        slider.parentElement.querySelector('.num').textContent = p[def.id];
        if (def.id === 'session_gap_min') needsResessionize = true;
        KNOBS[def.id] = p[def.id];
      }
    });
    if (needsResessionize) reSessionize(KNOBS.session_gap_min);
    rerender();
  });
});

// --- Time-zone state for hour-of-day plots --------------------------------
// The dataset is UTC. Apply a fixed offset (no DST). Default −7 (PDT).
let TZ_OFFSET = -7;
function shiftHour(h, offset) { return ((h + offset) % 24 + 24) % 24; }
function shiftDow(h, d, offset) {
  // post is at (h, d) UTC; if shifted hour wraps, dow advances/regresses.
  const hh = h + offset;
  if (hh < 0)   return (d + 6) % 7;     // crossed back into prev day
  if (hh >= 24) return (d + 1) % 7;     // crossed into next day
  return d;
}

// --- Time math ------------------------------------------------------------
// session_time = max(span, post_costs) + 2*edge_pad
// Edge pad is unconditional — opening the app + glancing at notifications
// happens regardless of whether the burst was tight or spread out.
function sessionTimeSec(i) {
  const k = KNOBS;
  const no = SESSIONS.n_original[i];
  const nr = SESSIONS.n_reply[i];
  const nq = SESSIONS.n_quote[i];
  const nx = SESSIONS.n_rt[i];
  const co = SESSIONS.chars_original[i];
  const cr = SESSIONS.chars_reply[i];
  const cq = SESSIONS.chars_quote[i];
  const span = SESSIONS.span_sec[i];

  const postCosts =
      no * (k.think_original + k.send) +
      nr * (k.read_context + k.think_reply + k.send) +
      nq * (k.read_context + k.think_quote + k.send) +
      nx * (k.think_rt + k.send) +
      (co + cr + cq) / k.type_cps;
  return Math.max(span, postCosts) + 2 * k.edge_pad;
}

// pre-bucket sessions by day/month — rebuilt by reSessionize() when needed.
const DAY_INDEX = new Map();    // 'YYYY-MM-DD' -> Array<sessionIdx>
const MONTH_INDEX = new Map();  // 'YYYY-MM'    -> Array<sessionIdx>
const DAYS_SORTED = [];
function buildIndexes() {
  DAY_INDEX.clear(); MONTH_INDEX.clear(); DAYS_SORTED.length = 0;
  for (let i = 0; i < N_SESS; i++) {
    const d = SESSIONS.day_iso[i];
    if (!DAY_INDEX.has(d)) DAY_INDEX.set(d, []);
    DAY_INDEX.get(d).push(i);
    const ym = d.slice(0, 7);
    if (!MONTH_INDEX.has(ym)) MONTH_INDEX.set(ym, []);
    MONTH_INDEX.get(ym).push(i);
  }
  [...DAY_INDEX.keys()].sort().forEach(d => DAYS_SORTED.push(d));
}
buildIndexes();

// --- Per-session breakdown: which term anchors the session length --------
// Now that edge_pad is unconditional, we just classify by max(span, posts).
// Reported time is the *core* session time (span or posts) — edge_pad shown
// separately so users see the three components.
function computeAnchoring() {
  const k = KNOBS;
  let timeFromSpan = 0, timeFromPosts = 0, timeFromEdge = 0;
  let nSpanAnchored = 0, nPostAnchored = 0;
  for (let i = 0; i < N_SESS; i++) {
    const no = SESSIONS.n_original[i], nr = SESSIONS.n_reply[i],
          nq = SESSIONS.n_quote[i],    nx = SESSIONS.n_rt[i];
    const co = SESSIONS.chars_original[i], cr = SESSIONS.chars_reply[i],
          cq = SESSIONS.chars_quote[i];
    const span = SESSIONS.span_sec[i];
    const posts =
        no * (k.think_original + k.send) +
        nr * (k.read_context + k.think_reply + k.send) +
        nq * (k.read_context + k.think_quote + k.send) +
        nx * (k.think_rt + k.send) +
        (co + cr + cq) / k.type_cps;
    timeFromEdge += 2 * k.edge_pad;
    if (span >= posts) { timeFromSpan += span;   nSpanAnchored++; }
    else               { timeFromPosts += posts; nPostAnchored++; }
  }
  const total = timeFromSpan + timeFromPosts + timeFromEdge;
  return {
    timeFromSpan, timeFromPosts, timeFromEdge, total,
    pctSpan:  total > 0 ? timeFromSpan  / total : 0,
    pctPosts: total > 0 ? timeFromPosts / total : 0,
    pctEdge:  total > 0 ? timeFromEdge  / total : 0,
    nSpanAnchored, nPostAnchored,
  };
}

// --- Headline numbers -----------------------------------------------------
function computeHeadlines() {
  let totalSec = 0;
  let totalSpan = 0;
  let totalSessions = N_SESS;
  for (let i = 0; i < N_SESS; i++) {
    totalSec += sessionTimeSec(i);
    totalSpan += SESSIONS.span_sec[i];
  }
  // Per-day stats: only over distinct active days
  const dayTimes = DAYS_SORTED.map(d => DAY_INDEX.get(d).reduce((a,i) => a+sessionTimeSec(i), 0));
  const activeDays = dayTimes.length;
  const meanPerActive = totalSec / activeDays;
  // 2024-only:
  const idx2024 = DAYS_SORTED.map((d,i)=> [d,i]).filter(([d]) => d.startsWith('2024'));
  const sec2024 = idx2024.reduce((a, [,i]) => a + dayTimes[i], 0);
  const days2024 = idx2024.length;
  const mean2024 = days2024 ? sec2024 / days2024 : 0;

  // Total date range in calendar days (not just active days) for "% of waking life"
  const startDate = new Date(META.min_date + 'T00:00:00Z');
  const endDate   = new Date(META.max_date + 'T00:00:00Z');
  const totalCalDays = Math.round((endDate - startDate) / 86400000) + 1;
  const meanPerCalDay = totalSec / totalCalDays;
  const wakingFracAll = meanPerCalDay / (16 * 3600);
  const wakingFrac2024 = mean2024 / (16 * 3600);

  // Equivalent full workdays (8h)
  const fullWorkdays = totalSec / (8 * 3600);
  const fullWorkyears = fullWorkdays / 250;

  return { totalSec, totalSpan, activeDays, totalCalDays, dayTimes,
           meanPerActive, mean2024, days2024, sec2024, wakingFracAll, wakingFrac2024,
           fullWorkdays, fullWorkyears };
}

const fmtH = s => (s/3600).toFixed(1) + ' h';
const fmtHM = s => {
  const m = Math.round(s/60); const h = Math.floor(m/60); const mm = m%60;
  return h ? `${h}h${String(mm).padStart(2,'0')}` : `${mm} min`;
};
const fmtPct = f => (f*100).toFixed(1) + '%';
const fmtN = n => n.toLocaleString();

function renderHeadline(H) {
  const hl = document.getElementById('hl-cards');
  hl.innerHTML = '';
  const cards = [
    { label: 'Total estimated time on Twitter', num: (H.totalSec/3600/24/365).toFixed(2)+' yrs', cls: 'accent',
      sub: `${fmtH(H.totalSec)} across ${fmtN(H.totalCalDays)} calendar days` },
    { label: 'Avg per active day', num: fmtHM(H.meanPerActive), cls: '',
      sub: `${fmtN(H.activeDays)} days had at least one post` },
    { label: 'Avg per day (2024)', num: fmtHM(H.mean2024), cls: 'yellow',
      sub: `${fmtN(H.days2024)} active days in 2024` },
    { label: '% of waking life (16h/day) — career avg', num: fmtPct(H.wakingFracAll), cls: '',
      sub: `Spread across the entire ${fmtN(H.totalCalDays)}-day window` },
    { label: '% of waking life — 2024 only', num: fmtPct(H.wakingFrac2024), cls: 'yellow',
      sub: `Of every waking minute in 2024` },
    { label: 'Equivalent full‑time workyears', num: H.fullWorkyears.toFixed(1), cls: 'green',
      sub: `${fmtN(Math.round(H.fullWorkdays))} eight‑hour workdays` },
    { label: 'Total posts (deduped)', num: fmtN(META.total_tweets), cls: '',
      sub: `${fmtN(META.n_reply)} replies · ${fmtN(META.n_original)} originals · ${fmtN(META.n_quote)} quotes` },
    { label: 'Longest single session', num: (META.longest_session_min/60).toFixed(2)+' h', cls: 'accent',
      sub: `${META.biggest_session_n} posts in one binge` },
  ];
  cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="label">${c.label}</div><div class="num ${c.cls}">${c.num}</div><div class="sub">${c.sub}</div>`;
    hl.appendChild(el);
  });
}

// --- Daily time series chart ---------------------------------------------
let dailyChart = null;
function renderDaily(H) {
  const ctx = document.getElementById('chart-daily').getContext('2d');
  // smooth via 28-day rolling mean
  const win = 28;
  const smoothed = new Array(DAYS_SORTED.length);
  let sum = 0, n = 0;
  // build dense array of (day, hours)
  // also need to fill in zero-tweet days for honest smoothing
  const start = new Date(DAYS_SORTED[0] + 'T00:00:00Z');
  const end   = new Date(DAYS_SORTED.at(-1) + 'T00:00:00Z');
  const denseLabels = [];
  const denseHours = [];
  const dayMap = new Map();
  DAYS_SORTED.forEach((d, i) => dayMap.set(d, H.dayTimes[i]));
  for (let t = +start; t <= +end; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0,10);
    denseLabels.push(iso);
    denseHours.push((dayMap.get(iso) || 0) / 3600);
  }
  // rolling window
  const smooth = new Array(denseHours.length);
  let acc = 0;
  for (let i = 0; i < denseHours.length; i++) {
    acc += denseHours[i];
    if (i >= win) acc -= denseHours[i - win];
    smooth[i] = i >= win - 1 ? acc / win : null;
  }

  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(ctx, {
    type: 'line',
    data: { labels: denseLabels, datasets: [
      { label: 'Hours/day (28d avg)', data: smooth, borderColor: '#ff5e3a', backgroundColor: 'rgba(255,94,58,0.12)',
        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.2 },
      { label: 'Hours/day (raw)', data: denseHours, borderColor: 'rgba(95,198,255,0.35)', borderWidth: 1, pointRadius: 0, hidden: true },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { ticks: { color:'#8b94a8', maxTicksLimit: 12 }, grid:{ color:'#232a3d' } },
        y: { ticks: { color:'#8b94a8', callback: v=>v+'h' }, grid:{ color:'#232a3d' }, title:{ display:true, text:'hours / day', color:'#8b94a8' } },
      },
      plugins: { legend: { labels: { color:'#e7ecf3' } }, tooltip: { callbacks: { label: c => c.dataset.label+': '+c.parsed.y.toFixed(2)+' h' } } }
    }
  });

  // stat row
  const statEl = document.getElementById('daily-stats');
  const overEightCount = H.dayTimes.filter(s => s > 8*3600).length;
  const overFourCount  = H.dayTimes.filter(s => s > 4*3600).length;
  const overOneCount   = H.dayTimes.filter(s => s > 1*3600).length;
  statEl.innerHTML =
    `<span><b>${fmtN(overEightCount)}</b> days over 8 hours on Twitter</span>` +
    `<span><b>${fmtN(overFourCount)}</b> days over 4 hours</span>` +
    `<span><b>${fmtN(overOneCount)}</b> days over 1 hour</span>`;
}

// --- Calendar heatmap (GitHub-style) -------------------------------------
function renderCalendar(H) {
  const el = document.getElementById('cal-container');
  el.innerHTML = '';
  // Color scale based on hours
  const colorFor = h => {
    if (h <= 0) return '#1a2030';
    if (h < 1) return '#2c4d3a';
    if (h < 3) return '#3ecf8e';
    if (h < 5) return '#f5c542';
    if (h < 8) return '#ff8a3a';
    return '#ff2222';
  };
  const dayMap = new Map();
  DAYS_SORTED.forEach((d, i) => dayMap.set(d, H.dayTimes[i]));

  // years sorted asc
  const years = [...new Set(DAYS_SORTED.map(d => d.slice(0,4)))].sort();
  const cell = 11, gap = 2, rowGap = 18, weekW = cell+gap;
  years.forEach(y => {
    const yStart = new Date(`${y}-01-01T00:00:00Z`);
    const yEnd   = new Date(`${y}-12-31T00:00:00Z`);
    const firstDow = yStart.getUTCDay(); // 0=Sun
    const days = Math.round((yEnd - yStart)/86400000) + 1;
    const weeks = Math.ceil((days + firstDow) / 7);
    const w = weeks * weekW + 60;
    const h = 7 * weekW + 28;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('class', 'cal-svg');
    svg.style.maxWidth = '100%';
    svg.style.marginBottom = rowGap + 'px';
    // year label
    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('x', 0); lbl.setAttribute('y', 12);
    lbl.setAttribute('fill', '#e7ecf3'); lbl.setAttribute('font-size','12'); lbl.setAttribute('font-weight','600');
    lbl.textContent = y;
    svg.appendChild(lbl);
    // dow ticks
    ['M','W','F'].forEach((s, k) => {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', 0);
      t.setAttribute('y', 28 + (k*2 + 1) * weekW + 8);
      t.setAttribute('fill', '#8b94a8'); t.setAttribute('font-size','10');
      t.textContent = s;
      svg.appendChild(t);
    });
    // cells
    for (let d = 0; d < days; d++) {
      const date = new Date(yStart); date.setUTCDate(date.getUTCDate() + d);
      const iso = date.toISOString().slice(0,10);
      const idx = d + firstDow;
      const col = Math.floor(idx / 7), row = idx % 7;
      const hours = (dayMap.get(iso) || 0) / 3600;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', 30 + col * weekW);
      r.setAttribute('y', 28 + row * weekW);
      r.setAttribute('width', cell);
      r.setAttribute('height', cell);
      r.setAttribute('rx', 2);
      r.setAttribute('fill', colorFor(hours));
      r.dataset.day = iso;
      r.dataset.h = hours.toFixed(2);
      r.addEventListener('mouseenter', tipShow);
      r.addEventListener('mouseleave', tipHide);
      svg.appendChild(r);
    }
    el.appendChild(svg);
  });
}

// tooltip
const tipEl = document.getElementById('tip');
function tipShow(e) {
  const r = e.target;
  tipEl.textContent = `${r.dataset.day} — ${r.dataset.h}h on Twitter`;
  const b = r.getBoundingClientRect();
  tipEl.style.left = (b.left + b.width/2 + window.scrollX) + 'px';
  tipEl.style.top  = (b.top + window.scrollY) + 'px';
  tipEl.style.opacity = '1';
}
function tipHide() { tipEl.style.opacity = '0'; }

// --- Hour-of-day clock ---------------------------------------------------
function renderClock() {
  const svg = document.getElementById('clock');
  svg.innerHTML = '';
  // Aggregate counts per hour from HOURLY (h, d, kind, n), shifted by TZ_OFFSET.
  const byHour = new Array(24).fill(0);
  const byHourKind = new Array(24).fill(null).map(() => ({ original:0, reply:0, quote:0, rt:0 }));
  const total = HOURLY.n.reduce((a,b)=>a+b, 0);
  for (let i = 0; i < HOURLY.h.length; i++) {
    const sh = shiftHour(HOURLY.h[i], TZ_OFFSET);
    byHour[sh] += HOURLY.n[i];
    byHourKind[sh][HOURLY.kind[i]] += HOURLY.n[i];
  }
  const max = Math.max(...byHour);
  // draw clock background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('r', 90); bg.setAttribute('fill','#131826'); bg.setAttribute('stroke','#232a3d');
  svg.appendChild(bg);
  const mid = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  mid.setAttribute('r', 30); mid.setAttribute('fill','#0a0e1a'); mid.setAttribute('stroke','#232a3d');
  svg.appendChild(mid);

  const colorMap = { original:'#ff5e3a', reply:'#5fc6ff', quote:'#3ecf8e', rt:'#f5c542' };
  const ringMin = 30, ringMax = 90;
  // for each hour, draw stacked sectors
  for (let h = 0; h < 24; h++) {
    const ang0 = ((h / 24) * Math.PI * 2) - Math.PI/2;
    const ang1 = (((h+1) / 24) * Math.PI * 2) - Math.PI/2;
    const fill = byHour[h]/max;
    const r = ringMin + (ringMax-ringMin) * fill;
    const x0 = ringMin*Math.cos(ang0), y0 = ringMin*Math.sin(ang0);
    const x1 = r*Math.cos(ang0),       y1 = r*Math.sin(ang0);
    const x2 = r*Math.cos(ang1),       y2 = r*Math.sin(ang1);
    const x3 = ringMin*Math.cos(ang1), y3 = ringMin*Math.sin(ang1);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x0} ${y0} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${ringMin} ${ringMin} 0 0 0 ${x0} ${y0} Z`);
    path.setAttribute('fill', '#ff5e3a');
    path.setAttribute('opacity', 0.35 + 0.55 * fill);
    path.dataset.h = h;
    path.dataset.n = byHour[h];
    path.dataset.pct = ((byHour[h]/total)*100).toFixed(1);
    path.addEventListener('mouseenter', e => {
      const r = e.target;
      tipEl.textContent = `${r.dataset.h}:00 UTC — ${r.dataset.pct}% of all posts (${(+r.dataset.n).toLocaleString()})`;
      const b = r.getBoundingClientRect();
      tipEl.style.left = (b.left + b.width/2 + window.scrollX) + 'px';
      tipEl.style.top = (b.top + window.scrollY) + 'px';
      tipEl.style.opacity = '1';
    });
    path.addEventListener('mouseleave', tipHide);
    svg.appendChild(path);
  }
  // hour labels
  for (let h = 0; h < 24; h += 3) {
    const ang = (h/24)*Math.PI*2 - Math.PI/2;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', 95*Math.cos(ang)); t.setAttribute('y', 95*Math.sin(ang)+3);
    t.setAttribute('fill', '#8b94a8'); t.setAttribute('font-size','9'); t.setAttribute('text-anchor','middle');
    t.textContent = h;
    svg.appendChild(t);
  }
}

// --- DOW × hour heatmap --------------------------------------------------
function renderDowHm() {
  const el = document.getElementById('dow-hm-container');
  el.innerHTML = '';
  // 7 rows × 24 cols, sum by HOURLY (h, d, kind, n) shifted by TZ_OFFSET.
  const grid = Array.from({length:7}, () => new Array(24).fill(0));
  for (let i = 0; i < HOURLY.h.length; i++) {
    const sh = shiftHour(HOURLY.h[i], TZ_OFFSET);
    const sd = shiftDow(HOURLY.h[i], HOURLY.d[i], TZ_OFFSET);
    grid[sd][sh] += HOURLY.n[i];
  }
  // rotate so Mon is row 0 (DOW: 0=Sun, 1=Mon, ... 6=Sat)
  const orderedNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const orderIdx = [1,2,3,4,5,6,0];
  const max = Math.max(...grid.flat());
  const cellW = 18, cellH = 18, padL = 30, padT = 14;
  const w = padL + 24*cellW + 4, h = padT + 7*cellH + 14;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'hm-svg');
  // hour labels (top)
  for (let x = 0; x < 24; x += 3) {
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', padL + x*cellW + cellW/2); t.setAttribute('y', padT - 4);
    t.setAttribute('fill', '#8b94a8'); t.setAttribute('font-size','9'); t.setAttribute('text-anchor','middle');
    t.textContent = x;
    svg.appendChild(t);
  }
  for (let r = 0; r < 7; r++) {
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', padL - 4); t.setAttribute('y', padT + r*cellH + cellH*0.7);
    t.setAttribute('fill','#8b94a8'); t.setAttribute('font-size','10'); t.setAttribute('text-anchor','end');
    t.textContent = orderedNames[r];
    svg.appendChild(t);
    for (let c = 0; c < 24; c++) {
      const v = grid[orderIdx[r]][c];
      const f = v / max;
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', padL + c*cellW + 1);
      rect.setAttribute('y', padT + r*cellH + 1);
      rect.setAttribute('width', cellW - 2); rect.setAttribute('height', cellH - 2);
      rect.setAttribute('rx', 2);
      // dark blue base, ramp red intensity
      const r2 = Math.round(20 + 220*f), g = Math.round(30 + 60*(1-f)), b = Math.round(50 + 40*(1-f));
      rect.setAttribute('fill', `rgb(${r2},${g},${b})`);
      rect.dataset.label = `${orderedNames[r]} ${c}:00 — ${v.toLocaleString()} posts`;
      rect.addEventListener('mouseenter', e => {
        tipEl.textContent = e.target.dataset.label;
        const b = e.target.getBoundingClientRect();
        tipEl.style.left = (b.left + b.width/2 + window.scrollX)+'px';
        tipEl.style.top  = (b.top + window.scrollY)+'px';
        tipEl.style.opacity = '1';
      });
      rect.addEventListener('mouseleave', tipHide);
      svg.appendChild(rect);
    }
  }
  el.appendChild(svg);
}

// --- Year × hour ("does he sleep") heatmap -------------------------------
function renderYearHour() {
  const el = document.getElementById('year-hour-container');
  el.innerHTML = '';
  // build year→hour→count matrix in UTC, plus a display copy shifted by TZ_OFFSET.
  // Sleep-window inference uses the UTC matrix (it's an intrinsic property of when
  // the posts happened, not of the display rotation).
  const years = [...new Set(YEAR_HOUR.year)].sort();
  const yIdx = Object.fromEntries(years.map((y,i)=>[y,i]));
  const utcGrid = Array.from({length: years.length}, () => new Array(24).fill(0));
  for (let i = 0; i < YEAR_HOUR.year.length; i++) {
    utcGrid[yIdx[YEAR_HOUR.year[i]]][YEAR_HOUR.hour[i]] += YEAR_HOUR.n[i];
  }
  // shifted display grid
  const grid = utcGrid.map(row => {
    const out = new Array(24).fill(0);
    for (let h = 0; h < 24; h++) out[shiftHour(h, TZ_OFFSET)] = row[h];
    return out;
  });
  const utcFrac = utcGrid.map(row => {
    const t = row.reduce((a,b)=>a+b,0) || 1;
    return row.map(n => n/t);
  });
  // normalize per year to fraction
  const frac = grid.map(row => {
    const t = row.reduce((a,b)=>a+b, 0) || 1;
    return row.map(n => n/t);
  });
  // Find each year's "sleep window" — contiguous 6-hour window with min activity.
  // Then guess the local timezone by assuming midpoint of sleep = 3 AM local.
  const SLEEP_LEN = 6;
  function findSleepWindow(row) {
    let best = { start: 0, sum: Infinity };
    for (let s = 0; s < 24; s++) {
      let sum = 0;
      for (let k = 0; k < SLEEP_LEN; k++) sum += row[(s+k) % 24];
      if (sum < best.sum) best = { start: s, sum };
    }
    return best;
  }
  const sleepInfo = utcFrac.map(row => {
    const sw = findSleepWindow(row);            // start is in UTC
    const midUtc = (sw.start + SLEEP_LEN/2) % 24;
    // assume midpoint of sleep = 3:00 AM local → offset = 3 - midUtc
    let off = 3 - midUtc;
    if (off > 12)  off -= 24;
    if (off <= -12) off += 24;
    return { startUtc: sw.start, endUtc: (sw.start+SLEEP_LEN) % 24, midUtc, offset: off };
  });

  const cellW = 22, cellH = 20, padL = 50, padT = 16, padR = 230;
  const w = padL + 24*cellW + padR, h = padT + years.length*cellH + 14;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'hm-svg');
  // top hour labels (now showing offset-shifted hours)
  for (let x = 0; x < 24; x++) {
    if (x%2!==0 && x!==23) continue;
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', padL + x*cellW + cellW/2); t.setAttribute('y', padT - 4);
    t.setAttribute('fill', '#8b94a8'); t.setAttribute('font-size','9'); t.setAttribute('text-anchor','middle');
    t.textContent = x;
    svg.appendChild(t);
  }
  // header for inference column
  const hdr = document.createElementNS('http://www.w3.org/2000/svg','text');
  hdr.setAttribute('x', padL + 24*cellW + 8); hdr.setAttribute('y', padT - 4);
  hdr.setAttribute('fill','#8b94a8'); hdr.setAttribute('font-size','9'); hdr.setAttribute('text-anchor','start');
  hdr.textContent = 'sleep window UTC → inferred TZ';
  svg.appendChild(hdr);

  // rows
  years.forEach((y, ri) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', padL - 4); t.setAttribute('y', padT + ri*cellH + cellH*0.7);
    t.setAttribute('fill','#8b94a8'); t.setAttribute('font-size','10'); t.setAttribute('text-anchor','end');
    t.textContent = y;
    svg.appendChild(t);
    for (let c = 0; c < 24; c++) {
      const f = frac[ri][c];
      const norm = Math.min(1, f / 0.10); // saturate at 10% of year per hour
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', padL + c*cellW + 1);
      rect.setAttribute('y', padT + ri*cellH + 1);
      rect.setAttribute('width', cellW-2); rect.setAttribute('height', cellH-2);
      rect.setAttribute('rx', 2);
      const r = Math.round(20 + 220*norm), g = Math.round(30 + 50*(1-norm)), b = Math.round(50 + 40*(1-norm));
      rect.setAttribute('fill', `rgb(${r},${g},${b})`);
      rect.dataset.label = `${y} ${c}:00 UTC — ${(f*100).toFixed(1)}% of that year's posts (${grid[ri][c]} total)`;
      rect.addEventListener('mouseenter', e => {
        tipEl.textContent = e.target.dataset.label;
        const b = e.target.getBoundingClientRect();
        tipEl.style.left = (b.left + b.width/2 + window.scrollX)+'px';
        tipEl.style.top  = (b.top + window.scrollY)+'px';
        tipEl.style.opacity = '1';
      });
      rect.addEventListener('mouseleave', tipHide);
      svg.appendChild(rect);
    }
    // sleep-window outline (drawn on the shifted display grid).
    const sw = sleepInfo[ri];
    const dispStart = shiftHour(sw.startUtc, TZ_OFFSET);
    const drawStroke = (sCol, eCol) => {
      const r2 = document.createElementNS('http://www.w3.org/2000/svg','rect');
      r2.setAttribute('x', padL + sCol*cellW + 0.5);
      r2.setAttribute('y', padT + ri*cellH + 0.5);
      r2.setAttribute('width', (eCol - sCol)*cellW - 1);
      r2.setAttribute('height', cellH - 1);
      r2.setAttribute('rx', 3);
      r2.setAttribute('fill', 'none');
      r2.setAttribute('stroke', '#5fc6ff');
      r2.setAttribute('stroke-width', '1.5');
      r2.setAttribute('opacity', '0.9');
      r2.setAttribute('pointer-events', 'none');
      svg.appendChild(r2);
    };
    if (dispStart + SLEEP_LEN <= 24) {
      drawStroke(dispStart, dispStart + SLEEP_LEN);
    } else {
      drawStroke(dispStart, 24);
      drawStroke(0, (dispStart + SLEEP_LEN) % 24);
    }
    // inference label (always reported in UTC + inferred TZ, regardless of display rotation)
    const sign = sw.offset >= 0 ? '+' : '−';
    const absOff = Math.abs(sw.offset).toFixed(0);
    const tzGuess = guessTzName(sw.offset);
    const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x', padL + 24*cellW + 8); lbl.setAttribute('y', padT + ri*cellH + cellH*0.7);
    lbl.setAttribute('fill','#5fc6ff'); lbl.setAttribute('font-size','9');
    lbl.textContent = `${sw.startUtc.toString().padStart(2,'0')}–${sw.endUtc.toString().padStart(2,'0')}  →  UTC${sign}${absOff} ${tzGuess}`;
    svg.appendChild(lbl);
  });
  el.appendChild(svg);

  // also publish a summary line below
  const ave = sleepInfo.reduce((a,s)=>a+s.offset,0) / sleepInfo.length;
  const recent = sleepInfo.slice(-3);
  const recentAve = recent.reduce((a,s)=>a+s.offset,0) / recent.length;
  let summary = el.parentNode.querySelector('.tz-summary');
  if (!summary) {
    summary = document.createElement('p');
    summary.className = 'tz-summary muted';
    summary.style.fontSize = '12px';
    summary.style.marginTop = '8px';
    el.parentNode.appendChild(summary);
  }
  summary.innerHTML =
    `<b>Inferred timezone</b>: ` +
    `<b style="color:#e7ecf3">career average UTC${ave>=0?'+':''}${ave.toFixed(1)}</b> ` +
    `· last 3 yrs UTC${recentAve>=0?'+':''}${recentAve.toFixed(1)}. ` +
    `Blue boxes mark each year's lowest‑activity 6‑hour window. ` +
    `<span class="warn">★</span> <span style="color:var(--yellow)">Rough heuristic:</span> assumes a 6‑hour sleep window centered at 3 AM local. Could also signal a meeting block, a flight, or just "log off and go work" hours — not a polysomnogram.`;
}

function guessTzName(off) {
  // Map common offsets to a familiar label.
  const m = {
    [-12]:'IDL', [-11]:'SST', [-10]:'HAST', [-9]:'AKST', [-8]:'PST', [-7]:'PDT/MST',
    [-6]:'CST', [-5]:'EST/CDT', [-4]:'EDT', [-3]:'BRT', [-2]:'GST', [-1]:'AZOT',
    [0]:'UTC/GMT', [1]:'CET', [2]:'CEST/EET', [3]:'EAT/MSK', [4]:'GST', [5]:'PKT',
    [6]:'BST', [7]:'ICT', [8]:'CST‑Asia', [9]:'JST', [10]:'AEST', [11]:'AEDT', [12]:'NZST'
  };
  const k = Math.round(off);
  return m[k] || ('offset '+k);
}

// --- Tweet type composition (stacked area) -------------------------------
let compChart = null;
function renderComposition() {
  const ctx = document.getElementById('chart-composition').getContext('2d');
  const labels = MONTHLY.ym;
  const ds = (key, color, label) => ({
    label, data: MONTHLY[key], backgroundColor: color, borderColor: color, fill: true, pointRadius:0, borderWidth:1, tension: 0.2,
  });
  if (compChart) compChart.destroy();
  compChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      ds('n_reply',    'rgba(95,198,255,0.85)', 'Replies'),
      ds('n_original', 'rgba(255,94,58,0.85)',  'Originals'),
      ds('n_quote',    'rgba(62,207,142,0.85)', 'Quotes'),
      ds('n_rt',       'rgba(245,197,66,0.85)', 'Retweets'),
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked:true, ticks: { color:'#8b94a8', maxTicksLimit:12 }, grid:{ color:'#232a3d' }},
        y: { stacked:true, ticks: { color:'#8b94a8' }, grid:{ color:'#232a3d' }, title:{ display:true, text:'posts / month', color:'#8b94a8'} }
      },
      plugins: { legend: { labels: { color:'#e7ecf3' } } }
    }
  });
}

// --- Monthly time bar chart ----------------------------------------------
let monthlyChart = null;
function renderMonthly() {
  // For each month: sum sessionTimeSec for sessions in that month
  const labels = [];
  const hours = [];
  const monthsSorted = [...MONTH_INDEX.keys()].sort();
  monthsSorted.forEach(ym => {
    labels.push(ym);
    let s = 0; MONTH_INDEX.get(ym).forEach(i => s += sessionTimeSec(i));
    hours.push(+(s/3600).toFixed(2));
  });
  const ctx = document.getElementById('chart-monthly').getContext('2d');
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{
      label: 'Hours on Twitter / month',
      data: hours,
      backgroundColor: ctxBar => {
        const v = ctxBar.parsed?.y ?? 0;
        if (v > 200) return '#ff2222';
        if (v > 100) return '#ff8a3a';
        if (v > 50)  return '#f5c542';
        return '#5fc6ff';
      }
    }]},
    options: {
      responsive: true, maintainAspectRatio:false,
      scales: {
        x: { ticks:{ color:'#8b94a8', maxTicksLimit:14 }, grid:{ color:'#232a3d' } },
        y: { ticks:{ color:'#8b94a8', callback:v=>v+'h' }, grid:{ color:'#232a3d' } }
      },
      plugins: {
        legend: { labels: { color:'#e7ecf3' } },
        tooltip: { callbacks: { label: c => `${c.parsed.y} h (${(c.parsed.y/24/30*100).toFixed(1)}% of waking month)` } }
      }
    }
  });
}

// --- Top sessions table --------------------------------------------------
function renderTopSessions() {
  const tbody = document.querySelector('#top-sessions tbody');
  tbody.innerHTML = '';
  const n = TOP_SESS.start_iso.length;
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${TOP_SESS.start_iso[i]}</td>
      <td class="num">${(TOP_SESS.span_sec[i]/60).toFixed(0)} min</td>
      <td class="num">${TOP_SESS.n_total[i]}</td>
      <td class="num">${TOP_SESS.n_original[i]}</td>
      <td class="num">${TOP_SESS.n_reply[i]}</td>
      <td class="num">${TOP_SESS.n_quote[i]}</td>
      <td class="num">${TOP_SESS.tweets_per_min[i]}</td>
      <td class="num">${fmtN(TOP_SESS.chars[i])}</td>`;
    tbody.appendChild(tr);
  }
}

// --- Top days bar chart --------------------------------------------------
let topDaysChart = null;
function renderTopDays() {
  const ctx = document.getElementById('chart-top-days').getContext('2d');
  if (topDaysChart) topDaysChart.destroy();
  topDaysChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: TOP_DAYS.day, datasets: [{
      label: 'Posts on this day', data: TOP_DAYS.n, backgroundColor: '#ff5e3a'
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: { ticks:{ color:'#8b94a8' }, grid:{ color:'#232a3d' } },
        y: { ticks:{ color:'#8b94a8' }, grid:{ color:'#232a3d' } }
      },
      plugins: { legend: { labels: { color:'#e7ecf3' } } }
    }
  });
}

// --- Initial copy on hero ------------------------------------------------
function renderHero() {
  document.getElementById('hero-n').textContent = META.total_tweets.toLocaleString();
  document.getElementById('hero-range').textContent = META.min_date + ' → ' + META.max_date;
  document.getElementById('meta-n').textContent = META.total_tweets.toLocaleString();
  document.getElementById('meta-range').textContent = META.min_date + ' → ' + META.max_date;
  const archS = document.getElementById('arch-n-sessions');
  const archT = document.getElementById('arch-n-tweets');
  if (archS) archS.textContent = META.n_sessions.toLocaleString();
  if (archT) archT.textContent = META.total_tweets.toLocaleString();
}

// --- Anchoring breakdown card --------------------------------------------
function renderAnchoring() {
  const a = computeAnchoring();
  const el = document.getElementById('anchoring');
  if (!el) return;
  const spanPct = (a.pctSpan*100).toFixed(0);
  const postPct = (a.pctPosts*100).toFixed(0);
  const edgePct = (a.pctEdge*100).toFixed(0);
  const fmtH = sec => (sec/3600).toFixed(0)+'h';
  el.innerHTML = `
    <div style="display:flex; gap:0; height:14px; border-radius:6px; overflow:hidden; margin:8px 0;">
      <div style="background:#5fc6ff; width:${spanPct}%" title="span anchored"></div>
      <div style="background:#ff8a3a; width:${postPct}%" title="post-cost anchored"></div>
      <div style="background:#3ecf8e; width:${edgePct}%" title="edge_pad"></div>
    </div>
    <div style="display:flex; gap:24px; flex-wrap:wrap; font-size:13px;">
      <span><span style="display:inline-block; width:10px; height:10px; background:#5fc6ff; border-radius:2px; margin-right:5px"></span><b>${spanPct}%</b> wall‑clock spans <span class="muted">(${fmtH(a.timeFromSpan)} · ${a.nSpanAnchored.toLocaleString()} sessions)</span></span>
      <span><span style="display:inline-block; width:10px; height:10px; background:#ff8a3a; border-radius:2px; margin-right:5px"></span><b>${postPct}%</b> per‑post sliders <span class="muted">(${fmtH(a.timeFromPosts)} · ${a.nPostAnchored.toLocaleString()} sessions)</span></span>
      <span><span style="display:inline-block; width:10px; height:10px; background:#3ecf8e; border-radius:2px; margin-right:5px"></span><b>${edgePct}%</b> edge padding <span class="muted">(${fmtH(a.timeFromEdge)} across all ${N_SESS.toLocaleString()} sessions)</span></span>
    </div>
    <p class="muted" style="font-size:12px; margin-top:10px; line-height:1.5;">
      <b style="color:var(--ink)">Span</b> = the gap between his first and last post in a session — pure timestamp evidence. <b style="color:var(--ink)">Per‑post</b> = read+think+type+send for each tweet, dominates only in tight bursts. <b style="color:var(--ink)">Edge</b> = open‑app + glance‑at‑notifs at the start and end of every session, applied unconditionally. Move the <code>session_gap</code> slider to change what counts as "the same session" and watch the shares shift.
    </p>`;
}

// --- Master rerender ------------------------------------------------------
function rerender() {
  const H = computeHeadlines();
  renderHeadline(H);
  renderDaily(H);
  renderCalendar(H);
  renderMonthly();
  renderAnchoring();
}
function renderStaticOnce() {
  renderHero();
  renderComposition();
  renderTopSessions();
  renderTopDays();
}
function renderTimezoneSensitive() {
  renderClock();
  renderDowHm();
  renderYearHour();
}

// --- Timezone button wiring ----------------------------------------------
document.querySelectorAll('#tz-buttons button.preset').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#tz-buttons button.preset').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    TZ_OFFSET = +b.dataset.tz;
    renderTimezoneSensitive();
  });
});

renderStaticOnce();
renderTimezoneSensitive();
rerender();

})();
