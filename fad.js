'use strict';
// ════════════════════════════════════════════════════════════════════════
//  Free Agent Draft — shared engine for index.html (control) + display.html (OBS)
//  · MLB StatsAPI free-agent feed, awards and WAR (control only)
//  · snake-draft math
//  · stage renderer: pick reveal, draft board, on-the-clock bug
//  · transport: Jomboy Cloudflare relay + BroadcastChannel
//  The wire carries names and ids, so the display never has to load the pool.
// ════════════════════════════════════════════════════════════════════════
const FAD = (() => {
  const API = 'https://statsapi.mlb.com/api/v1';
  const HUB_DEFAULT = 'https://jomboy-relay.jomboymedia.workers.dev';

  // id: [abbr, colour, city, nickname]
  const TEAMS = {
    108: ['LAA', '#BA0021', 'Los Angeles', 'Angels'], 109: ['AZ', '#A71930', 'Arizona', 'Diamondbacks'],
    110: ['BAL', '#DF4601', 'Baltimore', 'Orioles'], 111: ['BOS', '#BD3039', 'Boston', 'Red Sox'],
    112: ['CHC', '#0E3386', 'Chicago', 'Cubs'], 113: ['CIN', '#C6011F', 'Cincinnati', 'Reds'],
    114: ['CLE', '#0C2340', 'Cleveland', 'Guardians'], 115: ['COL', '#33006F', 'Colorado', 'Rockies'],
    116: ['DET', '#0C2340', 'Detroit', 'Tigers'], 117: ['HOU', '#002D62', 'Houston', 'Astros'],
    118: ['KC', '#004687', 'Kansas City', 'Royals'], 119: ['LAD', '#005A9C', 'Los Angeles', 'Dodgers'],
    120: ['WSH', '#AB0003', 'Washington', 'Nationals'], 121: ['NYM', '#002D72', 'New York', 'Mets'],
    133: ['ATH', '#003831', '', 'Athletics'], 134: ['PIT', '#27251F', 'Pittsburgh', 'Pirates'],
    135: ['SD', '#2F241D', 'San Diego', 'Padres'], 136: ['SEA', '#0C2C56', 'Seattle', 'Mariners'],
    137: ['SF', '#27251F', 'San Francisco', 'Giants'], 138: ['STL', '#C41E3A', 'St. Louis', 'Cardinals'],
    139: ['TB', '#092C5C', 'Tampa Bay', 'Rays'], 140: ['TEX', '#003278', 'Texas', 'Rangers'],
    141: ['TOR', '#134A8E', 'Toronto', 'Blue Jays'], 142: ['MIN', '#002B5C', 'Minnesota', 'Twins'],
    143: ['PHI', '#E81828', 'Philadelphia', 'Phillies'], 144: ['ATL', '#13274F', 'Atlanta', 'Braves'],
    145: ['CWS', '#27251F', 'Chicago', 'White Sox'], 146: ['MIA', '#00A3E0', 'Miami', 'Marlins'],
    147: ['NYY', '#0C2340', 'New York', 'Yankees'], 158: ['MIL', '#12284B', 'Milwaukee', 'Brewers'],
  };
  const TEAM_IDS = Object.keys(TEAMS).map(Number).sort((a, b) => TEAMS[a][0].localeCompare(TEAMS[b][0]));
  const team = id => TEAMS[id] ? { id: +id, abbr: TEAMS[id][0], color: TEAMS[id][1], city: TEAMS[id][2], nick: TEAMS[id][3] }
    : { id: 0, abbr: 'FA', color: '#2a3b4c', city: '', nick: 'Free Agent' };
  const logo = id => `https://www.mlbstatic.com/team-logos/${id}.svg`;
  const headshot = (id, w = 426) => `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_${w},q_auto:best/v1/people/${id}/headshot/silo/current`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = (u) => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

  // ── snake draft: 1,2,3,4,4,3,2,1 ──
  function slot(n, order) {
    const nd = order.length, r = Math.floor(n / nd), i = n % nd;
    return { round: r + 1, inRound: i + 1, d: order[r % 2 ? nd - 1 - i : i] };
  }
  const total = S => S.order.length * S.rounds;
  const yrsText = y => y ? `${y} YEAR${y == 1 ? '' : 'S'}` : '';
  // scoring bonuses (only with the right team): +5 for a major award (Cy Young, MVP, ROY), +5 for an All-Star this past season
  const TAGS = { MVP: 'Former MVP', CY: 'Former Cy Young', ROY: 'Former ROY', AS: 'All-Star' };

  // ════════════════════════════════════════════════════════════════════
  //  DATA — the free-agent pool (control page only)
  // ════════════════════════════════════════════════════════════════════
  // a traded player has one split per team plus a total with no team — use the total
  const totalSplit = st => st && ((st.splits || []).find(sp => !sp.team) || (st.splits || [])[0])?.stat;
  const statOf = (p, type, group) => totalSplit((p.stats || []).find(s => s.type?.displayName === type && s.group?.displayName === group));

  // career superlatives off MLB's award history, most prestigious first
  function resume(aw) {
    const yrs = re => [...new Set(aw.filter(a => re.test(a.id)).map(a => +a.season))].sort((a, b) => a - b);
    const out = [];
    const add = (re, one, many) => { const y = yrs(re); if (y.length) out.push(y.length === 1 ? `${y[0]} ${one}` : `${y.length}× ${many || one}`); };
    add(/^(AL|NL)MVP$/, 'MVP');
    add(/^(AL|NL)CY$/, 'Cy Young');
    add(/^WSMVP$/, 'World Series MVP');
    add(/^(AL|NL)ROY$/, 'Rookie of the Year');
    add(/^(AL|NL)AS$/, 'All-Star');
    add(/^WSCHAMP$/, 'World Series champ');
    add(/^(AL|NL)PG$/, 'Platinum Glove');
    add(/^(AL|NL)GG$/, 'Gold Glove');
    add(/^(AL|NL)SS$/, 'Silver Slugger');
    add(/^(AL|NL)HAA$/, 'Hank Aaron Award');
    add(/^(AL|NL)CSMVP$/, 'LCS MVP');
    return out;
  }
  // one line of the season he just had
  function seasonLine(p, pitcher, season) {
    const h = statOf(p, 'season', 'hitting'), pi = statOf(p, 'season', 'pitching');
    const parts = [];
    if (pitcher && pi && pi.gamesPlayed) {
      const rp = (pi.gamesStarted || 0) * 2 < (pi.gamesPlayed || 0);
      if (!rp) parts.push(`${pi.wins}-${pi.losses}`);
      parts.push(`${pi.era} ERA`);
      if (rp && pi.saves >= 5) parts.push(`${pi.saves} SV`);
      parts.push(rp ? `${pi.inningsPitched} IP` : `${pi.strikeOuts} K`);
    } else if (h && h.gamesPlayed) {
      parts.push(h.avg, `${h.homeRuns} HR`);
      if (h.stolenBases >= 15) parts.push(`${h.stolenBases} SB`); else parts.push(`${h.rbi} RBI`);
    } else return '';
    return parts.join(' · ');
  }
  function toRecord(p, meta = {}, season) {
    let war = null;
    for (const s of p.stats || []) if (s.type?.displayName === 'sabermetrics') { const w = totalSplit(s)?.war; if (w != null) war = (war || 0) + w; }
    const tags = [];
    const aw = p.awards || [];
    if (aw.some(a => /^(AL|NL)MVP$/.test(a.id))) tags.push('MVP');
    if (aw.some(a => /^(AL|NL)CY$/.test(a.id))) tags.push('CY');
    if (aw.some(a => /^(AL|NL)ROY$/.test(a.id))) tags.push('ROY');
    if (aw.some(a => /^(AL|NL)AS$/.test(a.id) && +a.season === season)) tags.push('AS');
    const pitcher = p.primaryPosition?.type === 'Pitcher';
    let pos = meta.pos && meta.pos !== 'P' ? meta.pos : p.primaryPosition?.abbreviation || '';
    if (pos === 'P') {                       // MLB often just says "P" — call it from how he was used this year
      const pi = statOf(p, 'season', 'pitching');
      if (pi && pi.gamesPlayed) pos = (pi.gamesStarted || 0) * 2 >= pi.gamesPlayed ? 'SP' : 'RP';
    }
    return {
      id: p.id, first: p.useName || p.firstName, last: (p.useLastName || p.lastName || '').replace(/ (Jr|Sr)\.?$/, ''),
      name: p.fullName, pos: pos === 'TWP' ? 'TWO-WAY' : pos, pitcher, age: p.currentAge,
      from: meta.from || p.currentTeam?.id || 0, war: war == null ? null : Math.round(war * 10) / 10, tags,
      note: meta.note || '', fa: !!meta.fa, sup: resume(aw),
      line: seasonLine(p, pitcher, season), lineYr: season,
    };
  }
  async function hydrate(ids, metaById, season) {
    const out = [];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const d = await getJSON(`${API}/people?personIds=${chunk.join(',')}&hydrate=awards,currentTeam,stats(group=[hitting,pitching],type=[season,sabermetrics],season=${season})`)
        .catch(() => ({ people: [] }));
      for (const p of d.people || []) out.push(toRecord(p, metaById[p.id], season));
    }
    return out;
  }
  async function loadPool(season, onStatus = () => {}) {
    onStatus('Loading the free agent list…');
    const fa = await getJSON(`${API}/people/freeAgents?season=${season}`);
    const meta = {};
    for (const f of fa.freeAgents || []) {
      if (/minor/i.test(f.notes || '') || f.newTeam?.id) continue;  // minor-leaguers, and anyone already signed / claimed / re-upped
      meta[f.player.id] = { fa: true, from: f.originalTeam?.id || 0, note: f.notes || '', pos: f.position?.abbreviation };
    }
    const ids = Object.keys(meta).map(Number);
    onStatus(`Loading ${ids.length} free agents…`);
    const pool = await hydrate(ids, meta, season);
    await backfillLines(pool, season);
    onStatus('');
    return pool;
  }
  // hurt / didn't pitch this year: show the last season he actually played instead of a blank
  async function backfillLines(recs, season) {
    for (const back of [1, 2]) {
      const miss = recs.filter(r => !r.line);
      if (!miss.length) return;
      const y = season - back;
      for (let i = 0; i < miss.length; i += 40) {
        const d = await getJSON(`${API}/people?personIds=${miss.slice(i, i + 40).map(r => r.id).join(',')}&hydrate=stats(group=[hitting,pitching],type=[season],season=${y})`).catch(() => ({ people: [] }));
        for (const p of d.people || []) {
          const r = miss.find(x => x.id === p.id), line = r && seasonLine(p, r.pitcher, y);
          if (line) { r.line = line; r.lineYr = y; }
        }
      }
    }
    recs.forEach(r => { if (!r.line) { r.line = 'No recent MLB stats'; r.lineYr = null; } });
  }
  // final regular-season standings: id -> { rec: '98-64', fin: '1st AL East', post: true }
  async function loadStandings(season) {
    const d = await getJSON(`${API}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=division`);
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
    const out = {};
    for (const r of d.records || []) for (const t of r.teamRecords || [])
      out[t.team.id] = { rec: `${t.wins}-${t.losses}`, fin: `${ord(+t.divisionRank)} ${r.division?.nameShort || ''}`.trim(), post: !!t.clinchIndicator,
        lg: r.league?.id === 103 ? 'American League' : r.league?.id === 104 ? 'National League' : '' };
    return out;
  }
  async function search(q, season) {
    const d = await getJSON(`${API}/people/search?names=${encodeURIComponent(q)}&sportIds=1&active=true`).catch(() => ({ people: [] }));
    const ids = (d.people || []).slice(0, 10).map(p => p.id);
    if (!ids.length) return [];
    const recs = await hydrate(ids, {}, season);
    await backfillLines(recs, season);
    return recs;
  }

  // ════════════════════════════════════════════════════════════════════
  //  STAGE
  // ════════════════════════════════════════════════════════════════════
  const ARROW = `<svg viewBox="-4 -4 336 140" class="rv-arrow"><path class="sh" d="M10,52 L214,52 L214,10 L330,72 L214,134 L214,92 L10,92 Z"/><path class="ar" d="M0,42 L204,42 L204,0 L320,62 L204,124 L204,82 L0,82 Z"/></svg>`;
  const MINI = c => `<svg viewBox="0 0 30 20"><path d="M0,7 L18,7 L18,1 L30,10 L18,19 L18,13 L0,13 Z" fill="${c}"/></svg>`;

  // stage positions; the strip board defaults to the lower part of the right-hand (Jake) cam box on the TB two-shot
  const LAY_DEFAULT = { rx: 960, ry: 980, rs: 0.9, bx: 960, by: 40, bs: 1, sx: 958, sy: 704, ss: 1, ck: 'tl' };

  function createStage(host) {
    const el = document.createElement('div');
    el.className = 'fad';
    el.innerHTML = `<div class="backdrop"></div>
      <div class="bs"><div class="bs-top"><b></b><span><small></small><em></em></span></div><div class="bs-grid"></div></div>
      <div class="bd"><div class="bd-top"><div class="t"><b></b><span></span></div><div class="ct"><small></small><b></b></div></div><div class="bd-body"><div class="bd-grid"></div></div></div>
      <div class="rv">
        <div class="rv-head"><div class="rp"></div><div class="who"><span></span></div></div>
        <div class="rv-player"><div class="rv-tile"><img alt=""></div><div class="rv-plate"><div class="fn"></div><div class="ln"></div><div class="meta"></div><div class="st"><small></small><span></span></div><div class="sup"></div></div></div>
        <div class="rv-mid"><div class="rv-verb"><span></span></div>${ARROW}<div class="rv-stamp"><b></b><span></span><small></small></div></div>
        <div class="rv-team"><div class="rv-tile q">?</div><div class="rv-tile lg"><img alt=""></div><div class="rv-plate"><div class="fn"></div><div class="ln"></div><div class="meta"></div><div class="st"><small></small><span></span></div><div class="sup"></div></div></div>
      </div>
      <div class="ck"><div class="bx"><small>ON THE CLOCK</small><b></b></div><div class="pk"><small></small><b></b></div></div>`;
    host.appendChild(el);
    const $ = s => el.querySelector(s);
    const rv = $('.rv'), bd = $('.bd'), bs = $('.bs'), ck = $('.ck');
    let bsSig = '', bsLast = 0;
    let rvKey = '', rvStage = -1, bdSig = '', lastPicks = 0;

    function fitText(node, max) {           // shrink long last names to the plate
      node.style.fontSize = '';
      const w = node.clientWidth || 0;
      if (!w) return;
      let fs = parseFloat(getComputedStyle(node).fontSize);
      while (node.scrollWidth > w && fs > max * .5) { fs -= 2; node.style.fontSize = fs + 'px'; }
    }

    // board names: shrink the type to a floor, then squeeze sideways — never cut a name off
    function fitNames(root) {
      root.querySelectorAll('b > span').forEach(sp => {
        const box = sp.parentElement, w = box.clientWidth;
        sp.style.fontSize = ''; sp.style.transform = '';
        if (!w) return;
        let fs = parseFloat(getComputedStyle(sp).fontSize);
        const floor = fs * .72;
        while (sp.offsetWidth > w && fs > floor) { fs -= .5; sp.style.fontSize = fs + 'px'; }
        if (sp.offsetWidth > w) sp.style.transform = `scaleX(${(w / sp.offsetWidth).toFixed(3)})`;
      });
    }
    const refit = () => { fitNames($('.bs-grid')); fitNames($('.bd-grid')); };
    document.fonts && document.fonts.ready.then(refit);

    function renderReveal(S) {
      const c = S.cur, on = S.view === 'reveal' && c && S.stage > 0;
      const L = S.lay;
      rv.style.left = (L.rx - 830) + 'px';
      rv.style.top = (L.ry - 360) + 'px';
      rv.style.transform = `scale(${L.rs})`;
      if (!on) { if (rvStage > 0) rv.classList.add('gone'); rvStage = 0; return; }
      const key = `${c.id}|${c.n}`;
      const fresh = key !== rvKey || rvStage <= 0;
      const d = S.ds[c.d] || { name: '?', color: '#e9b949' };
      const from = team(c.from), to = team(c.to);
      $('.rv-head .rp').textContent = `Round ${c.round} · Pick ${c.n + 1}`;
      $('.rv-head .who span').textContent = `${d.name}'s pick`;
      $('.rv-player .rv-tile').style.setProperty('--tc', from.color);
      const img = $('.rv-player img');
      if (img.dataset.id != c.id) { img.dataset.id = c.id; img.src = headshot(c.id, 426); }
      $('.rv-player .fn').textContent = c.first || '';
      $('.rv-player .ln').textContent = c.last || c.name || '';
      $('.rv-player .meta').textContent = [c.pos, c.age ? `Age ${c.age}` : '', from.id ? `Last: ${from.abbr}` : ''].filter(Boolean).join(' · ');
      $('.rv-player .st small').textContent = c.lineYr === undefined ? c.season || '' : c.lineYr || '';
      $('.rv-player .st span').textContent = c.line || '';
      $('.rv-player .sup').innerHTML = (c.war != null ? `<em class="war">${(+c.war).toFixed(1)} WAR</em>` : '') + (c.sup || []).map(t => `<em>${esc(t)}</em>`).join('');
      const tr = c.toRec || {};
      $('.rv-team .meta').textContent = tr.lg || '';
      $('.rv-team .st small').textContent = tr.rec ? c.season || '' : '';
      $('.rv-team .st span').textContent = tr.rec ? `${tr.rec} · ${tr.fin}` : '';
      $('.rv-team .sup').innerHTML = tr.post ? '<em>Postseason team</em>' : '';
      const stays = c.to && c.to === c.from;
      $('.rv-verb').classList.toggle('stay', stays);
      $('.rv-verb span').textContent = stays ? 'Stays with' : 'Signs with';
      $('.rv-team .lg').style.setProperty('--tc2', to.color);
      const li = $('.rv-team .lg img');
      if (li.dataset.id != c.to) { li.dataset.id = c.to; li.src = c.to ? logo(c.to) : ''; }
      $('.rv-team .fn').textContent = to.city;
      $('.rv-team .ln').textContent = to.nick;
      $('.rv-stamp b').textContent = c.yrs || '?';
      $('.rv-stamp span').textContent = c.yrs == 1 ? 'YEAR' : 'YEARS';
      $('.rv-stamp small').textContent = c.yrsNote || '';
      $('.rv-stamp small').style.display = c.yrsNote ? '' : 'none';
      const want = 's' + Math.min(3, S.stage);
      if (fresh) {
        rv.className = 'rv';
        void rv.offsetWidth;                 // restart the entrance
      } else rv.classList.remove('gone', 's1', 's2', 's3');
      rv.classList.add(want);
      rvKey = key; rvStage = S.stage;
      requestAnimationFrame(() => {
        fitText($('.rv-player .ln'), 58); fitText($('.rv-team .ln'), 58);
        // one row of superlatives: drop whatever doesn't fit (they're ordered best-first)
        const sup = $('.rv-player .sup'), w = sup.clientWidth;
        [...sup.children].forEach(e => { if (w && e.offsetLeft + e.offsetWidth > w + 1) e.remove(); });
      });
    }

    function cellHTML(p, n, S, isClock) {
      const no = `#${n + 1}`;
      if (!p) return isClock ? `<div class="cell clock"><span class="no">ON THE CLOCK</span></div>` : `<div class="cell empty"><span class="no">${no}</span></div>`;
      const from = team(p.from), to = team(p.to), stays = p.to && p.to === p.from;
      return `<div class="cell filled${n === S.picks.length - 1 && S.picks.length > lastPicks ? ' fresh' : ''}" style="--acc:${esc(S.ds[p.d]?.color)}">
        <div class="hs" style="--tc:${from.color}"><img src="${headshot(p.id, 180)}" alt=""></div>
        <div class="nm"><b><span>${esc(p.last || p.name)}</span></b><span>${esc(p.pos)}${from.id ? ' · ' + from.abbr : ''}</span></div>
        <div class="to">${MINI('#c8102e')}<div class="lg">${p.to ? `<img src="${logo(p.to)}" alt="">` : ''}</div></div>
        <span class="no">${no}</span>${stays ? '<span class="stay">STAYS</span>' : ''}
        ${p.yrs ? `<span class="yr">${p.yrs} YR${p.yrs == 1 ? '' : 'S'}</span>` : ''}
      </div>`;
    }

    // who drafts where: each contestant's picks in order, plus the overall pick number of every slot they own
    function columns(S) {
      const N = total(S);
      const cols = S.order.map(d => ({ d, picks: [], nums: [] }));
      for (let n = 0; n < N; n++) { const s = slot(n, S.order); cols.find(c => c.d === s.d).nums.push(n); }
      S.picks.forEach(p => { const c = cols.find(c => c.d === p.d); if (c) c.picks.push(p); });
      return cols;
    }

    // ── wide, short board: one row per contestant, picks running left to right ──
    function stripCell(p, n, S, isClock) {
      if (!p) return isClock ? `<div class="sc clock"><span>ON THE<br>CLOCK</span></div>` : `<div class="sc empty"><span>#${n + 1}</span></div>`;
      const from = team(p.from), stays = p.to && p.to === p.from;
      return `<div class="sc filled${n === S.picks.length - 1 && S.picks.length > bsLast ? ' fresh' : ''}${stays ? ' stays' : ''}">
        <div class="ic"><div class="hs" style="--tc:${from.color}"><img src="${headshot(p.id, 120)}" alt=""></div>${MINI('#c8102e')}<div class="lg">${p.to ? `<img src="${logo(p.to)}" alt="">` : ''}</div></div>
        <b><span>${esc(p.last || p.name)}</span></b><u>#${n + 1}</u>${p.yrs ? `<i>${p.yrs}Y</i>` : ''}</div>`;
    }
    function renderStrip(S) {
      const on = S.view === 'board' && S.bstyle !== 'full';
      bs.classList.toggle('on', on);
      bs.style.left = S.lay.sx + 'px'; bs.style.top = S.lay.sy + 'px';
      bs.style.transform = `scale(${S.lay.ss})`;
      const sig = JSON.stringify([S.ds, S.order, S.rounds, S.picks, S.title, S.focus]);
      if (sig === bsSig) return;
      bsSig = sig;
      const N = total(S), next = S.picks.length, nx = next < N ? slot(next, S.order) : null;
      const cols = columns(S), solo = S.focus >= 0 && cols.find(c => c.d === S.focus);
      $('.bs-top b').textContent = solo ? `${S.ds[solo.d].name}'s board` : (S.title || 'Free Agent Draft');
      $('.bs-top small').textContent = nx ? `PICK ${next + 1} OF ${N} · ON THE CLOCK` : `${N} PICKS`;
      $('.bs-top em').textContent = nx ? (S.ds[nx.d]?.name || '') : 'DONE';
      const grid = $('.bs-grid');
      bs.classList.toggle('solo', !!solo);
      if (solo) {
        grid.style.gridTemplateColumns = `repeat(${Math.ceil(S.rounds / 2)}, 1fr)`;
        grid.innerHTML = solo.nums.map((n, r) => stripCell(solo.picks[r], n, S, n === next)).join('');
      } else {
        grid.style.gridTemplateColumns = `118px repeat(${S.rounds}, 1fr)`;
        grid.innerHTML = cols.map(c => `<div class="sn${nx && nx.d === c.d ? ' up' : ''}">${esc(S.ds[c.d].name)}</div>` +
          c.nums.map((n, r) => stripCell(c.picks[r], n, S, n === next)).join('')).join('');
      }
      bsLast = S.picks.length;
      fitNames(grid);
    }

    function renderBoard(S) {
      const on = S.view === 'board' && S.bstyle === 'full';
      bd.classList.toggle('on', on);
      bd.style.left = S.lay.bx + 'px';
      bd.style.top = S.lay.by + 'px';
      bd.style.transform = `translateX(-50%) scale(${S.lay.bs})`;
      const sig = JSON.stringify([S.ds, S.order, S.rounds, S.picks, S.title, S.sub, S.focus]);
      if (sig === bdSig) return;
      bdSig = sig;
      const N = total(S), next = S.picks.length;
      const nx = next < N ? slot(next, S.order) : null;
      $('.bd-top .t b').textContent = S.title || 'Free Agent Draft';
      $('.bd-top .t span').textContent = S.sub || '';
      $('.bd-top .ct small').textContent = nx ? `PICK ${next + 1} OF ${N} · ON THE CLOCK` : `${N} PICKS`;
      $('.bd-top .ct b').textContent = nx ? (S.ds[nx.d]?.name || '') : 'Draft complete';
      const cols = columns(S);
      const grid = $('.bd-grid');
      const solo = S.focus >= 0 && cols.find(c => c.d === S.focus);
      bd.classList.toggle('solo', !!solo);
      if (solo) {
        grid.style.gridTemplateColumns = '1fr 1fr';
        const d = S.ds[solo.d];
        grid.innerHTML = `<div class="bd-col" style="--acc:${esc(d.color)};grid-column:1/-1">${esc(d.name)}'s board<small>${solo.picks.length} OF ${S.rounds} PICKS</small></div>` +
          solo.nums.map((n, r) => cellHTML(solo.picks[r], n, S, n === next)).join('');
      } else {
        grid.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
        let h = cols.map((c, i) => `<div class="bd-col" style="--acc:${esc(S.ds[c.d].color)}">${esc(S.ds[c.d].name)}<small>${i + 1}</small></div>`).join('');
        for (let r = 0; r < S.rounds; r++) h += cols.map(c => cellHTML(c.picks[r], c.nums[r], S, c.nums[r] === next)).join('');
        grid.innerHTML = h;
      }
      lastPicks = S.picks.length;
      fitNames(grid);
    }

    function renderClock(S) {
      const N = total(S), next = S.picks.length;
      const on = S.clock && next < N && S.view !== 'board';
      ck.classList.toggle('on', on);
      const pos = S.lay.ck || 'tl', m = 40;
      ck.style.left = pos[1] === 'l' ? m + 'px' : ''; ck.style.right = pos[1] === 'r' ? m + 'px' : '';
      ck.style.top = pos[0] === 't' ? m + 'px' : ''; ck.style.bottom = pos[0] === 'b' ? m + 'px' : '';
      ck.style.transform = on ? '' : '';
      if (next >= N) return;
      const s = slot(next, S.order), d = S.ds[s.d] || {};
      $('.ck .bx b').textContent = d.name || '';
      $('.ck .pk small').textContent = `RD ${s.round} · PK ${s.inRound}`;
      $('.ck .pk b').textContent = `#${next + 1}`;
    }

    function render(S) {
      el.classList.toggle('paper', S.bg === 'paper');
      S.lay = { ...LAY_DEFAULT, ...(S.lay || {}) };
      renderBoard(S);
      renderStrip(S);
      renderReveal(S);
      renderClock(S);
    }
    return { el, render };
  }

  // ════════════════════════════════════════════════════════════════════
  //  TRANSPORT — Jomboy relay (WebSocket push + stored state) and BroadcastChannel
  // ════════════════════════════════════════════════════════════════════
  function hubOf(params) { return (params.get('hub') || HUB_DEFAULT).replace(/\/$/, ''); }
  function publisher(hub, getRoom, onStatus) {
    let bc = null, bcRoom = null, inflight = 0;
    return async payload => {
      const room = getRoom();
      if (bcRoom !== room) { try { bc && bc.close(); bc = new BroadcastChannel('fad-' + room); bcRoom = room; } catch { bc = null; } }
      try { bc && bc.postMessage(payload); } catch {}
      const my = ++inflight;
      onStatus('sending…', '');
      try {
        const r = await fetch(`${hub}/r/${encodeURIComponent(room)}`, { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(6000) });
        const j = await r.json().catch(() => ({}));
        if (my !== inflight) return;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        onStatus(`on air · ${j.sent ?? 0} screen${j.sent === 1 ? '' : 's'} listening`, 'ok');
      } catch {
        if (my === inflight) onStatus('relay unreachable — OBS will not update', 'bad');
      }
    };
  }
  async function fetchRoom(hub, room) {
    const r = await fetch(`${hub}/r/${encodeURIComponent(room)}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const t = await r.text();
    return t && t !== 'null' ? JSON.parse(t) : null;
  }
  function subscribe(hub, room, apply) {
    try { new BroadcastChannel('fad-' + room).onmessage = e => apply(e.data); } catch {}
    const url = `${hub}/r/${encodeURIComponent(room)}`;
    let backoff = 2000;
    const open = () => {
      try {
        const ws = new WebSocket(url.replace(/^http/, 'ws'));
        ws.onopen = () => { backoff = 2000; };
        ws.onmessage = ev => { try { apply(JSON.parse(ev.data)); } catch {} };
        ws.onclose = () => { setTimeout(open, backoff); backoff = Math.min(backoff * 2, 30000); };
      } catch { setTimeout(open, backoff); }
    };
    open();
    // slow safety net for networks that eat the WebSocket upgrade; seq makes repeats harmless
    const poll = () => fetchRoom(hub, room).then(apply).catch(() => {});
    poll();
    setInterval(poll, 30000);
  }

  return { LAY_DEFAULT, loadStandings, TEAMS, TEAM_IDS, team, logo, headshot, esc, slot, total, yrsText, TAGS, loadPool, search, createStage, hubOf, publisher, subscribe, fetchRoom };
})();
