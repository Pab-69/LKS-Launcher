/** Mise en forme des textes Discord. */

/** Date affichée dans l'heure de chaque membre. style : F (complet), f, R (relatif), t (heure), D (date). */
function ts(date, style = 'F') {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

function fmtScore(score) {
  return score == null ? '—' : Number(score).toFixed(1);
}

function fmtLap(ms) {
  if (ms == null) return '—';
  const total = Number(ms);
  const min = Math.floor(total / 60000);
  const sec = ((total % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${min}:${sec}`;
}

// notation : debutant | normal | pro = catégories Débutant / Amateur / Pro
const MODES = { debutant: 'Débutant', normal: 'Amateur', pro: 'Pro' };
const KINDS = { drift: 'Drift', tandem: 'Tandem', battle: 'Battle' };
// catégorie d'un pilote -> notation utilisée pour ses runs
const CATEGORY_MODE = { debutant: 'debutant', amateur: 'normal', pro: 'pro' };
const CATEGORY_LABEL = { debutant: 'Débutant', amateur: 'Amateur', pro: 'Pro' };
const CATEGORY_EMOJI = { debutant: '🟢', amateur: '🟠', pro: '🔴' };

function categoryLabel(category) {
  return `${CATEGORY_EMOJI[category] ?? '⚪'} ${CATEGORY_LABEL[category] ?? 'Débutant'}`;
}

function modeLabel(mode) {
  return MODES[mode] ?? mode ?? '';
}

function kindLabel(kind) {
  return KINDS[kind] ?? kind ?? '';
}

/** Mode tiré de rules « {version}-{mode}[@manche] ». */
function modeFromRules(rules) {
  return rules?.split('@')[0].split('-').pop() || '';
}

function place(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `\`${String(i + 1).padStart(2)}.\``;
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function progressBar(ratio, width = 10) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  const full = Math.round(r * width);
  return '▰'.repeat(full) + '▱'.repeat(width - full);
}

function clipsLine(clips = []) {
  return clips.map((c) => (c.hit ? '✅' : '❌')).join(' ') || '—';
}

/** Coupe une liste de lignes pour tenir dans une limite Discord. */
function joinLines(lines, max = 4000) {
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > max) return `${out}\n…`;
    out += (out ? '\n' : '') + line;
  }
  return out;
}

module.exports = { CATEGORY_MODE, CATEGORY_LABEL, categoryLabel, ts, fmtScore, fmtLap, modeLabel, kindLabel, modeFromRules, place, truncate, progressBar, clipsLine, joinLines };
