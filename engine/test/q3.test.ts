import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerFrame } from '../src/q3/trigger.js';
import { makeNaturalFrame, makeSyntheticLookingFrame } from '../src/capture/frames.js';

test('Q3 escalates synthetic-looking frames', () => {
  const synth = makeSyntheticLookingFrame(64, 64, 3);
  const d = triggerFrame(synth);
  assert.equal(d.escalate, true, `expected escalate, got score=${d.score}`);
  assert.ok(d.score >= 0.45);
  assert.ok(d.signals.length > 0);
});

test('Q3 does not escalate natural frames', () => {
  const nat = makeNaturalFrame(64, 64, 11);
  const d = triggerFrame(nat);
  assert.equal(d.escalate, false, `expected no escalate, score=${d.score} signals=${d.signals}`);
});

test('Q3 trigger stays well under 15ms budget', () => {
  const d = triggerFrame(makeSyntheticLookingFrame(128, 128, 5));
  assert.ok(d.ms < 15, `trigger took ${d.ms}ms`);
});
