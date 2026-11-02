// Brand assets (logo, showcase photos) are not shipped with the launcher:
// they are published by the association and downloaded at runtime
// (see src/main/branding.js). Everything here degrades to a neutral theme.
import { api } from './ui.js';

let state = { version: null, files: [], showcase: [] };
const listeners = new Set();

export function brandUrl(name) {
  if (!state.files.includes(name)) return '';
  return `lks-img://branding/${encodeURIComponent(name)}?v=${String(state.version || '').slice(0, 10)}`;
}

/** [{ image (url), title, subtitle, position }] */
export function brandShowcase() {
  return (state.showcase || []).map((s) => ({ ...s, image: brandUrl(s.image) })).filter((s) => s.image);
}

export function randomShowcase() {
  const list = brandShowcase();
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export function onBrand(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(s) {
  state = { version: null, files: [], showcase: [], ...(s || {}) };
  for (const fn of listeners) fn(state);
}

export async function initBrand() {
  api.on('branding:changed', setState);
  try {
    setState(await api.call('branding:get'));
  } catch {
    setState(null);
  }
}
