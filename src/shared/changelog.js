'use strict';

/** Return the markdown body of "## <version>" in a CHANGELOG, or ''. */
function changelogSection(text, version) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\b`).test(l));
  if (start === -1) return '';
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** Very small markdown -> plain text (bullets and bold only). */
function markdownToText(md) {
  return String(md || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*-\s+/gm, '• ')
    .trim();
}

module.exports = { changelogSection, markdownToText };
