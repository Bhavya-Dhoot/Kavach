import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGenerativeArtifacts, classifierVerdict } from '../src/npu/fallbackClassifier.js';
import { makeNaturalFrame, makeSyntheticLookingFrame } from '../src/capture/frames.js';

test('classifier scores synthetic frames higher than natural frames', () => {
  const synth = classifyGenerativeArtifacts(makeSyntheticLookingFrame(64, 64, 2));
  const nat = classifyGenerativeArtifacts(makeNaturalFrame(64, 64, 3));
  assert.ok(
    synth.score > nat.score,
    `synth=${synth.score.toFixed(3)} nat=${nat.score.toFixed(3)}`,
  );
});

test('classifier verdict labels high scores as likely-ai, never confirmed', () => {
  const v = classifierVerdict(0.9);
  assert.equal(v.type, 'likely-ai');
  assert.equal(v.method, 'classifier');
  assert.notEqual(v.type, 'confirmed-ai');
  assert.ok(v.confidence < 1 || v.confidence === 0.9);
});

test('classifier verdict low score → no-detection', () => {
  const v = classifierVerdict(0.2);
  assert.equal(v.type, 'no-detection');
});
