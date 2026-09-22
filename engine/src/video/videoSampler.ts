import type { FrameBuffer } from '../types.js';

export interface SampledFrame {
  frame: FrameBuffer;
  index: number;
  elapsedMs: number;
}

export interface VideoSamplerOptions {
  /** Frames per second emitted downstream (PRD §9: 1fps). */
  fps?: number;
}

/**
 * PRD §9 video path: "video frames sampled at 1fps during playback" with no
 * CPU contention. This is a stateful throttle — it passes at most `fps` frames
 * per second from a high-rate frame stream (e.g. 30fps playback) to the Q3 /
 * NPU pipeline, dropping everything in between.
 */
export class VideoSampler {
  readonly fps: number;
  readonly intervalMs: number;
  private lastEmit = 0;
  private totalFrames = 0;
  private emitted = 0;

  constructor(opts: VideoSamplerOptions = {}) {
    this.fps = opts.fps ?? 1;
    this.intervalMs = 1000 / this.fps;
  }

  /** Feed a frame from the playback stream; emit only if the throttle window elapsed. */
  sample(frame: FrameBuffer, now = performance.now()): SampledFrame | null {
    this.totalFrames++;
    if (this.emitted === 0 || now - this.lastEmit >= this.intervalMs) {
      this.lastEmit = now;
      const out: SampledFrame = {
        frame,
        index: this.emitted,
        elapsedMs: this.totalFrames === 1 ? 0 : now - this.firstSeen(now),
      };
      this.emitted++;
      return out;
    }
    return null;
  }

  private firstSeen(now: number): number {
    void now;
    return this.intervalMs * (this.emitted - 1);
  }

  get stats(): { totalFrames: number; emitted: number } {
    return { totalFrames: this.totalFrames, emitted: this.emitted };
  }

  reset(): void {
    this.totalFrames = 0;
    this.emitted = 0;
    this.lastEmit = 0;
  }
}