import type { PhishingVerdict, Sensitivity } from '../types.js';
import type { SignatureCache } from './signatureCache.js';

export interface UrlScoreInput {
  url: string;
  q3Score: number;
  q3Signals: string[];
}

export interface PageScoreInput {
  html: string;
  host: string;
}

interface Thresholds {
  suspicious: number;
  blocked: number;
}

/** Sensitivity ladder (PRD §10 Settings): stricter ⇒ lower thresholds. */
export function thresholdsFor(sensitivity: Sensitivity): Thresholds {
  switch (sensitivity) {
    case 'strict':
      return { suspicious: 0.3, blocked: 0.55 };
    case 'permissive':
      return { suspicious: 0.5, blocked: 0.8 };
    case 'balanced':
    default:
      return { suspicious: 0.4, blocked: 0.7 };
  }
}

export function scoreUrl(
  input: UrlScoreInput,
  cache: SignatureCache,
  sensitivity: Sensitivity,
): PhishingVerdict {
  const signals = [...input.q3Signals];
  let score = input.q3Score;

  let host = '';
  try {
    host = new URL(input.url).hostname.toLowerCase();
  } catch {
    host = '';
  }

  // Signature cache hit → hard block tier (PRD §8 step 2)
  const hit =
    cache.domains.has(host) ||
    [...cache.domains].some((d) => host === d || host.endsWith(`.${d}`));
  if (hit) {
    signals.push(`signature-cache-hit:${host}`);
    score = Math.max(score, 0.95);
  }

  const th = thresholdsFor(sensitivity);
  let level: PhishingVerdict['level'] = 'safe';
  if (score >= th.blocked) level = 'blocked';
  else if (score >= th.suspicious) level = 'suspicious';

  return {
    level,
    score: Number(score.toFixed(4)),
    signals,
    explanation: explain(level, signals, host),
  };
}

export function applyPageAnalysis(
  base: PhishingVerdict,
  page: { score: number; signals: string[]; template?: string },
  sensitivity: Sensitivity,
): PhishingVerdict {
  // Page-content evidence should dominate when it is strong: blend with a
  // heavier weight on the page pass, and bump when a known scam template fires.
  const th = thresholdsFor(sensitivity);
  const score = Math.min(
    1,
    base.score * 0.4 + page.score * 0.6 + (page.template ? 0.05 : 0),
  );
  const signals = [...base.signals, ...page.signals];
  let level: PhishingVerdict['level'] = base.level;
  if (score >= th.blocked) level = 'blocked';
  else if (score >= th.suspicious && level !== 'blocked') level = 'suspicious';
  // URL signature hit stays blocked
  if (base.signals.some((s) => s.startsWith('signature-cache-hit'))) level = 'blocked';

  return {
    level,
    score: Number(score.toFixed(4)),
    signals,
    explanation: explain(level, signals, page.template ?? ''),
  };
}

function explain(level: string, signals: string[], context: string): string {
  const top = signals.slice(0, 3).join('; ');
  if (level === 'blocked') {
    return `Blocked: high-risk link${context ? ` (${context})` : ''}. Signals: ${top}`;
  }
  if (level === 'suspicious') {
    return `Suspicious: proceed with caution. Signals: ${top}`;
  }
  return `Safe: no strong risk signals${signals.length ? ` (noted: ${top})` : ''}.`;
}
