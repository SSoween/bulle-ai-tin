'use strict';
/* Bulle-AI-tin : lecteur de rapports JSON (schéma v2, voir schema.json), produits par Janus ou Claude. Aucun appel externe, aucune clé.
   Tout le texte est inséré via textContent / nœuds DOM (pas d'innerHTML) : un JSON collé ne peut pas injecter de code.
   Règle produit : toute mention de modèle s'écrit {{org/Nom}} dans le JSON ; l'app la rend en lien Hugging Face + propriétaire,
   à partir du registre "models" du rapport. Un jeton sans entrée dans le registre est signalé « sans lien HF ». */

const KEY = 'bulletin.reports.v1';
const MAX_STORED = 180;
const LV = [
  { k: 'N0', n: 'SAIN', t: 'Valorisations cohérentes avec les revenus' },
  { k: 'N1', n: 'ÉCHAUFFEMENT', t: 'Enthousiasme, premiers écarts' },
  { k: 'N2', n: 'TENDU', t: 'Signaux mixtes, financement sous surveillance' },
  { k: 'N3', n: 'SURCHAUFFE', t: 'Corrections partielles, financement qui se ferme' },
  { k: 'N4', n: 'ÉCLATEMENT', t: 'Correction majeure en cours' }
];
const IMPACTS = [['gpu', 'GPU'], ['ram', 'RAM'], ['ssd', 'SSD'], ['cloud', 'Cloud'], ['local', 'IA loc.'], ['invest', 'Invest.']];
const HZ = [['p30', '30 j'], ['p90', '90 j'], ['p1y', '1 an']];
const LADDER = [['rumeur', 'Rumeur'], ['teaser', 'Teaser'], ['preview', 'Aperçu'], ['poids', 'Poids publiés']];
const VERDICT = { acheter: ['now', 'Acheter maintenant'], partiel: ['part', 'Juste le nécessaire'], attendre: ['wait', 'Attendre'] };
const TREND = { up: ['▲', 'up', 'hausse'], flat: ['►', 'flat', 'stable'], down: ['▼', 'down', 'baisse'] };
const REGIONS = { AS: 'Asie', EU: 'Europe', NA: 'Amérique du Nord', ME: 'Moyen-Orient', AF: 'Afrique', LA: 'Amérique latine', OC: 'Océanie', GLOBAL: 'Mondial' };

let reports = [];
let idx = -1;

/* ---------- utilitaires ---------- */
const $ = s => document.querySelector(s);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
function add(p, ...kids) { kids.flat().forEach(k => { if (k) p.append(k); }); return p; }
const lc = n => `var(--l${Math.max(0, Math.min(4, n | 0))})`;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '?'); };
const num = v => (typeof v === 'number' ? v : (v && typeof v.v === 'number' ? v.v : null));
const arr = v => (Array.isArray(v) ? v : []);
const isHF = u => typeof u === 'string' && /^https:\/\/huggingface\.co\//i.test(u);
const isHttps = u => typeof u === 'string' && /^https:\/\//i.test(u);

function arrow(d) {
  if (d === null) return h('span', 'dl new', '🆕');
  const s = d > 0 ? '▲' : d < 0 ? '▼' : '►';
  const txt = d ? `${s} ${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}` : s;
  return h('span', 'dl ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat'), txt);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400);
}

/* ---------- modèles : lien Hugging Face + propriétaire ---------- */
const modelOf = (cur, id) => arr(cur.models).find(m => m.id === id);
function ownerTxt(m) { return (m.owner || '?') + (m.country ? ' · ' + m.country : ''); }
function modelNode(cur, id) {
  const m = modelOf(cur, id);
  const f = document.createDocumentFragment();
  if (!m || !isHF(m.url)) { f.append(h('span', 'chip faible', `${id} ⚠ sans lien HF`)); return f; }
  const a = h('a', 'mlink', m.name || id);
  a.href = m.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.title = m.open === false ? 'Modèle fermé : page de l\'organisation sur Hugging Face' : 'Voir sur Hugging Face';
  f.append(a, h('span', 'mown', `(${ownerTxt(m)}${m.open === false ? ' · fermé' : ''})`));
  return f;
}
function rich(cur, text) {
  const f = document.createDocumentFragment();
  const s = String(text == null ? '' : text), re = /\{\{([^{}]+)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) f.append(s.slice(last, m.index));
    f.append(modelNode(cur, m[1].trim()));
    last = re.lastIndex;
  }
  if (last < s.length) f.append(s.slice(last));
  return f;
}
const plain = (cur, text) => String(text == null ? '' : text).replace(/\{\{([^{}]+)\}\}/g, (_, id) => (modelOf(cur, id.trim()) || {}).name || id);
function R(tag, cls, cur, text) { const e = h(tag, cls); e.append(rich(cur, text)); return e; }
function ownChip(o, country) { return o ? h('span', 'chip own', country ? `${o} · ${country}` : o) : null; }

/* ---------- stockage ---------- */
function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter(isReport).sort(byDate) : [];
  } catch (e) { return []; }
}
function persist() {
  if (reports.length > MAX_STORED) { reports = reports.slice(-MAX_STORED); idx = Math.min(idx, reports.length - 1); }
  try { localStorage.setItem(KEY, JSON.stringify(reports)); }
  catch (e) { toast('Stockage local indisponible : rapports gardés en mémoire seulement'); }
}
const isReport = r => r && typeof r === 'object' && typeof r.date === 'string' && r.alert && typeof r.alert.level === 'number';

