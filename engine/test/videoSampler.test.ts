import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VideoSampler } from '../src/video/videoSampler.js';
import { AegisPipeline } from '../src/pipeline.js';
import { makeNaturalFrame } from '../src/capture/frames.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('VideoSampler emits at most 1 frame per second (30fps stream → 1fps out)', () => {
  const s = new VideoSampler({ fps: 1 });
  const frame = makeNaturalFrame(64, 64, 0);
  let emitted = 0;
  // Simulate 90 frames at 30fps over 3 seconds (1 frame / 33.33ms)
  for (let i = 0; i < 90; i++) {
    const now = i * (1000 / 30);
    if (s.sample(frame, now)) emitted++;
  }
  assert.equal(emitted, 4); // t=0, 1000, 2000, 3000
  assert.equal(s.stats.totalFrames, 90);
  assert.equal(s.stats.emitted, 4);
});

test('VideoSampler reset clears state', () => {
  const s = new VideoSampler({ fps: 1 });
  s.sample(makeNaturalFrame(32, 32, 1), 0);
  s.reset();
  assert.equal(s.stats.totalFrames, 0);
  assert.equal(s.stats.emitted, 0);
});

test('pipeline.processVideo skips non-emitted frames (natural frame not escalated)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-video-'));
  const p = new AegisPipeline({ logDir: dir, configPath: join(dir, 'config.json') });
  try {
    const frame = makeNaturalFrame(64, 64, 3);
    const r1 = p.processVideo(frame, 0);
    assert.notEqual(r1, null);
    const r2 = p.processVideo(frame, 100); // within 1s window → dropped
    assert.equal(r2, null);
    const r3 = p.processVideo(frame, 1000); // past window → emitted
    assert.notEqual(r3, null);
    assert.equal(p.videoSampler.stats.emitted, 2);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});