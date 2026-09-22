import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, weekStartOf } from '../src/digest.js';
import type { DetectionEvent } from '../src/types.js';

function ev(channel: 'ai-media' | 'phishing', verdict: string, signals: string[] = []): DetectionEvent {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    channel,
    source: channel === 'ai-media' ? 'image' : 'link',
    verdict,
    confidence: 0.9,
    signals,
    overlay: channel === 'ai-media' ? 'badge-likely' : 'badge-link-risk',
  };
}

test('weekStartOf returns Monday for a mid-week date', () => {
  const d = new Date('2026-09-23T12:00:00Z'); // Wednesday
  const ws = weekStartOf(d);
  assert.equal(ws.getUTCDay(), 1); // Monday
  assert.equal(ws.getUTCDate(), 21);
});

test('buildDigest produces PRD §10 human sentence', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const events: DetectionEvent[] = [
    ...Array.from({ length: 5 }, () => ev('ai-media', 'confirmed-ai')),
    ...Array.from({ length: 7 }, () => ev('ai-media', 'likely-ai')),
    ...Array.from({ length: 3 }, () => ev('phishing', 'blocked')),
    ...Array.from({ length: 2 }, () => ev('phishing', 'suspicious')),
  ];
  const d = buildDigest(events, now);
  assert.equal(d.aiConfirmed, 5);
  assert.equal(d.aiLikely, 7);
  assert.equal(d.phishingBlocked, 3);
  assert.equal(d.phishingSuspicious, 2);
  assert.equal(d.totalEvents, 17);
  assert.match(d.human, /12 AI/);
  assert.match(d.human, /3 scam links/);
  assert.match(d.human, /2 suspicious/);
});

test('buildDigest excludes events from previous weeks', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const old: DetectionEvent = { ...ev('phishing', 'blocked'), timestamp: '2026-09-01T00:00:00Z' };
  const fresh = ev('ai-media', 'confirmed-ai');
  const d = buildDigest([old, fresh], now);
  assert.equal(d.phishingBlocked, 0);
  assert.equal(d.aiConfirmed, 1);
});

test('buildDigest: empty week → "found nothing suspicious"', () => {
  const d = buildDigest([], new Date('2026-09-23T12:00:00Z'));
  assert.match(d.human, /found nothing suspicious/);
});

test('buildDigest: top signals ranked by frequency', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const events: DetectionEvent[] = [
    ev('phishing', 'blocked', ['typosquat', 'keyword:verify']),
    ev('phishing', 'suspicious', ['typosquat', 'keyword:verify', 'keyword:secure']),
    ev('phishing', 'blocked', ['typosquat']),
  ];
  const d = buildDigest(events, now);
  assert.deepEqual(d.topSignals[0], ['typosquat', 3]);
});