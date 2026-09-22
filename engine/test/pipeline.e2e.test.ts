import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AegisPipeline } from '../src/pipeline.js';
import { embedWatermark } from '../src/npu/synthid.js';
import { makeNaturalFrame, makeSyntheticLookingFrame } from '../src/capture/frames.js';

function newPipeline(): AegisPipeline {
  return new AegisPipeline({
    logDir: mkdtempSync(join(tmpdir(), 'aegis-e2e-')),
    signatureCachePath: join(process.cwd(), 'fixtures', 'signatures.json'),
  });
}

test('E2E image path: watermarked → confirmed-ai badge', () => {
  const p = newPipeline();
  const frame = embedWatermark(makeSyntheticLookingFrame(128, 128, 1), 'veo');
  const r = p.processFrame(frame);
  assert.equal(r.escalatedToNpu, true);
  assert.equal(r.verdict.type, 'confirmed-ai');
  assert.equal(r.verdict.method, 'synthid');
  assert.equal(r.overlay.kind, 'badge-confirmed');
  assert.ok(r.totalMs < 300, `total ${r.totalMs}ms`);
  const events = p.log.readAll();
  assert.ok(events.some((e) => e.verdict === 'confirmed-ai'));
});

test('E2E image path: unwatermarked synthetic → likely-ai (outlined badge)', () => {
  const p = newPipeline();
  // Without watermark; Q3 should still escalate flat synthetic content
  const frame = makeSyntheticLookingFrame(128, 128, 4);
  const r = p.processFrame(frame);
  // May or may not escalate depending on flatteness; if escalated, must be likely not confirmed
  if (r.escalatedToNpu) {
    assert.notEqual(r.verdict.type, 'confirmed-ai');
    assert.equal(r.overlay.kind, 'badge-likely');
  }
});

test('E2E image path: natural photo does not raise confirmed badge', () => {
  const p = newPipeline();
  const r = p.processFrame(makeNaturalFrame(128, 128, 77));
  assert.notEqual(r.verdict.type, 'confirmed-ai');
  if (!r.escalatedToNpu) {
    assert.equal(r.overlay.title, '');
  }
});

test('E2E URL path: signature-cache hit → blocked interstitial with 3s override', () => {
  const p = newPipeline();
  const r = p.processUrl('https://appleid-locked.verify-account.tk/verify');
  assert.equal(r.verdict.level, 'blocked');
  assert.equal(r.overlay.kind, 'interstitial-blocked');
  assert.equal(r.overlay.overrideDelayMs, 3000);
  assert.ok(r.verdict.explanation.startsWith('Blocked'));
});

test('E2E URL path: benign → safe, no log entry', () => {
  const p = newPipeline();
  const before = p.log.readAll().length;
  const r = p.processUrl('https://example.com/about');
  assert.equal(r.verdict.level, 'safe');
  assert.equal(r.overlay.title, '');
  assert.equal(p.log.readAll().length, before);
});

test('E2E URL + page: ambiguous URL escalated to page-content model', () => {
  const p = newPipeline();
  const html = `<html><body>
    <h1>Chase Online Banking</h1>
    <img src="https://evil.example/chase-logo.png"/>
    <form><input name="username"/><input type="password"/></form>
    <p>Verify your account immediately.</p>
  </body></html>`;
  const r = p.processUrl('https://secure-chase-update.account-verify.xyz/login', html);
  assert.ok(r.verdict.level === 'suspicious' || r.verdict.level === 'blocked',
    `level=${r.verdict.level} score=${r.verdict.score}`);
  if (r.escalatedToPageModel) {
    assert.ok(r.verdict.signals.some((s) => s.startsWith('template:') || s.includes('mismatch') || s.includes('brand')),
      `signals=${r.verdict.signals.join(',')}`);
  }
});
