import telemetryView from './telemetry.js';

/** Championnats, saisons, manches et battles : leur propre menu (même code que la télémétrie). */
export default function competitionView(root, params = {}) {
  return telemetryView(root, { ...params, section: 'competition' });
}
