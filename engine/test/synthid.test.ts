import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSynthId, embedWatermark } from '../src/npu/synthid.js';
import { makeNaturalFrame, makeSyntheticLookingFrame } from '../src/capture/frames.js';

test('watermark embed/decode roundtrip confirms AI + generator', () => {
  const frame = makeSyntheticLookingFrame(128, 128, 21);
  const wm = embedWatermark(frame, 'imagen');
  const d = decodeSynthId(wm);
  assert.equal(d.found, true, `expected watermark found, got conf=${d.confidence}`);
  assert.equal(d.generator, 'imagen');
  assert.ok(d.confidence > 0.85);
});

test('natural unwatermarked frames do not false-positive', () => {
  const nat = makeNaturalFrame(128, 128, 33);
  const d = decodeSynthId(nat);
  assert.equal(d.found, false, `false positive conf=${d.confidence} gen=${d.generator}`);
});

test('generator family is recovered correctly for gemini-image', () => {
  const frame = makeSyntheticLookingFrame(128, 128, 55);
  const wm = embedWatermark(frame, 'gemini-image');
  const d = decodeSynthId(wm);
  assert.equal(d.found, true);
  assert.equal(d.generator, 'gemini-image');
});

test('watermark decode latency under 250ms NPU budget', () => {
  const frame = embedWatermark(makeSyntheticLookingFrame(128, 128, 8), 'veo');
  const d = decodeSynthId(frame);
  assert.ok(d.ms < 250, `decode took ${d.ms}ms`);
});