/* ---------- import ---------- */
function parseReport(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Aucun objet JSON trouvé.');
  let r;
  try { r = JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('JSON invalide : ' + e.message); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw new Error('Champ "date" manquant ou hors format AAAA-MM-JJ.');
  if (!r.alert || typeof r.alert.level !== 'number' || r.alert.level < 0 || r.alert.level > 4)
    throw new Error('Champ "alert.level" manquant (0 à 4).');
  if (r.schema != null && r.schema !== 2) throw new Error('Version de schéma non prise en charge : ' + r.schema + ' (attendu : 2)');
  ['domains', 'top_changes', 'scenarios', 'impacts', 'indicators', 'actions', 'hypotheses', 'sources', 'models', 'watchlist', 'upcoming', 'finance', 'projects', 'leads']
    .forEach(k => { if (!Array.isArray(r[k])) r[k] = []; });
  ['hf_trending', 'local_ai', 'hardware', 'coverage'].forEach(k => { if (!r[k] || typeof r[k] !== 'object') r[k] = {}; });
  return r;
}
function addReport(r, silent) {
  const i = reports.findIndex(x => x.date === r.date);
  if (i >= 0) reports[i] = r; else reports.push(r);
  reports.sort(byDate);
  idx = reports.findIndex(x => x.date === r.date);
  persist();
  if (!silent) { render(); toast(i >= 0 ? 'Rapport du ' + fmtDate(r.date) + ' remplacé' : 'Rapport ajouté'); }
}

/* ---------- section repliable ---------- */
function section(title, status, bodyEls, open = false) {
  const d = h('details', 'sec');
  const s = h('summary');
  add(s, h('span', 'st', title));
  if (status === null) s.append(h('span', 'chip', '🆕 référence'));
  else if (status > 0) s.append(h('span', 'chip chg', `▲ ${status} changement${status > 1 ? 's' : ''}`));
  else s.append(h('span', 'chip', '= IDEM'));
  d.append(s);
  d.append(add(h('div', 'sbody'), bodyEls));
  d.open = open;
  return d;
}
/* Compare une liste d'éléments au rapport précédent par clé ; renvoie [{it, changed, isNew}] */
function diffList(list, prevList, key, sig) {
  const pm = new Map(arr(prevList).map(x => [key(x), x]));
  return arr(list).map(it => {
    const p = pm.get(key(it));
    return { it, p, isNew: !p, changed: !p || sig(it) !== sig(p) };
  });
}
const J = JSON.stringify;

/* ---------- rendu ---------- */
function render() {
  const app = $('#app');
  app.replaceChildren();
  $('#prev').disabled = idx <= 0;
  $('#next').disabled = idx < 0 || idx >= reports.length - 1;
  if (idx < 0 || !reports[idx]) {
    $('#dateLbl').textContent = 'Bulle-AI-tin'; $('#posLbl').textContent = '';
    const e = h('div', 'empty');
    add(e, h('h2', null, 'Aucun rapport'),
      h('p', 'mut', 'Importe un rapport (bouton ＋), synchronise depuis ton dépôt, ou charge l\'exemple de variation.'));
    const row = h('div', 'row'); row.style.justifyContent = 'center';
    const b1 = h('button', 'btn pri', 'Synchroniser'); b1.onclick = syncRepo;
    const b2 = h('button', 'btn', 'Charger l\'exemple'); b2.onclick = loadSample;
    app.append(add(e, add(row, b1, b2)));
    return;
  }
  const cur = reports[idx], prev = idx > 0 ? reports[idx - 1] : null;
  $('#dateLbl').textContent = fmtDate(cur.date);
  $('#posLbl').textContent = `${idx + 1} / ${reports.length}` + (prev ? ` · vs ${fmtDate(prev.date)}` : ' · référence');

  app.append(hero(cur, prev));
  app.append(heatCard(cur, prev));
  app.append(topChanges(cur, prev));
  app.append(hfSec(cur, prev));
  app.append(watchSec(cur, prev));
  app.append(localSec(cur, prev));
  app.append(projectsSec(cur, prev));
  app.append(hardwareSec(cur, prev));
  app.append(financeSec(cur, prev));
  app.append(scenariosSec(cur, prev));
  app.append(indicatorsSec(cur, prev));
  app.append(impactsSec(cur, prev));
  app.append(upcomingSec(cur, prev));
  if (cur.leads.length) app.append(leadsSec(cur, prev));
  app.append(actionsSec(cur, prev));
  app.append(hypSec(cur, prev));
  app.append(sourcesSec(cur));
  if (cur.caveat) add(app, add(h('div', 'recul'), h('b', null, '⚠️ Recul : '), rich(cur, cur.caveat)));
}

/* --- références de sources cliquables --- */
function srcRefs(cur, texts, extra) {
  const ns = new Set((extra || []).map(Number));
  (texts || []).forEach(t => String(t || '').replace(/\[(\d+)\]/g, (_, n) => { ns.add(Number(n)); return _; }));
  const byN = new Map((cur.sources || []).map(s => [s.n, s]));
  const list = [...ns].filter(n => byN.has(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const p = h('div', 'src');
  p.append(h('span', 'mut', 'Sources : '));
  list.forEach((n, i) => {
    const s = byN.get(n);
    const label = `[${n}] ${s.publisher || s.title || ''}${s.region ? ' · ' + s.region : ''}`;
    let el;
    if (isHttps(s.url)) { el = h('a', null, label); el.href = s.url; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    else el = h('span', null, label);
    if (s.title) el.title = s.title;
    if (i) p.append(document.createTextNode(' · '));
    p.append(el);
  });
  return p;
}

function impactLegend() {
  const box = h('div', 'mut');
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12px;margin-top:8px';
  [[1, 'faible'], [2, 'moyen'], [3, 'élevé']].forEach(([v, lab]) => {
    const it = h('span'); const dt = h('span', 'dot'); dt.style.background = lc(v);
    dt.style.marginRight = '5px'; add(it, dt, document.createTextNode(lab)); box.append(it);
  });
  const it = h('span'); const sq = h('span');
  sq.style.cssText = 'display:inline-block;width:12px;height:12px;border:2px solid var(--chgline);border-radius:3px;vertical-align:middle;margin-right:5px';
  add(it, sq, document.createTextNode('changement depuis la veille')); box.append(it);
  box.append(h('span', null, '– aucun impact'));
  return box;
}

/* --- en-tête : niveau de risque de bulle IA --- */
function hero(cur, prev) {
  const lv = Math.max(0, Math.min(4, cur.alert.level | 0));
  const d = h('div', `hero l${lv}`);
  d.style.setProperty('--lv', lc(lv));
  d.append(h('div', 'kick', 'Risque de bulle IA'));
  add(d, h('div', 'lv', `${LV[lv].k} · ${cur.alert.label || LV[lv].n}`));
  const g = h('div', 'gauge');
  for (let i = 0; i < 5; i++) { const s = h('i', i <= lv ? 'on' : ''); s.style.setProperty('--c', lc(i)); g.append(s); }
  d.append(g);
  let line;
  if (!prev) line = '🆕 rapport de référence';
  else {
    const dl = lv - (prev.alert.level | 0);
    line = dl === 0 ? `► inchangé depuis ${fmtDate(prev.date)}`
      : `${dl > 0 ? '▲' : '▼'} ${dl > 0 ? 'monte' : 'baisse'} de N${prev.alert.level} à N${lv} depuis ${fmtDate(prev.date)}`;
  }
  d.append(h('div', 'dl2', line));
  if (cur.alert.summary) d.append(R('p', null, cur, cur.alert.summary));
  if (prev && lv !== prev.alert.level && cur.alert.change_reason) d.append(R('p', null, cur, 'Pourquoi : ' + cur.alert.change_reason));
  d.append(h('div', 'meta', [LV[lv].t, cur.period && 'Période : ' + cur.period,
    cur.generator && 'Source : ' + cur.generator].filter(Boolean).join(' · ')));
  return d;
}

/* --- carte thermique des 8 domaines --- */
function heatCard(cur, prev) {
  const pm = new Map((prev ? prev.domains : []).map(x => [x.id || x.name, x]));
  const rows = cur.domains.map(d => {
    const p = pm.get(d.id || d.name);
    const lvl = Math.max(0, Math.min(3, d.level | 0));
    const delta = !prev ? undefined : (p ? lvl - (p.level | 0) : null);
    const changed = !!prev && (!p || p.level !== d.level || (p.note || '') !== (d.note || ''));
    return { d, lvl, delta, changed };
  }).sort((a, b) => b.lvl - a.lvl || (b.changed - a.changed));
  const grid = h('div', 'heat');
  rows.forEach(r => {
    const t = h('div', 'tile' + (r.changed ? ' chg' : (prev ? ' idem' : '')));
    t.style.setProperty('--c', lc(r.lvl));
    const n = h('div', 'n');
    add(n, h('span', null, r.d.name || r.d.id), prev ? arrow(r.delta) : null);
    const show = !prev || r.changed;
    const tx = h('div', 't');
    if (show) tx.append(rich(cur, r.d.note || '—')); else tx.textContent = '= IDEM';
    if (!show) {
      t.style.cursor = 'pointer';
      t.onclick = () => {
        const open = tx.textContent === '= IDEM';
        tx.textContent = open ? '= IDEM · ' + plain(cur, r.d.note || '—') : '= IDEM';
      };
    } else t.style.cursor = 'default';
    add(t, n, tx); grid.append(t);
  });
  const n = rows.filter(r => r.changed).length;
  const idemCount = prev ? rows.length - n : 0;
  const hint = idemCount ? h('p', 'mut', 'Tape une tuile « = IDEM » pour revoir sa note.') : null;
  return section('Carte des 8 domaines', prev ? n : null, [grid, hint].filter(Boolean), true);
}

/* --- top changements --- */
function topChanges(cur, prev) {
  const els = cur.top_changes.slice(0, 3).map((c, i) => {
    const d = h('div', 'tc');
    const strong = /fort/i.test(c.strength || '');
    add(d, add(h('div', 'row'), h('span', 'chip ' + (strong ? 'fort' : 'faible'), strong ? 'SIGNAL FORT' : 'SIGNAL FAIBLE'),
      c.domain ? h('span', 'chip', c.domain) : null),
      h('h4', null, `${i + 1}. ${plain(cur, c.title || '')}`));
    [['Fait', c.fact], ['Mécanisme', c.mechanism], ['Effet', c.effect]].forEach(([k, v]) => {
      if (v) add(d, add(h('p'), h('span', 'k', k + ' : '), rich(cur, v)));
    });
    const refs = srcRefs(cur, [c.fact, c.mechanism, c.effect], c.sources);
    if (refs) d.append(refs);
    return d;
  });
  if (!els.length) els.push(h('p', 'mut', 'Peu de mouvement : = IDEM'));
  return section('Top 3 des changements', cur.top_changes.length ? (prev ? cur.top_changes.length : null) : 0, els, true);
}

/* --- Hugging Face : top 3 tendance avec variation à J-1 --- */
function hfList(cur, list, prevList, title) {
  const out = [h('div', 'grp', title)];
  let changed = 0;
  arr(list).forEach(m => {
    const p = arr(prevList).find(x => x.id === m.id);
    const ch = !prevList || !p || p.rank !== m.rank;
    if (prevList && ch) changed++;
    const c = h('div', 'it' + (prevList && ch ? ' chg' : ''));
    const r1 = h('div', 'r1');
    const a = h('a', 'mlink', m.name || m.id);
    if (isHF(m.url)) { a.href = m.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    const nm = h('span', 'nm'); nm.append(a);
    let dr;
    if (!prevList) dr = null;
    else if (!p) dr = h('span', 'dl new', '🆕 entrée');
    else { const d = p.rank - m.rank; dr = h('span', 'dl new', d > 0 ? `▲ +${d}` : d < 0 ? `▼ ${d}` : '►'); } // ▲ = a gagné des places (accent neutre : monter au classement n'est ni bon ni mauvais)
    add(r1, h('span', 'rank', m.rank), nm, ownChip(m.owner, m.country), dr);
    c.append(r1);
    const r2 = h('div', 'r1'); r2.style.marginTop = '6px';
    const sc = h('span', 'big', m.score != null ? Math.round(m.score) : '?');
    add(r2, h('span', 'k', 'score tendance'), sc);
    if (p && p.score) { const pct = Math.round((m.score - p.score) / p.score * 100); add(r2, h('span', 'dl ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'), `${pct > 0 ? '+' : ''}${pct} % vs veille`)); }
    if (m.kind) r2.append(h('span', 'chip' + (m.kind === 'original' ? ' ok' : ' cm'), m.kind));
    if (m.likes != null) r2.append(h('span', 'mut', `♥ ${m.likes.toLocaleString('fr-CA')}`));
    c.append(r2);
    if (m.why) c.append(R('p', 'mut', cur, m.why));
    out.push(c);
  });
  return { els: out, changed };
}
function hfSec(cur, prev) {
  const t = cur.hf_trending || {}, pt = prev ? (prev.hf_trending || {}) : null;
  const a = hfList(cur, t.top3, pt ? pt.top3 : null, 'Top 3 tendance · tous dépôts');
  const b = hfList(cur, t.top3_official, pt ? pt.top3_official : null, 'Top 3 tendance · laboratoires officiels');
  const intro = h('p', 'intro', `Source : API Hugging Face${t.fetched_at ? ' · relevé du ' + fmtDate(t.fetched_at.slice(0, 10)) : ''}. Rang et score sont comparés au relevé de la veille. Tendance ≠ qualité : les dépôts communautaires (dérivés, quantifications) dominent souvent.`);
  const els = [intro, ...a.els, ...b.els];
  if (t.note) els.push(R('p', 'mut', cur, t.note));
  const srcs = srcRefs(cur, [], t.sources); if (srcs) els.push(srcs);
  return section('Hugging Face · tendances', prev ? a.changed + b.changed : null, els, true);
}

/* --- modèles suivis : propriétaire, dernière version, prochaine mise à niveau --- */
function watchSec(cur, prev) {
  const d = diffList(cur.watchlist, prev && prev.watchlist, x => x.family, x => J([x.latest, x.next]));
  let n = 0;
  const els = [h('p', 'intro', 'Chaque modèle suivi affiche son propriétaire. L\'échelle de certitude des mises à niveau va de la rumeur au dépôt de poids publié sur Hugging Face.')];
  d.forEach(({ it, changed }) => {
    if (prev && changed) n++;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    const r1 = h('div', 'r1');
    add(r1, h('span', 'nm', it.family), ownChip(it.owner, it.country), prev && changed ? h('span', 'chip chg', 'mis à jour') : null);
    c.append(r1);
    if (it.latest) {
      const p = h('p'); p.append(h('span', 'k', 'Dernière version : '), rich(cur, it.latest.model));
      if (it.latest.date) p.append(h('span', 'mut', ` · ${fmtDate(it.latest.date)}`));
      c.append(p);
    }
    const nx = it.next;
    if (nx && nx.what) {
      const stage = LADDER.findIndex(l => l[0] === nx.status);
      const p = h('p'); p.append(h('span', 'k', 'À venir : '), document.createTextNode(nx.what));
      if (nx.eta) p.append(h('span', 'mut', ` · échéance : ${nx.eta}`));
      c.append(p);
      const lad = h('div', 'ladder'); LADDER.forEach((l, i) => lad.append(h('i', i <= stage ? 'on' : '')));
      const lab = h('div', 'ladderlab'); LADDER.forEach(l => lab.append(h('span', null, l[1])));
      c.append(lad, lab);
      if (nx.note) c.append(R('p', 'mut', cur, nx.note));
    } else c.append(h('p', 'mut', 'Aucune mise à niveau annoncée trouvée.'));
    if (it.note) c.append(R('p', 'mut', cur, it.note));
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    els.push(c);
  });
  return section('Modèles suivis · mises à niveau', prev ? n : null, els);
}

/* --- IA locale : résultats réels sur matériel grand public --- */
function localSec(cur, prev) {
  const L = cur.local_ai || {};
  const d = diffList(L.results, prev && prev.local_ai && prev.local_ai.results, x => J([x.model, x.hardware, x.setup]), x => J([x.tps, x.ctx]));
  let n = 0;
  const els = [];
  if (L.why) els.push(R('p', 'intro', cur, L.why));
  d.forEach(({ it, changed }) => {
    if (prev && changed) n++;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    const r1 = h('div', 'r1');
    const nm = h('span', 'nm'); nm.append(rich(cur, it.model));
    add(r1, nm, h('span', 'big', it.tps), h('span', 'mut', 'tok/s'));
    c.append(r1);
    const r2 = h('div', 'r1'); r2.style.marginTop = '6px';
    add(r2, h('span', 'chip own', it.hardware), it.setup ? h('span', 'chip', it.setup) : null,
      it.ctx ? h('span', 'chip', 'ctx ' + it.ctx) : null, it.measure ? h('span', 'chip cm', it.measure) : null);
    c.append(r2);
    if (it.note) c.append(R('p', 'mut', cur, it.note));
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    els.push(c);
  });
  if (!d.length) els.push(h('p', 'mut', 'Aucun résultat ce jour.'));
  if (L.gap) els.push(R('p', 'mut', cur, 'Angle mort : ' + L.gap));
  return section('IA locale · matériel grand public', prev ? n : null, els);
}

/* --- projets GitHub importants (stars, licence, version, mise en garde, liens) --- */
const fmtK = n => (typeof n !== 'number' ? '?' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' k' : String(n));
function linkNode(label, url) {
  if (!isHttps(url)) return h('span', 'mut', label);
  const a = h('a', null, label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function projectsSec(cur, prev) {
  const d = diffList(cur.projects, prev && prev.projects, x => x.repo, x => J([x.version, x.watch, x.license]));
  let n = 0;
  const els = [h('p', 'intro', 'Projets open source qui comptent pour l\'IA locale. Étoiles et forks relevés sur GitHub ; la variation est comparée à la veille. Les débits annoncés par un auteur restent des mesures d\'auteur.')];
  d.forEach(({ it, p, changed }) => {
    if (prev && changed) n++;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    const r1 = h('div', 'r1');
    const nm = h('span', 'nm'); nm.append(linkNode(it.name, it.repo));
    add(r1, nm, ownChip(it.owner), it.license ? h('span', 'chip', it.license) : null, prev && changed ? h('span', 'chip chg', 'mis à jour') : null);
    c.append(r1);
    const r2 = h('div', 'r1'); r2.style.marginTop = '6px';
    const sd = p && typeof p.stars === 'number' && typeof it.stars === 'number' ? it.stars - p.stars : (prev && !p ? null : undefined);
    add(r2, h('span', 'stars', '★ ' + fmtK(it.stars)), sd !== undefined && prev ? arrow(sd) : null,
      it.forks != null ? h('span', 'mut', `forks ${fmtK(it.forks)}`) : null, it.version ? h('span', 'chip cm', it.version) : null);
    c.append(r2);
    if (it.kind) c.append(h('p', 'mut', it.kind));
    if (it.why) c.append(R('p', null, cur, it.why));
    if (it.watch) c.append(add(h('p', 'mut warnline'), h('b', null, '⚠ À savoir : '), rich(cur, it.watch)));
    if (arr(it.links).length) {
      const row = h('div', 'linkrow');
      arr(it.links).forEach(l => row.append(linkNode('↗ ' + l.label, l.url)));
      c.append(row);
    }
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    els.push(c);
  });
  return section('Projets GitHub · IA locale', prev ? n : null, els);
}

/* --- pistes de la veille communautaire (vidéos, transcripts) : analyse secondaire, jamais un fait --- */
function leadsSec(cur, prev) {
  const d = diffList(cur.leads, prev && prev.leads, x => x.url || x.title, x => J([x.takeaway, x.verify]));
  let n = 0;
  const els = [h('p', 'intro', 'Analyse secondaire (créateurs de contenu) : sert à repérer des sujets et des outils. Rien ici n\'est un fait tant qu\'une source primaire (dépôt GitHub, fiche Hugging Face, communiqué) ne le confirme.')];
  d.forEach(({ it, changed }) => {
    if (prev && changed) n++;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    const nm = h('span', 'nm'); nm.append(linkNode(it.title, it.url));
    add(c, add(h('div', 'r1'), nm, it.channel ? h('span', 'chip own', it.channel) : null, h('span', 'chip faible', 'à vérifier')));
    const meta = [it.date && fmtDate(it.date), it.topic].filter(Boolean).join(' · ');
    if (meta) c.append(h('p', 'mut', meta));
    if (arr(it.tools).length) { const r = h('div', 'r1'); r.style.marginTop = '6px'; arr(it.tools).forEach(t => r.append(h('span', 'chip', t))); c.append(r); }
    if (it.takeaway) c.append(R('p', null, cur, it.takeaway));
    if (it.verify) add(c, add(h('p', 'mut warnline'), h('b', null, 'À confirmer : '), rich(cur, it.verify)));
    els.push(c);
  });
  return section('Pistes · veille communautaire', prev ? n : null, els);
}

/* --- matériel : RAM, SSD, GPU, acheter ou attendre --- */
function hardwareSec(cur, prev) {
  const H = cur.hardware || {}, PH = prev ? (prev.hardware || {}) : null;
  const els = [];
  const dp = diffList(H.parts, PH && PH.parts, x => x.part, x => J([x.trend, x.change]));
  let n = 0;
  els.push(h('div', 'grp', 'Tendance des prix'));
  dp.forEach(({ it, changed }) => {
    if (prev && changed) n++;
    const t = TREND[it.trend] || TREND.flat;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    add(c, add(h('div', 'r1'), h('span', 'nm', it.part), h('span', 'dl ' + t[1], `${t[0]} ${it.change || t[2]}`)));
    if (it.note) c.append(R('p', 'mut', cur, it.note));
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    els.push(c);
  });
  els.push(h('div', 'grp', 'Acheter maintenant ou attendre ?'));
  const dd = diffList(H.decisions, PH && PH.decisions, x => x.part, x => J([x.verdict, x.buy_now, x.wait, x.trigger]));
  dd.forEach(({ it, changed }) => {
    if (prev && changed) n++;
    const v = VERDICT[it.verdict] || VERDICT.partiel;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    add(c, add(h('div', 'r1'), h('span', 'nm', it.part), h('span', 'verdict ' + v[0], v[1])));
    if (it.buy_now) add(c, add(h('p'), h('span', 'k', 'Si j\'achète : '), rich(cur, it.buy_now)));
    if (it.wait) add(c, add(h('p'), h('span', 'k', 'Si j\'attends 3 à 6 mois : '), rich(cur, it.wait)));
    if (it.trigger) add(c, add(h('p', 'mut'), h('span', 'k', 'Ce qui changerait l\'avis : '), rich(cur, it.trigger)));
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    els.push(c);
  });
  if (H.reco) els.push(add(h('div', 'reco'), h('b', null, 'Recommandation : '), rich(cur, H.reco)));
  return section('Matériel · RAM, SSD, GPU', prev ? n : null, els);
}

/* --- finance : IPO, capex, valorisations --- */
function financeSec(cur, prev) {
  const d = diffList(cur.finance, prev && prev.finance, x => x.name, x => J([x.value, x.status, x.note]));
  let n = 0;
  const st = { ok: ['ok', 'ok'], surveille: ['faible', 'surveillé'], alerte: ['fort', 'alerte'] };
  const els = d.map(({ it, changed }) => {
    if (prev && changed) n++;
    const s = st[it.status] || st.surveille;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    add(c, add(h('div', 'r1'), h('span', 'nm', it.name), it.kind ? h('span', 'chip', it.kind) : null, h('span', 'chip ' + s[0], s[1])));
    if (it.value) c.append(R('p', null, cur, it.value));
    if (it.note) c.append(R('p', 'mut', cur, it.note));
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    return c;
  });
  return section('Finance · IPO, capex, valorisations', prev ? n : null, els.length ? els : [h('p', 'mut', '—')]);
}

/* --- scénarios (bulle) --- */
function scenariosSec(cur, prev) {
  const pm = new Map((prev ? prev.scenarios : []).map(s => [s.id || s.name, s]));
  const list = cur.scenarios.slice().sort((a, b) => (num(b.p90) || 0) - (num(a.p90) || 0));
  let changedCount = 0;
  const els = list.map(s => {
    const p = pm.get(s.id || s.name);
    const changed = !!prev && (!p || HZ.some(([k]) => num(s[k]) !== num(p[k])) || s.confidence !== p.confidence || s.trigger !== p.trigger);
    if (changed) changedCount++;
    const d = h('details', 'sc' + (changed ? ' chg' : ''));
    const sm = h('summary');
    const dl90 = !prev ? undefined : (p ? (num(s.p90) || 0) - (num(p.p90) || 0) : null);
    add(sm, h('span', 'nm', s.name || s.id), h('span', 'p90', num(s.p90) != null ? num(s.p90) + ' %' : '?'),
      prev ? (changed || !p ? arrow(dl90) : h('span', 'chip', '= IDEM')) : null);
    d.append(sm);
    const bd = h('div', 'bd');
    const hz = h('div', 'hz');
    HZ.forEach(([k, lab]) => {
      const v = s[k] || {};
      const dd = !prev ? undefined : (p ? (num(s[k]) || 0) - (num(p[k]) || 0) : null);
      const box = h('div');
      add(box, h('small', null, lab), h('b', null, num(s[k]) != null ? num(s[k]) + ' %' : '?'),
        v.lo != null ? h('div', 'r', `(${v.lo}–${v.hi})`) : null, prev ? arrow(dd) : null);
      hz.append(box);
    });
    bd.append(hz);
    const c = Math.max(0, Math.min(3, s.confidence | 0));
    add(bd, add(h('p'), h('span', 'mut', 'Confiance : '), h('span', 'conf', '●'.repeat(c) + '○'.repeat(3 - c))));
    if (s.trigger) add(bd, add(h('p'), h('span', 'mut', 'Déclencheur : '), rich(cur, s.trigger)));
    if (s.justification) bd.append(R('p', 'mut', cur, s.justification));
    bd.append(srcRefs(cur, [s.justification, s.trigger]) || h('p', 'mut', 'Sources : aucune citée pour ce scénario.'));
    d.append(bd);
    return d;
  });
  return section('Scénarios de bulle (probabilités)', prev ? changedCount : null, els);
}

/* --- impacts --- */
function impactsSec(cur, prev) {
  const pm = new Map((prev ? prev.impacts : []).map(r => [r.scenario_id || r.scenario, r]));
  const name = id => { const s = cur.scenarios.find(x => (x.id || x.name) === id); return s ? (s.name || id) : id; };
  const tbl = h('table'), thead = h('thead'), hr = h('tr');
  hr.append(h('th', null, 'Scénario'));
  IMPACTS.forEach(([, l]) => hr.append(h('th', null, l)));
  tbl.append(add(thead, hr));
  const tb = h('tbody'); let changedRows = 0;
  cur.impacts.forEach(r => {
    const id = r.scenario_id || r.scenario, p = pm.get(id);
    const rowChanged = !!prev && (!p || IMPACTS.some(([k]) => (r[k] | 0) !== (p[k] | 0)));
    if (rowChanged) changedRows++;
    const tr = h('tr', prev && !rowChanged ? 'idem' : '');
    tr.append(h('td', null, name(id)));
    IMPACTS.forEach(([k]) => {
      const v = Math.max(0, Math.min(3, r[k] | 0));
      const td = h('td', prev && p && (p[k] | 0) !== v ? 'cc' : '');
      if (v === 0) td.textContent = '–'; else { const dt = h('span', 'dot'); dt.style.background = lc(v); dt.title = ['', 'faible', 'moyen', 'élevé'][v]; td.append(dt); }
      tr.append(td);
    });
    tb.append(tr);
  });
  tbl.append(tb);
  const els = cur.impacts.length ? [add(h('div', 'tw'), tbl), impactLegend()] : [h('p', 'mut', 'Aucun impact renseigné.')];
  return section('Impacts par scénario', prev ? changedRows : null, els);
}

/* --- indicateurs de bulle --- */
function indicatorsSec(cur, prev) {
  const pm = new Map((prev ? prev.indicators : []).map(i => [i.name, i]));
  let n = 0;
  const els = cur.indicators.map(i => {
    const p = pm.get(i.name);
    const ch = !!prev && (!p || p.current !== i.current || p.status !== i.status);
    if (ch) n++;
    const d = h('div', 'ind');
    const st = String(i.status || '');
    const cls = /franchi/i.test(st) ? 'fort' : /approche/i.test(st) ? 'faible' : '';
    add(d, add(h('div', 'l1'), h('span', null, i.name), h('span', 'chip ' + cls, st || '—')),
      R('div', 'l2', cur, `Actuel : ${i.current ?? '—'}${p && p.current !== i.current ? ` (avant : ${p.current})` : ''}`),
      h('div', 'l2', `▲ monte si : ${i.up ?? '—'}  ·  ▼ baisse si : ${i.down ?? '—'}`));
    return d;
  });
  return section('Indicateurs de bulle', prev ? n : null, els.length ? els : [h('p', 'mut', '—')]);
}

/* --- technologies à venir --- */
function upcomingSec(cur, prev) {
  const d = diffList(cur.upcoming, prev && prev.upcoming, x => x.name, x => J([x.eta, x.confidence, x.note]));
  let n = 0;
  const els = d.map(({ it, changed }) => {
    if (prev && changed) n++;
    const c = h('div', 'it' + (prev && changed ? ' chg' : ''));
    const cf = Math.max(0, Math.min(3, it.confidence | 0));
    add(c, add(h('div', 'r1'), h('span', 'nm', it.name), ownChip(it.owner, it.country), h('span', 'conf', '●'.repeat(cf) + '○'.repeat(3 - cf))));
    if (it.eta) add(c, add(h('p'), h('span', 'k', 'Échéance : '), document.createTextNode(it.eta)));
    if (it.note) c.append(R('p', 'mut', cur, it.note));
    const rf = srcRefs(cur, [], it.sources); if (rf) c.append(rf);
    return c;
  });
  return section('Technologies à venir', prev ? n : null, els.length ? els : [h('p', 'mut', '—')]);
}

/* --- actions --- */
function actionsSec(cur, prev) {
  const lv = cur.alert.level | 0;
  const pk = new Set((prev ? prev.actions : []).map(a => `${a.level}|${a.text}`));
  const prevStatus = new Map((prev ? prev.actions : []).map(a => [`${a.level}|${a.text}`, a.status]));
  const ico = { fait: '✅', afaire: '⬜', interdit: '⛔' };
  const prio = { urgent: '🔥', mois: '⏳', plus_tard: '📅' };
  let n = 0;
  const mk = a => {
    const k = `${a.level}|${a.text}`;
    const isNew = !!prev && !pk.has(k);
    const statusChg = !!prev && pk.has(k) && prevStatus.get(k) !== a.status;
    if (isNew || statusChg) n++;
    const r = h('div', 'li');
    add(r, h('span', 'ico', ico[a.status] || '⬜'),
      R('span', 'tx', cur, a.text), isNew ? h('span', 'chip chg', '🆕') : statusChg ? h('span', 'chip chg', 'mis à jour') : null,
      a.priority && prio[a.priority] ? h('span', null, prio[a.priority]) : null);
    return r;
  };
  const els = [];
  const focus = [lv, Math.min(4, lv + 1)];
  focus.forEach((L, i) => {
    const items = cur.actions.filter(a => (a.level | 0) === L);
    els.push(h('div', 'grp', `${i === 0 ? 'Niveau actuel' : 'Niveau suivant'} · N${L}`));
    els.push(...(items.length ? items.map(mk) : [h('p', 'mut', '—')]));
  });
  const others = cur.actions.filter(a => !focus.includes(a.level | 0));
  if (others.length) {
    const dd = h('details');
    dd.append(h('summary', 'mut', `Autres niveaux : = IDEM (${others.length}) — afficher`));
    others.forEach(a => dd.append(mk(a)));
    els.push(dd);
  }
  els.push(h('p', 'mut', '✅ fait · ⬜ à faire · ⛔ à ne pas faire · 🔥 urgent · ⏳ ce mois · 📅 plus tard'));
  return section('Étapes à mener', prev ? n : null, els);
}

/* --- hypothèses --- */
function hypSec(cur, prev) {
  const ico = { juste: '✅', faux: '❌', indetermine: '❓', nouveau: '🆕' };
  const pk = new Set((prev ? prev.hypotheses : []).map(x => x.text));
  let n = 0;
  const els = cur.hypotheses.map(x => {
    const isNew = !!prev && !pk.has(x.text);
    if (isNew || x.verdict === 'juste' || x.verdict === 'faux') n++;
    const r = h('div', 'li');
    const tx = h('span', 'tx');
    add(tx, rich(cur, x.text),
      x.comment ? R('div', 'mut', cur, x.comment) : null,
      x.eval_date ? h('div', 'mut', 'À évaluer le ' + fmtDate(x.eval_date)) : null);
    add(r, h('span', 'ico', ico[x.verdict] || '❓'), tx);
    return r;
  });
  return section('Journal des hypothèses', prev ? n : null, els.length ? els : [h('p', 'mut', '—')]);
}

/* --- sources, avec la couverture géographique --- */
function sourcesSec(cur) {
  const counts = {};
  cur.sources.forEach(s => { const r = s.region || '?'; counts[r] = (counts[r] || 0) + 1; });
  const regs = h('div', 'regs');
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([r, c]) =>
    regs.append(h('span', 'chip own', `${REGIONS[r] || r} · ${c}`)));
  const els = [h('p', 'intro', 'Couverture géographique des sources citées dans ce rapport :'), regs];
  if (cur.coverage && cur.coverage.note) els.push(R('p', 'mut', cur, cur.coverage.note));
  cur.sources.forEach(s => {
    const p = h('div', 'src');
    p.append(document.createTextNode(`[${s.n}] ${s.title || ''}${s.publisher ? ' — ' + s.publisher : ''}${s.region ? ' · ' + s.region : ''}${s.date ? ' (' + s.date + ')' : ''} `));
    if (isHttps(s.url)) { const a = h('a', null, 'ouvrir'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); }
    els.push(p);
  });
  const d = h('details', 'sec');
  add(d, add(h('summary'), h('span', 'st', 'Sources'), h('span', 'chip', String(cur.sources.length))),
    add(h('div', 'sbody'), els));
  return d;
}

/* ---------- actions de menu ---------- */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = h('textarea'); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* rien */ }
    ta.remove(); return ok;
  }
}
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}
async function pullFromRepo() {
  const list = await fetchJson('data/index.json');
  if (!Array.isArray(list)) throw new Error('data/index.json doit être une liste de fichiers.');
  const files = list.filter(f => typeof f === 'string' && /^[\w.-]+\.json$/.test(f) && !/^sample-/.test(f))
    .sort().slice(-MAX_STORED);
  const have = new Set(reports.map(r => r.date + '.json'));
  const latest = files[files.length - 1];
  let n = 0;
  for (const f of files) {
    if (have.has(f) && f !== latest) continue;
    try { addReport(parseReport(JSON.stringify(await fetchJson('data/' + f))), true); n++; } catch (e) { /* fichier ignoré */ }
  }
  return n;
}
async function syncRepo() {
  try {
    const n = await pullFromRepo();
    idx = reports.length - 1; render(); toast(`${n} rapport(s) synchronisé(s)`);
  } catch (e) { toast('Synchro impossible : ' + e.message); }
}
async function loadSample() {
  try {
    addReport(parseReport(JSON.stringify(await fetchJson('data/sample-prev.json'))), true);
    addReport(parseReport(JSON.stringify(await fetchJson('data/2026-11-16.json'))), true);
    render(); toast('Exemple chargé : veille fictive + rapport du 16/11');
  } catch (e) { toast('Exemple indisponible : ' + e.message); }
}

/* ---------- événements ---------- */
function init() {
  reports = load();
  idx = reports.length - 1;
  $('#prev').onclick = () => { if (idx > 0) { idx--; render(); window.scrollTo(0, 0); } };
  $('#next').onclick = () => { if (idx < reports.length - 1) { idx++; render(); window.scrollTo(0, 0); } };
  $('#addBtn').onclick = () => { $('#importErr').textContent = ''; $('#importDlg').showModal(); };
  $('#menuBtn').onclick = () => $('#menuDlg').showModal();
  $('#pasteBtn').onclick = async () => {
    try { $('#importTxt').value = await navigator.clipboard.readText(); } catch (e) { $('#importErr').textContent = 'Collage auto refusé : colle manuellement.'; }
  };
  $('#importOk').onclick = () => {
    try {
      addReport(parseReport($('#importTxt').value));
      $('#importTxt').value = ''; $('#importDlg').close();
    } catch (e) { $('#importErr').textContent = e.message; }
  };
  $('#copyCur').onclick = async () => {
    if (idx < 0) return toast('Aucun rapport');
    toast((await copyText(JSON.stringify(reports[idx], null, 1))) ? 'Rapport copié : colle-le dans le prompt' : 'Copie impossible');
    $('#menuDlg').close();
  };
  $('#syncBtn').onclick = () => { $('#menuDlg').close(); syncRepo(); };
  $('#sampleBtn').onclick = () => { $('#menuDlg').close(); loadSample(); };
  $('#delCur').onclick = () => {
    if (idx < 0) return;
    if (confirm('Supprimer le rapport du ' + fmtDate(reports[idx].date) + ' de cet appareil ?')) {
      reports.splice(idx, 1); idx = Math.min(idx, reports.length - 1); persist(); render();
    }
    $('#menuDlg').close();
  };
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors-ligne indisponible */ });
  }
  pullFromRepo().then(n => {
    if (n) { idx = reports.length - 1; render(); }
  }).catch(() => { /* pas de dépôt de données : mode import manuel */ });
}
if (typeof document !== 'undefined' && document.getElementById('app')) init();
