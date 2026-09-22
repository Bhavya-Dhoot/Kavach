import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrlFeatures, levenshtein } from '../src/q3/urlFeatures.js';
import { loadSignatureCache } from '../src/phishing/signatureCache.js';
import { scoreUrl, applyPageAnalysis, thresholdsFor } from '../src/phishing/urlScorer.js';
import { analyzePageContent } from '../src/phishing/pageAnalyzer.js';

test('levenshtein basics', () => {
  assert.equal(levenshtein('paypal', 'paypal'), 0);
  assert.equal(levenshtein('paypa1', 'paypal'), 1);
});

test('signature cache blocks known-bad domain', () => {
  const cache = loadSignatureCache();
  assert.ok(cache.domains.size > 0, 'fixture signatures must load');
  const trig = extractUrlFeatures('https://secure-login-paypal.verify-user.top/login');
  const v = scoreUrl(
    { url: 'https://secure-login-paypal.verify-user.top/login', q3Score: trig.score, q3Signals: trig.signals },
    cache,
    'balanced',
  );
  assert.equal(v.level, 'blocked');
  assert.ok(v.signals.some((s) => s.startsWith('signature-cache-hit')));
});

test('benign URL scores safe', () => {
  const cache = loadSignatureCache();
  const url = 'https://example.com/docs/getting-started';
  const trig = extractUrlFeatures(url);
  const v = scoreUrl({ url, q3Score: trig.score, q3Signals: trig.signals }, cache, 'balanced');
  assert.equal(v.level, 'safe', `score=${v.score} signals=${v.signals.join(',')}`);
});

test('typosquat paypa1 raises risk signals', () => {
  const trig = extractUrlFeatures('https://paypa1-secure.account-verify.xyz/auth');
  assert.ok(trig.score > 0.3, `score=${trig.score}`);
  assert.ok(
    trig.signals.some((s) => s.includes('typosquat') || s.includes('brand-not-in-host') || s.includes('keyword')),
    `signals=${trig.signals.join(',')}`,
  );
});

test('homoglyph/IP/suspicious-TLD signals fire', () => {
  const ip = extractUrlFeatures('http://192.168.0.1/login');
  assert.ok(ip.signals.includes('ip-host'));
  const tld = extractUrlFeatures('https://totally-fake-prize.xyz/win');
  assert.ok(tld.signals.some((s) => s.startsWith('suspicious-tld')));
});

test('page analyzer detects login-form brand mismatch template', () => {
  const html = `
    <html><body>
    <img src="https://cdn.x.com/apple-logo.png" />
    <form><input type="text" name="username"/><input type="password" name="password"/></form>
    <p>Verify your Apple ID immediately or your account will be suspended.</p>
    </body></html>`;
  const r = analyzePageContent(html, 'random-host.example');
  assert.ok(r.score >= 0.4, `score=${r.score}`);
  assert.ok(r.signals.some((s) => s.includes('login-form-brand-mismatch') || s.startsWith('template:')));
});

test('page analysis can escalate suspicious → blocked', () => {
  const cache = loadSignatureCache();
  const url = 'https://unknown-shop.example/checkout';
  const trig = extractUrlFeatures(url);
  let v = scoreUrl({ url, q3Score: Math.max(trig.score, 0.45), q3Signals: trig.signals }, cache, 'balanced');
  assert.equal(v.level, 'suspicious');
  // Strong scam signals: fake-prize template + urgency + password form
  const page = analyzePageContent(
    '<form><input type="password" name="password"/></form> ' +
      'CONGRATULATIONS You have won a $500 gift card! Claim your prize now! ' +
      'Your account will be suspended within 24 hours if you do not verify immediately.',
    'unknown-shop.example',
  );
  v = applyPageAnalysis(v, page, 'strict');
  assert.equal(v.level, 'blocked', `expected blocked, got ${v.level} score=${v.score}`);
});

test('sensitivity thresholds follow PRD ladder', () => {
  assert.ok(thresholdsFor('strict').blocked < thresholdsFor('balanced').blocked);
  assert.ok(thresholdsFor('balanced').blocked < thresholdsFor('permissive').blocked);
});

test('phishing pre-tap score latency under 100ms', () => {
  const cache = loadSignatureCache();
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    const url = `https://paypa${i % 2 ? '1' : 'l'}-secure.example/login?user=x`;
    const trig = extractUrlFeatures(url);
    scoreUrl({ url, q3Score: trig.score, q3Signals: trig.signals }, cache, 'balanced');
  }
  const avg = (performance.now() - t0) / 20;
  assert.ok(avg < 100, `avg ${avg}ms`);
});
