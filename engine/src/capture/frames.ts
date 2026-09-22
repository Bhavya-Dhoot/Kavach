import type { FrameBuffer } from '../types.js';

/** Deterministic PRNG (xorshift32) for reproducible synthetic frames and watermarks. */
export function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Natural-looking photo-ish frame: smooth gradients + mild noise. */
export function makeNaturalFrame(width = 64, height = 64, seed = 1): FrameBuffer {
  const rand = xorshift32(seed);
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const g = Math.floor((x / width) * 120 + (y / height) * 80 + 40);
      const n = Math.floor((rand() - 0.5) * 28);
      data[i] = clamp(g + n + 20);
      data[i + 1] = clamp(g + n);
      data[i + 2] = clamp(g + n - 15);
    }
  }
  return { kind: 'image', width, height, data };
}

/** Low-variance synthetic frame that trips the Q3 pre-filter (AI-like uniformity). */
export function makeSyntheticLookingFrame(width = 64, height = 64, seed = 2): FrameBuffer {
  const f = makeNaturalFrame(width, height, seed);
  // Flatten local variance: uniform poster-like bands
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const band = Math.floor(x / 8) * 18 + Math.floor(y / 8) * 7;
      f.data[i] = clamp(90 + band);
      f.data[i + 1] = clamp(110 + band);
      f.data[i + 2] = clamp(150 + Math.floor(band / 2));
    }
  }
  return f;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Minimal binary PPM (P6) reader for CLI `check-image`. */
export function decodePpm(buf: Uint8Array): FrameBuffer {
  const text = Buffer.from(buf.subarray(0, Math.min(buf.length, 512))).toString('latin1');
  const m = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(text);
  if (!m) throw new Error('Not a binary PPM (P6) image');
  const width = Number(m[1]);
  const height = Number(m[2]);
  const maxval = Number(m[3]);
  if (maxval !== 255) throw new Error('Only maxval=255 PPM supported');
  const headerLen = m[0].length;
  const expected = width * height * 3;
  const pixels = buf.subarray(headerLen, headerLen + expected);
  if (pixels.length < expected) throw new Error('Truncated PPM');
  return { kind: 'image', width, height, data: new Uint8Array(pixels) };
}
