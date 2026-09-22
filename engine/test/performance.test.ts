import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AegisPipeline } from '../src/pipeline.js';
import { embedWatermark } from '../src/npu/synthid.js';
import { makeSyntheticLookingFrame, makeNaturalFrame } from '../src/capture/frames.js';

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1);
  return s[idx];
}

test('PRD §11: image path p95 < 300ms (render → badge)', () => {
  const p = new AegisPipeline({
    logDir: mkdtempSync(join(tmpdir(), 'aegis-perf-')),
    signatureCachePath: join(process.cwd(), 'fixtures', 'signatures.json'),
  });
  const samples: number[] = [];
  for (let i = 0; i < 40; i++) {
    const frame =
      i % 3 === 0
        ? embedWatermark(makeSyntheticLookingFrame(128, 128, i + 1), 'imagen')
        : i % 3 === 1
          ? makeSyntheticLookingFrame(128, 128, i + 1)
          : makeNaturalFrame(128, 128, i + 1);
    samples.push(p.processFrame(frame).totalMs);
  }
  const p95ms = p95(samples);
  const max = Math.max(...samples);
  console.log(`  image p95=${p95ms.toFixed(1)}ms max=${max.toFixed(1)}ms`);
  assert.ok(p95ms < 300, `image p95 ${p95ms}ms >= 300ms budget`);
});

test('PRD §11: phishing pre-tap p95 < 100ms (Q3-only URL path)', () => {
  const p = new AegisPipeline({
    logDir: mkdtempSync(join(tmpdir(), 'aegis-perf-u-')),
    signatureCachePath: join(process.cwd(), 'fixtures', 'signatures.json'),
  });
  const urls = [
    'https://example.com/a',
    'https://paypa1-secure.verify-user.top/login',
    'http://192.168.1.1/admin',
    'https://totally-safe.org/article',
    'https://appleid-locked.verify-account.tk/x',
    'https://my-shop.example/store?item=1',
    'https://chase-auth-update.suspicious-secure.ml/verify',
    'https://news.example/2026/story',
  ];
  const samples: number[] = [];
  for (let i = 0; i < 60; i++) {
    samples.push(p.processUrl(urls[i % urls.length]).totalMs);
  }
  const p95ms = p95(samples);
  const max = Math.max(...samples);
  console.log(`  url p95=${p95ms.toFixed(1)}ms max=${max.toFixed(1)}ms`);
  assert.ok(p95ms < 100, `url p95 ${p95ms}ms >= 100ms budget`);
});
