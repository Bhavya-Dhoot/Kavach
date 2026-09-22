import type { PhishingVerdict, UrlResult } from '../types.js';
import type { AegisPipeline } from '../pipeline.js';

export interface MessageScanHit {
  url: string;
  start: number;
  end: number;
}

export interface MessageScanResult {
  text: string;
  hits: MessageScanHit[];
  verdicts: UrlResult[];
  worst: PhishingVerdict['level'];
}

/**
 * PRD §8 coverage: "a link is surfaced anywhere on-device (SMS, email,
 * browser, messaging apps, QR scan)". Takes free text from an SMS / email /
 * chat message, extracts every URL, and scores each through the pipeline
 * (pre-tap). Fully offline.
 */
const URL_RE =
  /(?:https?:\/\/|(?:www\.))[^\s<>"'\u2028\u2029]+/gi;

export function extractUrls(text: string): MessageScanHit[] {
  const hits: MessageScanHit[] = [];
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let url = m[0];
    // Tolerate URLs pasted without scheme (SMS does this): treat bare
    // "www.example.com" and naked domains as https.
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    // Trim trailing punctuation that is not part of the URL.
    url = url.replace(/[.,;:!?)\]}>"'»]+$/, '');
    hits.push({ url, start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

export function scanMessage(pipeline: AegisPipeline, text: string): MessageScanResult {
  const hits = extractUrls(text);
  const verdicts = hits.map((h) => pipeline.processUrl(h.url));
  const levels: PhishingVerdict['level'][] = verdicts.map((v) => v.verdict.level);
  const worst: PhishingVerdict['level'] = levels.includes('blocked')
    ? 'blocked'
    : levels.includes('suspicious')
      ? 'suspicious'
      : 'safe';
  return { text, hits, verdicts, worst };
}