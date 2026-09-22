export interface UrlTriggerResult {
  escalate: boolean;
  score: number;
  signals: string[];
  features: {
    host: string;
    pathname: string;
    isIpAddress: boolean;
    punycode: boolean;
    subdomainDepth: number;
    brandDistance: number;
    matchedBrand?: string;
    keywordHits: string[];
    suspiciousTld: boolean;
    hasAtSign: boolean;
    length: number;
  };
  ms: number;
}

const SUSPICIOUS_TLDS = new Set([
  'zip', 'mov', 'xyz', 'top', 'click', 'link', 'gq', 'tk', 'ml', 'cf', 'ga',
  'work', 'loan', 'country', 'stream', 'download', 'racing', 'review',
]);

const PHISH_KEYWORDS = [
  'login', 'signin', 'sign-in', 'verify', 'verification', 'secure', 'account',
  'update', 'confirm', 'password', 'banking', 'wallet', 'suspend', 'locked',
  'otp', 'SSN', 'refund', 'invoice', 'shipment', 'tracking', 'prize', 'lottery',
];

/** Common brand targets for typosquat / homoglyph distance. */
export const BRANDS = [
  'google', 'paypal', 'apple', 'amazon', 'facebook', 'instagram', 'whatsapp',
  'netflix', 'microsoft', 'outlook', 'chase', 'wellsfargo', 'bankofamerica',
  'citibank', 'americanexpress', 'venmo', 'cashapp', 'coinbase', 'binance',
  'dhl', 'fedex', 'usps', 'steam', 'epicgames', 'spotify', 'linkedin',
];

const HOMOGLYPH_MAP: Record<string, string> = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't',
  '8': 'b', '@': 'a', '$': 's', '!': 'i', а: 'a', е: 'e', о: 'o',
  р: 'p', с: 'c', у: 'y', х: 'x',
};

function normalizeHomoglyphs(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

/** Levenshtein distance, small-string optimized. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Q3 URL/domain feature extraction (PRD §8 step 1) — runs before any page
 * load. Produces a risk score in [0,1] plus human-readable signals.
 */
export function extractUrlFeatures(rawUrl: string): UrlTriggerResult {
  const t0 = performance.now();
  const signals: string[] = [];
  let score = 0;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      escalate: true,
      score: 0.9,
      signals: ['unparseable-url'],
      features: {
        host: '', pathname: '', isIpAddress: false, punycode: false,
        subdomainDepth: 0, brandDistance: 99, keywordHits: [],
        suspiciousTld: false, hasAtSign: rawUrl.includes('@'), length: rawUrl.length,
      },
      ms: performance.now() - t0,
    };
  }

  const host = url.hostname.toLowerCase();
  const isIpAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  const punycode = host.includes('xn--');
  const labels = host.split('.');
  const subdomainDepth = Math.max(0, labels.length - 2);
  const registrable = labels.slice(-2)[0] ?? host;
  const tld = labels[labels.length - 1] ?? '';
  const suspiciousTld = SUSPICIOUS_TLDS.has(tld);
  const hasAtSign = rawUrl.includes('@');

  if (isIpAddress) { score += 0.45; signals.push('ip-host'); }
  if (punycode) { score += 0.3; signals.push('punycode-host'); }
  if (suspiciousTld) { score += 0.2; signals.push(`suspicious-tld:${tld}`); }
  if (hasAtSign) { score += 0.25; signals.push('at-sign-obfuscation'); }
  if (subdomainDepth >= 3) { score += 0.15; signals.push(`deep-subdomains:${subdomainDepth}`); }
  if (rawUrl.length > 100) { score += 0.1; signals.push(`long-url:${rawUrl.length}`); }

  // Typosquat / homoglyph distance to known brands on the registrable label
  const normRegistrable = normalizeHomoglyphs(registrable);
  let brandDistance = 99;
  let matchedBrand: string | undefined;
  for (const brand of BRANDS) {
    if (normRegistrable.includes(brand) && normRegistrable !== brand) {
      // brand appears inside a different domain (paypa1-secure.com style after normalize)
      const d = levenshtein(normRegistrable, brand);
      if (d < brandDistance) { brandDistance = d; matchedBrand = brand; }
    } else if (normRegistrable !== brand) {
      const d = levenshtein(normRegistrable.replace(/\.(com|net|org|co|io)$/, ''), brand);
      if (d <= 2 && d < brandDistance) { brandDistance = d; matchedBrand = brand; }
    }
  }
  if (matchedBrand && brandDistance > 0 && brandDistance <= 2 && !BRANDS.includes(registrable.replace(/\..*$/, ''))) {
    // Distance 1-2 from a brand but not the brand itself → typosquat
    if (registrable !== `${matchedBrand}.com`) {
      score += 0.35 + (2 - brandDistance) * 0.1;
      signals.push(`typosquat:${matchedBrand}:d${brandDistance}`);
    }
  }

  // Homoglyph: original host differed from normalized form
  if (host !== normalizeHomoglyphs(host) && /[^\x00-\x7f]/.test(host)) {
    score += 0.3;
    signals.push('homoglyph-host');
  }

  const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
  const keywordHits = PHISH_KEYWORDS.filter((k) => haystack.includes(k.toLowerCase()));
  if (keywordHits.length >= 3) {
    score += 0.2;
    signals.push(`keyword-cluster:${keywordHits.slice(0, 4).join(',')}`);
  } else if (keywordHits.length === 2) {
    score += 0.1;
    signals.push(`keywords:${keywordHits.join(',')}`);
  }

  // Brand keyword in path/subdomain but not in registrable domain
  for (const brand of BRANDS) {
    if (!normRegistrable.includes(brand) && haystack.includes(brand)) {
      score += 0.25;
      signals.push(`brand-not-in-host:${brand}`);
      break;
    }
  }

  score = Math.min(1, score);
  const escalate = score >= 0.35;
  return {
    escalate,
    score,
    signals,
    features: {
      host, pathname: url.pathname, isIpAddress, punycode, subdomainDepth,
      brandDistance, matchedBrand, keywordHits, suspiciousTld, hasAtSign,
      length: rawUrl.length,
    },
    ms: performance.now() - t0,
  };
}
