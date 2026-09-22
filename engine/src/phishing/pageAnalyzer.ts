export interface PageAnalysis {
  score: number;
  signals: string[];
  template?: string;
}

/**
 * Lightweight on-device page-content pass (PRD §8 step 3). Input is a raw
 * HTML string (or accessibility text snapshot + markup). Pattern-matches
 * known scam templates and brand/login mismatches — never leaves the device.
 */
export function analyzePageContent(
  html: string,
  pageHost: string,
  knownBrands: string[] = [
    'paypal', 'apple', 'amazon', 'google', 'microsoft', 'chase', 'wellsfargo',
    'netflix', 'dhl', 'fedex', 'usps',
  ],
): PageAnalysis {
  const signals: string[] = [];
  let score = 0;
  const lower = html.toLowerCase();
  const host = pageHost.toLowerCase();

  const hasPasswordForm = /<input[^>]+type\s*=\s*["']?password/i.test(html);
  const hasLoginForm = /<form/i.test(html) && (hasPasswordForm || /name\s*=\s*["']?(username|email|login)/i.test(html));

  // Brand referenced in page but not present on the host
  const brandsOnPage = knownBrands.filter((b) => lower.includes(b));
  const brandMismatch = brandsOnPage.filter((b) => !host.includes(b));
  if (hasLoginForm && brandMismatch.length > 0) {
    score += 0.45;
    signals.push(`login-form-brand-mismatch:${brandMismatch.join(',')}`);
  }

  // Template fingerprints
  const templates: Array<[string, RegExp, number]> = [
    ['fake-shipping-tracker', /track\s*(your)?\s*(parcel|package|shipment)|delivery\s*(update|pending)/i, 0.4],
    ['fake-bank-portal', /(online\s*banking|account\s*verification\s+required|wire\s*transfer\s*confirm)/i, 0.45],
    ['fake-prize-lottery', /(you('ve| have)\s*won|claim\s*your\s*prize|lottery\s*winner|limited\s*time\s*claim)/i, 0.4],
    ['fake-crypto-giveaway', /(double\s*your\s*(btc|eth|crypto)|send\s*(btc|eth).*receive|giveaway\s*event)/i, 0.5],
    ['fake-invoice', /(unpaid\s*invoice|payment\s*due\s*now|receipt\s*enclosed\s*action)/i, 0.35],
  ];
  for (const [name, re, w] of templates) {
    if (re.test(lower)) {
      score += w;
      signals.push(`template:${name}`);
    }
  }

  // Urgency + credential pressure combo
  const urgency = /(immediately|within\s*\d+\s*(hours|minutes)|suspend(ed)?\s*(your)?\s*account)/i.test(lower);
  if (urgency && hasPasswordForm) {
    score += 0.2;
    signals.push('urgency-plus-password-form');
  }

  // External brand logo assets on non-brand host
  const logoHotlink = /<img[^>]+src\s*=\s*["']https?:\/\/[^"']*(logo|brand)[^"']*["']/i.test(html);
  if (logoHotlink && brandMismatch.length > 0) {
    score += 0.15;
    signals.push('external-brand-logo-hotlink');
  }

  const template = templates.find(([, re]) => re.test(lower))?.[0];
  return { score: Math.min(1, score), signals, template };
}
