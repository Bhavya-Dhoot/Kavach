import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls } from '../src/surfaces/messageScanner.js';
import { AegisPipeline } from '../src/pipeline.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tempPipeline(): { p: AegisPipeline; configDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-msg-'));
  return {
    p: new AegisPipeline({ logDir: dir, configPath: join(dir, 'config.json') }),
    configDir: dir,
  };
}

test('extractUrls finds multiple URLs in SMS-style text', () => {
  const hits = extractUrls(
    'Hey, use https://paypa1-secure.verify-user.top/login to verify, or check www.example.com/docs for help.',
  );
  assert.equal(hits.length, 2);
  assert.ok(hits[0].url.startsWith('https://paypa1-secure'));
  assert.ok(hits[1].url.startsWith('https://www.example.com'));
});

test('extractUrls handles URL without scheme (bare domain)', () => {
  const hits = extractUrls('go to paypa1.com/bank now');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, 'https://paypa1.com/bank');
});

test('extractUrls trims trailing punctuation', () => {
  const hits = extractUrls('see https://example.com/path, ok?');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, 'https://example.com/path');
});

test('scanMessage scores phishing URL as blocked, benign as safe, worst=blocked', () => {
  const p = tempPipeline();
  try {
    const r = p.processMessage(
      'click https://secure-login-paypal.verify-user.top/login or https://example.com/docs',
    );
    assert.equal(r.hits.length, 2);
    assert.equal(r.verdicts[0].verdict.level, 'blocked');
    assert.equal(r.verdicts[1].verdict.level, 'safe');
    assert.equal(r.worst, 'blocked');
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('scanMessage: text with no URLs returns empty hits, worst=safe', () => {
  const p = tempPipeline();
  const r = p.processMessage('no links here at all');
  assert.equal(r.hits.length, 0);
  assert.equal(r.worst, 'safe');
});