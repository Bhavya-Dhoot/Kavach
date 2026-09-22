import type { FrameBuffer } from '../types.js';

export interface SynthIdDecode {
  found: boolean;
  confidence: number;
  generator?: string;
  payloadBits: number;
  ms: number;
}

interface WatermarkMeta {
  generator: string;
}

/**
 * Reference SynthID-style statistical watermark (architectural slot for the
 * real Google SynthID decoder on Hexagon NPU — PRD §7/§9).
 *
 * Embed: split payload into bits; each bit is spread across a pseudo-random
 * subset of 8x8 block means via ±delta amplitude modulation (spread spectrum).
 * Decode: recompute block means, correlate against the same PN masks, majority
 * vote per bit, then verify a CRC-style parity over the payload.
 *
 * Robust to mild additive noise and small resizes (block-mean averaging);
 * payload includes a magic header so false-positive rate stays near zero on
 * natural frames.
 */
const BLOCK = 8;
const MAGIC = [1, 0, 1, 1, 0, 0, 1, 0]; // 8-bit header
const GENERATORS: Record<string, number> = {
  'imagen': 1,
  'gemini-image': 2,
  'veo': 3,
  'third-party': 4,
};
// MAGIC(8) + generator(6) + parity(8) = payload width.
// Bits are spread over the frame's 8x8 blocks (each block carries one bit slot,
// determined by a deterministic permutation), and each bit is modulated as an
// intra-block checkerboard pattern (orthogonal to smooth image content).
const NUM_BITS = 8 + 6 + 8;

function payloadToBits(generator: string): number[] {
  const genId = GENERATORS[generator] ?? GENERATORS['third-party'];
  const bits: number[] = [...MAGIC];
  for (let i = 5; i >= 0; i--) bits.push((genId >> i) & 1);
  const salt = 0b1011010011101001;
  const mixed = (genId * 0x9e37 + salt) & 0xffff;
  for (let i = 7; i >= 0; i--) bits.push((mixed >> i) & 1);
  return bits; // NUM_BITS = 22
}

function bitsToVerdictBits(bits: number[]): { generator?: string; ok: boolean } {
  for (let i = 0; i < MAGIC.length; i++) {
    if (bits[i] !== MAGIC[i]) return { ok: false };
  }
  let genId = 0;
  for (let i = 8; i < 14; i++) genId = (genId << 1) | bits[i];
  let parity = 0;
  for (let i = 14; i < 22; i++) parity = (parity << 1) | bits[i];
  const salt = 0b1011010011101001;
  const expected = ((genId * 0x9e37 + salt) & 0xffff) & 0xff;
  if (parity !== expected) return { ok: false };
  const name = Object.entries(GENERATORS).find(([, id]) => id === genId)?.[0];
  return { ok: true, generator: name };
}

