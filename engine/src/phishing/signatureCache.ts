import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SignatureCache {
  domains: Set<string>;
  path: string;
  loadedAt: string;
}

const FIXTURE_CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'signatures.json'),
  join(process.cwd(), 'fixtures', 'signatures.json'),
  join(process.cwd(), 'engine', 'fixtures', 'signatures.json'),
];

/**
 * Local threat-signature cache (PRD §8 step 2). Loads from a local JSON file
 * only — the sync job that refreshes it over Wi-Fi is intentionally NOT wired
 * into detection (offline-first, zero egress during scoring).
 */
export function loadSignatureCache(explicitPath?: string): SignatureCache {
  const paths = explicitPath ? [explicitPath] : FIXTURE_CANDIDATES;
  for (const p of paths) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { domains?: string[] };
      return {
        domains: new Set((raw.domains ?? []).map((d) => d.toLowerCase())),
        path: p,
        loadedAt: new Date().toISOString(),
      };
    } catch {
      // try next
    }
  }
  return { domains: new Set(), path: '(empty)', loadedAt: new Date().toISOString() };
}
