import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedLog } from '../src/log.js';
import type { DetectionEvent } from '../src/types.js';

function ev(id: string): DetectionEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    channel: 'ai-media',
    source: 'image',
    verdict: 'confirmed-ai',
    confidence: 0.99,
    signals: ['low-residual'],
    overlay: 'badge-confirmed',
  };
}

test('encrypted log roundtrip: ciphertext on disk, plaintext in memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-log-'));
  const path = join(dir, 'events.enc');
  const log = new EncryptedLog(path);
  log.append(ev('a1'));
  log.append(ev('b2'));

  const blob = readFileSync(path, 'utf8');
  assert.ok(!blob.includes('confirmed-ai'), 'ciphertext must not contain plaintext verdicts');
  assert.ok(blob.includes(':'), 'format iv:tag:data');

  const records = log.readAll();
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'a1');
  assert.equal(records[1].id, 'b2');
});

test('purge clears events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-log-'));
  const log = new EncryptedLog(join(dir, 'events.enc'));
  log.append(ev('x'));
  assert.equal(log.readAll().length, 1);
  log.purge();
  assert.equal(log.readAll().length, 0);
});

test('tampered ciphertext fails authentication (GCM)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-log-'));
  const path = join(dir, 'events.enc');
  const log = new EncryptedLog(path);
  log.append(ev('t1'));
  const blob = readFileSync(path, 'utf8');
  const parts = blob.split(':');
  // flip a hex digit in data payload
  const data = parts[2];
  const flipped = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);
  writeFileSync(path, `${parts[0]}:${parts[1]}:${flipped}`);
  const log2 = new EncryptedLog(path);
  assert.throws(() => log2.readAll());
});
