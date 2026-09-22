import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DetectionEvent } from './types.js';

/**
 * Local encrypted detection log (PRD §6/§12): AES-256-GCM at rest, key from
 * a device-local secret (stand-in for Android Keystore). User-purgeable.
 * Nothing is transmitted.
 */
export class EncryptedLog {
  private readonly key: Buffer;
  private readonly filePath: string;
  private readonly ivLen = 12;

  constructor(storagePath: string) {
    this.filePath = storagePath;
    mkdirSync(dirname(storagePath), { recursive: true });
    const secretPath = `${storagePath}.key`;
    let secret: Buffer;
    if (existsSync(secretPath)) {
      secret = readFileSync(secretPath);
    } else {
      secret = randomBytes(32);
      writeFileSync(secretPath, secret, { mode: 0o600 });
    }
    this.key = scryptSync(secret, 'aegis-shield-log', 32);
  }

  append(event: DetectionEvent): void {
    const records = this.readAll();
    records.push(event);
    this.writeAll(records);
  }

  readAll(): DetectionEvent[] {
    if (!existsSync(this.filePath)) return [];
    const blob = readFileSync(this.filePath, 'utf8');
    if (!blob) return [];
    const [ivHex, tagHex, dataHex] = blob.trim().split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as DetectionEvent[];
  }

  purge(): void {
    writeFileSync(this.filePath, '');
  }

  private writeAll(records: DetectionEvent[]): void {
    const iv = randomBytes(this.ivLen);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plain = Buffer.from(JSON.stringify(records), 'utf8');
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(this.filePath, `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`, {
      mode: 0o600,
    });
  }
}

export function newEventId(): string {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 16);
}
