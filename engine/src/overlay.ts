import type { AiVerdict, OverlayAction } from './types.js';

/** Map verdicts to the system overlay presentation (PRD §7/§8 UX rules). */
export function overlayForAi(verdict: AiVerdict): OverlayAction {
  if (verdict.type === 'confirmed-ai') {
    return {
      kind: 'badge-confirmed',
      title: 'Confirmed AI-generated',
      detail: `Watermark verified (${verdict.generator ?? 'generator unknown'}) · confidence ${(verdict.confidence * 100).toFixed(1)}%`,
      canOverride: true,
      overrideDelayMs: 0,
    };
  }
  if (verdict.type === 'likely-ai') {
    return {
      kind: 'badge-likely',
      title: 'Likely AI-generated',
      detail: `Unwatermarked classifier score ${(verdict.confidence * 100).toFixed(1)}% — probabilistic, not certain`,
      canOverride: true,
      overrideDelayMs: 0,
    };
  }
  return {
    kind: 'badge-likely',
    title: '',
    detail: '',
    canOverride: false,
    overrideDelayMs: 0,
  };
}

export function overlayForPhishing(
  level: 'safe' | 'suspicious' | 'blocked',
  explanation: string,
): OverlayAction {
  if (level === 'blocked') {
    return {
      kind: 'interstitial-blocked',
      title: 'Blocked: likely scam page',
      detail: explanation,
      canOverride: true,
      // PRD §8: deliberate second tap + 3s delay vs panic-tap-through
      overrideDelayMs: 3000,
    };
  }
  if (level === 'suspicious') {
    return {
      kind: 'badge-link-risk',
      title: 'Suspicious link',
      detail: explanation,
      canOverride: true,
      overrideDelayMs: 0,
    };
  }
  return {
    kind: 'badge-link-risk',
    title: '',
    detail: '',
    canOverride: false,
    overrideDelayMs: 0,
  };
}
