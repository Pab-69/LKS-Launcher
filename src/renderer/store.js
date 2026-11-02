// Shared renderer state with a tiny pub/sub.
import { api } from './ui.js';

const listeners = new Set();

export const store = {
  settings: null,
  summary: null,
  progress: null,
  verify: null,
  game: { running: false },
  info: null,
  content: null, // { cars, tracks, weathers } local scan
  updater: null,
};

export function set(patch) {
  Object.assign(store, patch);
  for (const fn of listeners) fn(patch);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Content usable in Solo / hosting: only the group's when the admins limit it. */
export function playable(content) {
  if (!content || !content.restricted) return content;
  return { ...content, cars: content.cars.filter((c) => c.lks), tracks: content.tracks.filter((t) => t.lks) };
}

export async function loadContent(force = false) {
  if (store.content && !force) return store.content;
  const content = await api.call('content:scan', force);
  set({ content });
  return content;
}

export async function saveSettings(patch) {
  const settings = await api.call('settings:update', patch);
  set({ settings });
  return settings;
}
