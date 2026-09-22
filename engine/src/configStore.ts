import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface AllowlistEntry {
  host: string;
  reason: string;
  addedAt: string;
}

export interface AppPolicy {
  enabled: boolean;
  sensitivityOverride?: 'strict' | 'balanced' | 'permissive';
}

/**
 * Per-app enable/disable toggles + local allowlist ("Report a miss" / appeals,
 * PRD §10 Settings + §12 threat model). Persisted as a JSON file next to the
 * encrypted log. The allowlist makes override a real mechanism: once a user
 * overrides a Blocked verdict, that host is exempt locally until purged.
 */
export class ConfigStore {
  private readonly filePath: string;
  private allowlist: AllowlistEntry[];
  private appPolicies: Record<string, AppPolicy>;
  /** When an override is recorded, this clears so the host is scanned fresh. */
  private overridePendingNotify = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.allowlist = [];
    this.appPolicies = {};
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as {
        allowlist?: AllowlistEntry[];
        apps?: Record<string, AppPolicy>;
      };
      this.allowlist = raw.allowlist ?? [];
      this.appPolicies = raw.apps ?? {};
    } catch {
      this.allowlist = [];
      this.appPolicies = {};
    }
  }

  private save(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify({ allowlist: this.allowlist, apps: this.appPolicies }, null, 2),
      { mode: 0o600 },
    );
  }

  /** Host is exempt from blocking (user previously overrode, or allowed). */
  isAllowed(host: string): boolean {
    const h = host.toLowerCase();
    return this.allowlist.some((e) => e.host === h || h.endsWith(`.${e.host}`));
  }

  /** Record a deliberate override → add to allowlist (PRD §8 override path). */
  overrideBlocked(host: string, reason = 'user override'): AllowlistEntry {
    const h = host.toLowerCase();
    const entry: AllowlistEntry = { host: h, reason, addedAt: new Date().toISOString() };
    if (!this.allowlist.some((e) => e.host === h)) this.allowlist.push(entry);
    this.overridePendingNotify = true;
    this.save();
    return entry;
  }

  removeAllow(host: string): void {
    const h = host.toLowerCase();
    this.allowlist = this.allowlist.filter((e) => e.host !== h);
    this.save();
  }

  get allowlistEntries(): AllowlistEntry[] {
    return [...this.allowlist];
  }

  appEnabled(appId: string): boolean {
    return this.appPolicies[appId]?.enabled ?? true;
  }

  appSensitivity(appId: string): AppPolicy['sensitivityOverride'] {
    return this.appPolicies[appId]?.sensitivityOverride;
  }

  setAppPolicy(appId: string, policy: AppPolicy): void {
    this.appPolicies[appId] = policy;
    this.save();
  }

  purgeAll(): void {
    this.allowlist = [];
    this.appPolicies = {};
    this.save();
  }

  validation(): void {
    // no-op: reserved for future signature verification
  }
}