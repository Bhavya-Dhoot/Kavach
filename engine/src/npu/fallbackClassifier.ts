import type { AiVerdict, FrameBuffer } from '../types.js';

export interface ClassifierScore {
  score: number;
  features: Record<string, number>;
  ms: number;
}

/**
 * Fallback generative-artifact classifier (PRD §7 step 4 / §9).
 * Hand-tuned logistic-style model over classic synthetic-media cues:
 * flat residual, limited palette entropy, gradient banding, channel coupling.
 * Never certifies — output is always probabilistic (likely-ai label).
 */
export function classifyGenerativeArtifacts(frame: FrameBuffer): ClassifierScore {
  const t0 = performance.now();
  const { width, height, data } = frame;
  const n = width * height;

  // Residual (high-frequency energy)
  let residual = 0;
  let rc = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 3;
      residual += Math.abs(data[i] - data[i + 3]) + Math.abs(data[i + 1] - data[i + 4]);
      rc += 2;
    }
  }
  const meanResidual = rc ? residual / rc : 0;

  // Palette breadth: count occupied 16-level bins per channel (sampled)
  const bins = new Set<number>();
  let samples = 0;
  for (let i = 0; i < data.length; i += 3 * 7) {
    bins.add((data[i] >> 4) * 16 + (data[i + 1] >> 4) * 4 + (data[i + 2] >> 4));
    samples++;
  }
  const paletteDensity = samples ? bins.size / samples : 0;

  // Gradient banding: fraction of horizontal steps that are exact repeats
  let bandSteps = 0;
  let bandTotal = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = (y * width + x) * 3;
      const p = i - 3;
      if (data[i] === data[p] && data[i + 1] === data[p + 1] && data[i + 2] === data[p + 2]) {
        bandSteps++;
      }
      bandTotal++;
    }
  }
  const bandRatio = bandTotal ? bandSteps / bandTotal : 0;

  // Channel coupling: |R-G| mean (synthetic art often has tight coupling)
  let rg = 0;
  for (let i = 0; i < data.length; i += 3) {
    rg += Math.abs(data[i] - data[i + 1]);
  }
  const meanRg = n ? rg / n : 0;

  const features = { meanResidual, paletteDensity, bandRatio, meanRg };

  // Logit: flat + banded + narrow palette → high score
  let logit = -2.2;
  logit += meanResidual < 6 ? 1.6 : meanResidual < 10 ? 0.6 : -0.8;
  logit += paletteDensity < 0.35 ? 0.9 : paletteDensity < 0.55 ? 0.2 : -0.5;
  logit += bandRatio > 0.35 ? 0.9 : bandRatio > 0.2 ? 0.3 : -0.3;
  logit += meanRg < 25 ? 0.5 : meanRg < 45 ? 0.1 : -0.4;

  const score = 1 / (1 + Math.exp(-logit));
  const ms = performance.now() - t0;
  return { score, features, ms };
}

export function classifierVerdict(score: number): AiVerdict {
  if (score >= 0.7) {
    return {
      type: 'likely-ai',
      confidence: Number(score.toFixed(4)),
      method: 'classifier',
      label: 'Likely AI-generated (unwatermarked)',
    };
  }
  return {
    type: 'no-detection',
    confidence: Number((1 - score).toFixed(4)),
    method: 'classifier',
    label: 'No AI signal',
  };
}
