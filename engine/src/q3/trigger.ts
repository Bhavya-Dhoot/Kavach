import type { FrameBuffer } from '../types.js';

export interface TriggerDecision {
  escalate: boolean;
  score: number;
  signals: string[];
  ms: number;
}

/**
 * Q3 always-on frame pre-filter (PRD §6/§9): binary triage under a tight
 * latency budget. High escalation score = synthetic-looking (flat bands,
 * low residual noise, unusual channel correlation).
 */
export function triggerFrame(frame: FrameBuffer): TriggerDecision {
  const t0 = performance.now();
  const { width, height, data } = frame;
  const n = width * height;
  if (n === 0) {
    return { escalate: false, score: 0, signals: ['empty-frame'], ms: 0 };
  }

  // 1) Local residual energy: median-ish of |p - right| + |p - down|
  let residual = 0;
  let count = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 3;
      const ir = i + 3;
      const id = ((y + 1) * width + x) * 3;
      residual +=
        Math.abs(data[i] - data[ir]) +
        Math.abs(data[i + 1] - data[ir + 1]) +
        Math.abs(data[i + 2] - data[ir + 2]);
      residual +=
        Math.abs(data[i] - data[id]) +
        Math.abs(data[i + 1] - data[id + 1]) +
        Math.abs(data[i + 2] - data[id + 2]);
      count += 6;
    }
  }
  const meanResidual = count ? residual / count : 0;

  // 2) Channel dynamic range (flat synthetic art compresses range per block)
  let minR = 255, maxR = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  const range = maxR - minR;

  const signals: string[] = [];
  let score = 0;

  // Natural photos: meanResidual typically > ~8; flat synthetic: < ~6
  if (meanResidual < 6) {
    score += 0.55;
    signals.push(`low-residual:${meanResidual.toFixed(2)}`);
  } else if (meanResidual < 9) {
    score += 0.25;
    signals.push(`marginal-residual:${meanResidual.toFixed(2)}`);
  }

  // Extremely smooth content with mid range → poster/generator look
  if (meanResidual < 4 && range > 40 && range < 200) {
    score += 0.3;
    signals.push('poster-flatness');
  }

  score = Math.min(1, score);
  const escalate = score >= 0.45;
  const ms = performance.now() - t0;
  return { escalate, score, signals, ms };
}
