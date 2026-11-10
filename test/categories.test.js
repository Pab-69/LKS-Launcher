'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { categoryGoal, needed } = require('../src/main/telemetry/categoryGoal');

test('category goal: zeros count in the rolling average', () => {
  const g = categoryGoal({ category: 'debutant', scores: [95, 0, 95, 0, 95, 0, 95, 0, 95, 0], up: 70, down: null, window: 20, minRuns: 10, since: 10 });
  assert.equal(g.avg, 47.5);
  assert.equal(g.zeros, 5);
  assert.equal(g.next, 'amateur');
  assert.equal(g.plan.reached, false);
  // 5 runs at v: (475 + 5v) / 15 >= 70  =>  v >= 115 (impossible) ; 10 runs: (475 + 10v) / 20 >= 70 => 92.5
  assert.deepEqual(g.plan.steps.map((s) => s.runs), [10]);
  assert.equal(g.plan.steps[0].score, 92.5);
});

test('category goal: needed() lets the oldest runs leave the window', () => {
  const full = Array(20).fill(60);
  assert.equal(needed(full, 1, 61, 20, 10), 80); // one run at 80 replaces a 60
  assert.equal(needed(full, 20, 70, 20, 10), 70);
  assert.equal(needed([50, 50], 1, 70, 20, 10), null); // window too short
});

test('category goal: pro floor, next run minimum and grace after a change', () => {
  const g = categoryGoal({ category: 'pro', scores: Array(20).fill(31), up: null, down: 30, window: 20, minRuns: 10, since: 15 });
  assert.equal(g.next, null);
  assert.equal(g.prev, 'amateur');
  assert.equal(g.danger, true);
  assert.equal(g.keep, 11); // (19 * 31 + v) / 20 >= 30  =>  v >= 11
  const fresh = categoryGoal({ category: 'amateur', scores: Array(12).fill(20), up: 65, down: 35, since: 3 });
  assert.equal(fresh.grace, 7);
  const safe = categoryGoal({ category: 'amateur', scores: Array(20).fill(80), up: 65, down: 35, since: 30 });
  assert.equal(safe.keep, 0);
  assert.equal(safe.plan.reached, true);
});

test('category goal: older server without window uses the runs still there', () => {
  const g = categoryGoal({ category: 'debutant' }, [80, 70]);
  assert.equal(g.up, 80);
  assert.equal(g.runs, 2);
  assert.equal(g.plan.missing, 8);
});