/** Deterministic pseudo-random permutation of [0, n). */
function permute(n: number, key: number): Uint32Array {
  let s = (key ^ 0x9e3779b9) >>> 0;
  const arr = new Uint32Array(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  for (let i = n - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Per (bit, slot) polarity sign, recovered identically at embed + decode time. */
function slotSign(bit: number, slotRank: number): 1 | -1 {
  let x = (bit * 2654435761 + slotRank * 40503 + 17) >>> 0;
  x ^= x >> 13; x >>>= 0;
  x ^= x << 17; x >>>= 0;
  return (x & 1) === 1 ? 1 : -1;
}

/** Intra-block checkerboard basis: +1 for x+y even, -1 otherwise. */
function checker(x: number, y: number): 1 | -1 {
  return (x + y) % 2 === 0 ? 1 : -1;
}

function blockGeom(frame: FrameBuffer): { cols: number; rows: number; numBlocks: number } {
  const cols = Math.floor(frame.width / BLOCK);
  const rows = Math.floor(frame.height / BLOCK);
  return { cols, rows, numBlocks: cols * rows };
}

function lumAt(frame: FrameBuffer, px: number, py: number): number {
  const i = (py * frame.width + px) * 3;
  return (frame.data[i] + frame.data[i + 1] + frame.data[i + 2]) / 3;
}

/**
 * Embed a watermark into a copy of the frame (used for fixtures/demo).
 */
export function embedWatermark(frame: FrameBuffer, generator: string, delta = 4): FrameBuffer {
  const out: FrameBuffer = {
    kind: frame.kind,
    width: frame.width,
    height: frame.height,
    data: new Uint8Array(frame.data),
  };
  const bits = payloadToBits(generator);
  const { cols, rows, numBlocks } = blockGeom(out);
  if (numBlocks < NUM_BITS * 4) {
    throw new Error('Frame too small to embed watermark');
  }
  const perm = permute(numBlocks, 0xa3e15 >>> 0);
  for (let slot = 0; slot < numBlocks; slot++) {
    const blockIdx = perm[slot];
    const bit = bits[slot % NUM_BITS];
    const sign = bit === 1 ? 1 : -1;
    const polarity = slotSign(slot % NUM_BITS, Math.floor(slot / NUM_BITS));
    const bx = blockIdx % cols;
    const by = Math.floor(blockIdx / cols);
    for (let y = 0; y < BLOCK; y++) {
      for (let x = 0; x < BLOCK; x++) {
        const v = polarity * sign * delta * checker(x, y);
        const px = bx * BLOCK + x;
        const py = by * BLOCK + y;
        const i = (py * out.width + px) * 3;
        out.data[i] = clamp(out.data[i] + v);
        out.data[i + 1] = clamp(out.data[i + 1] + v);
        out.data[i + 2] = clamp(out.data[i + 2] + v);
      }
    }
  }
  return out;
}

function extractBits(frame: FrameBuffer): { bits: number[]; confidences: number[] } {
  const { cols, rows, numBlocks } = blockGeom(frame);
  const { data, width } = frame;

  // Per-block checkerboard energy
  const energy = new Float64Array(numBlocks);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let e = 0;
      for (let y = 0; y < BLOCK; y++) {
        for (let x = 0; x < BLOCK; x++) {
          e += lumAt(frame, bx * BLOCK + x, by * BLOCK + y) * checker(x, y);
        }
      }
      energy[by * cols + bx] = e;
    }
  }

  const perm = permute(numBlocks, 0xa3e15 >>> 0);
  const acc = new Float64Array(NUM_BITS);
  const slotCount = new Uint32Array(NUM_BITS);
  for (let slot = 0; slot < numBlocks; slot++) {
    const bit = slot % NUM_BITS;
    const polarity = slotSign(bit, Math.floor(slot / NUM_BITS));
    acc[bit] += energy[perm[slot]] * polarity;
    slotCount[bit]++;
  }

  const bits: number[] = [];
  const confidences: number[] = [];
  for (let b = 0; b < NUM_BITS; b++) {
    const n = Math.max(1, slotCount[b]);
    const strength = Math.abs(acc[b]) / n;
    bits.push(acc[b] >= 0 ? 1 : 0);
    confidences.push(Math.min(1, Math.max(0, 1 - Math.exp(-strength / (BLOCK * BLOCK * 0.75)))));
  }
  return { bits, confidences };
}

/** Decode a SynthID-style watermark from a rendered frame. */
export function decodeSynthId(frame: FrameBuffer): SynthIdDecode {
  const t0 = performance.now();
  const { numBlocks } = blockGeom(frame);
  if (numBlocks < NUM_BITS * 4) {
    return { found: false, confidence: 0, payloadBits: 0, ms: performance.now() - t0 };
  }
  const { bits, confidences } = extractBits(frame);
  const parsed = bitsToVerdictBits(bits);
  const avgConf =
    confidences.reduce((a, b) => a + b, 0) / Math.max(1, confidences.length);
  const ms = performance.now() - t0;
  if (parsed.ok) {
    return {
      found: true,
      confidence: Math.min(1, 0.85 + avgConf * 0.15),
      generator: parsed.generator,
      payloadBits: NUM_BITS,
      ms,
    };
  }
  return { found: false, confidence: avgConf, payloadBits: NUM_BITS, ms };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
