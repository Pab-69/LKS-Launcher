'use strict';

/**
 * Battle tandem: two tandem runs on the same track between the same two
 * drivers, roles swapped (A leads then B leads), less than 20 minutes apart.
 * The in-game app records both runs (the one you chase and the one you lead),
 * so one PC has the whole battle.
 */

const fs = require('fs');
const path = require('path');
const { judgeBattleAll, MODE_IDS } = require('./drift');

const WINDOW_MS = 20 * 60 * 1000;
const norm = (n) => String(n || '').trim().toLowerCase();
const pairKey = (a, b) => [norm(a), norm(b)].sort().join('|');

/**
 * Are these two tandem runs the two halves of one battle?
 * Battles launched in game carry a tag (same battle, run 1 and run 2).
 */
function isPair(x, y) {
  if (!x.tandem || !y.tandem || x.id === y.id) return false;
  if (x.track !== y.track || (x.layout || '') !== (y.layout || '')) return false;
  const tx = x.tandem.battle;
  const ty = y.tandem.battle;
  if (tx || ty) {
    if (!tx || !ty || tx.tag !== ty.tag || tx.run === ty.run) return false;
  }
  if (norm(x.driver.name) !== norm(y.tandem.lead.name) || norm(y.driver.name) !== norm(x.tandem.lead.name)) return false;
  return Math.abs(Date.parse(x.date) - Date.parse(y.date)) <= WINDOW_MS;
}

class BattleStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'telemetry', 'battles.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.items = [];
    }
  }

  save() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.items));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  list({ track, layout } = {}) {
    return this.items
      .filter((b) => (!track || b.track === track) && (layout === undefined || (b.layout || '') === layout))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  get(id) {
    return this.items.find((b) => b.id === id) || null;
  }

  usedLaps() {
    return new Set(this.items.flatMap((b) => b.runs.map((r) => r.lapId)));
  }

  /** Build the battle record from two runs (run1: A leads). */
  static make(run1, run2, course) {
    const tagged = run1.tandem.battle && run2.tandem.battle;
    const firstIs1 = tagged ? run1.tandem.battle.run <= run2.tandem.battle.run : Date.parse(run1.date) <= Date.parse(run2.date);
    const [first, second] = firstIs1 ? [run1, run2] : [run2, run1];
    const modes = judgeBattleAll(first, second, course);
    return {
      id: `b${Date.parse(first.date).toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      track: first.track,
      layout: first.layout || '',
      date: second.date,
      pair: pairKey(first.driver.name, second.driver.name),
      ...(tagged ? { tag: first.tandem.battle.tag } : {}),
      cars: { [first.tandem.lead.name]: first.tandem.lead.car || '', [first.driver.name]: first.car },
      runs: [
        { lapId: first.id, lead: first.tandem.lead.name, chase: first.driver.name },
        { lapId: second.id, lead: second.tandem.lead.name, chase: second.driver.name },
      ],
      modes,
    };
  }

  add(battle) {
    this.items.push(battle);
    this.save();
    return battle;
  }

  /** Judge again (course or rules changed). loadLap(id) returns a full lap. */
  rejudge(getCourse, loadLap, version) {
    let n = 0;
    for (const b of this.items) {
      const course = getCourse(b);
      if (MODE_IDS.every((m) => b.modes[m] && b.modes[m].rules === version(course, m))) continue;
      try {
        b.modes = judgeBattleAll(loadLap(b.runs[0].lapId), loadLap(b.runs[1].lapId), course);
        n++;
      } catch {
        /* run deleted: keep the old judging */
      }
    }
    if (n) this.save();
    return n;
  }
}

/** The other half of `lap` among `laps` (summaries), if any. */
function findPartnerRun(lap, laps, used = new Set()) {
  return laps.filter((l) => !used.has(l.id) && isPair(lap, l)).sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(lap.date)) - Math.abs(Date.parse(b.date) - Date.parse(lap.date)))[0] || null;
}

/** Battles from several sources (this PC + shared board): one per pair/track within 5 min. */
function dedupe(battles) {
  const out = [];
  for (const b of [...battles].sort((x, y) => Date.parse(y.date) - Date.parse(x.date))) {
    if (out.some((o) => o.pair === b.pair && o.track === b.track && (o.layout || '') === (b.layout || '') && Math.abs(Date.parse(o.date) - Date.parse(b.date)) < 5 * 60 * 1000)) continue;
    out.push(b);
  }
  return out;
}

module.exports = { BattleStore, isPair, findPartnerRun, pairKey, dedupe };
