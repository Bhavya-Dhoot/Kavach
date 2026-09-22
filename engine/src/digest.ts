import type { DetectionEvent } from './types.js';

export interface Digest {
  /** ISO week start (Monday). */
  weekStart: string;
  totalEvents: number;
  aiConfirmed: number;
  aiLikely: number;
  phishingBlocked: number;
  phishingSuspicious: number;
  /** Top signals by frequency (drives "why was this flagged"). */
  topSignals: Array<[string, number]>;
  human: string;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Week start (Monday 00:00 UTC) for a given instant. */
export function weekStartOf(date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

/**
 * PRD §10 weekly digest notification:
 * "Aegis Shield flagged 12 AI images and blocked 3 scam links this week."
 * Aggregated entirely on-device from the encrypted log.
 */
export function buildDigest(events: DetectionEvent[], now = new Date()): Digest {
  const weekStart = weekStartOf(now).getTime();
  const week = events.filter((e) => new Date(e.timestamp).getTime() >= weekStart);

  let aiConfirmed = 0;
  let aiLikely = 0;
  let blocked = 0;
  let suspicious = 0;
  const signalCounts = new Map<string, number>();

  for (const e of week) {
    if (e.channel === 'ai-media') {
      if (e.verdict === 'confirmed-ai') aiConfirmed++;
      else if (e.verdict === 'likely-ai') aiLikely++;
    } else {
      if (e.verdict === 'blocked') blocked++;
      else if (e.verdict === 'suspicious') suspicious++;
    }
    for (const s of e.signals ?? []) {
      signalCounts.set(s, (signalCounts.get(s) ?? 0) + 1);
    }
  }

  const topSignals: Array<[string, number]> = [...signalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const parts: string[] = [];
  if (aiConfirmed + aiLikely > 0) {
    parts.push(
      `flagged ${aiConfirmed + aiLikely} AI ${
        aiConfirmed + aiLikely === 1 ? 'image/video' : 'images/videos'
      }`,
    );
  }
  if (blocked > 0) parts.push(`blocked ${blocked} scam ${blocked === 1 ? 'link' : 'links'}`);
  if (suspicious > 0) parts.push(`warned about ${suspicious} suspicious ${suspicious === 1 ? 'link' : 'links'}`);
  if (parts.length === 0) parts.push('found nothing suspicious this week');

  return {
    weekStart: weekStartOf(now).toISOString(),
    totalEvents: week.length,
    aiConfirmed,
    aiLikely,
    phishingBlocked: blocked,
    phishingSuspicious: suspicious,
    topSignals,
    human: `Aegis Shield ${parts.join(' and ')}.`,
  };
}