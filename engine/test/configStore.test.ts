import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AegisPipeline } from '../src/pipeline.js';
import { makeNaturalFrame, makeSyntheticLookingFrame } from '../src/capture/frames.js';
import { embedWatermark } from '../src/npu/synthid.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tempPipeline(): { p: AegisPipeline; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-config-'));
  return {
    p: new AegisPipeline({ logDir: dir, configPath: join(dir, 'config.json') }),
    dir,
  };
}

test('per-app toggle: disabled app skips scoring (no-detection, signal reason)', () => {
  const { p, dir } = tempPipeline();
  try {
    p.setAppEnabled('com.scam.app', false);
    assert.equal(p.config.appEnabled('com.scam.app'), false);
    const wm = embedWatermark(makeSyntheticLookingFrame(64, 64, 5), 'imagen');
    const r = p.processFrame(wm, 'com.scam.app');
    assert.equal(r.escalatedToNpu, false);
    assert.equal(r.verdict.type, 'no-detection');
    assert.ok(r.event.signals.some((s) => s.includes('disabled')));
    // Enabled app still scores
    const r2 = p.processFrame(wm, 'other.app');
    assert.equal(r2.escalatedToNpu, true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('allowlist: blocked host exempt after override, removed after disallow', () => {
  const { p, dir } = tempPipeline();
  try {
    const bad = 'https://secure-login-paypal.verify-user.top/login';
    assert.equal(p.processUrl(bad).verdict.level, 'blocked');
    p.overrideBlocked('verify-user.top', 'user clicked through');
    assert.equal(p.config.isAllowed('verify-user.top'), true);
    const after = p.processUrl(bad);
    assert.equal(after.verdict.level, 'safe');
    assert.ok(after.verdict.signals.includes('allowlisted'));
    p.config.removeAllow('verify-user.top');
    assert.equal(p.processUrl(bad).verdict.level, 'blocked');
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('allowlist persists across pipeline instances (config.json reload)', () => {
  const { p, dir } = tempPipeline();
  try {
    p.overrideBlocked('evil.example');
    const p2 = new AegisPipeline({ logDir: dir, configPath: join(dir, 'config.json') });
    assert.equal(p2.config.isAllowed('evil.example'), true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('natural frame in enabled app still runs pipeline normally', () => {
  const { p, dir } = tempPipeline();
  try {
    const r = p.processFrame(makeNaturalFrame(64, 64, 11), 'com.android.chrome');
    assert.equal(r.verdict.type, 'no-detection');
    assert.equal(r.totalMs > 0, true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});