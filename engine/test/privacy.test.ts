import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AegisPipeline } from '../src/pipeline.js';
import { embedWatermark } from '../src/npu/synthid.js';
import { makeSyntheticLookingFrame } from '../src/capture/frames.js';

/**
 * PRD §12 core guarantee: detection performs zero network I/O.
 *
 * Two independent proofs:
 * 1. Static: every file in src/ is scanned for network-capable imports and
 *    primitives (node:http/https/net/dns, fetch, WebSocket, undici, XMLHttpRequest,
 *    process.env-based networking). The detection code must contain none.
 * 2. Runtime: the end-to-end pipeline runs successfully under a child process
 *    where global fetch is removed and net/tls connect are denied, proving
 *    no subsystem depends on the network at detection time.
 */
const FORBIDDEN = [
  "node:http", "'http'", "node:https", "'https'", "node:net", "'net'",
  "node:dns", "'dns'", "'tls'", "node:tls", 'fetch(', 'WebSocket',
  'XMLHttpRequest', 'undici', 'node:child_process', "child_process",
  "httpRequest", 'httpsRequest',
];

function scanSources(): string[] {
  const hits: string[] = [];
  const dir = join(process.cwd(), 'src');
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = String(f);
    if (!p.endsWith('.ts')) continue;
    const full = join(dir, p);
    const content = readFileSync(full, 'utf8');
    for (const token of FORBIDDEN) {
      if (content.includes(token)) hits.push(`${p}: ${token}`);
    }
  }
  return hits;
}

test('privacy static: src/ has zero network-capable imports or primitives', () => {
  const hits = scanSources();
  assert.deepEqual(hits, [], `network surface found: ${hits.join(' | ')}`);
});

test('privacy runtime: pipeline works with network fully unavailable', async () => {
  const { spawn } = await import('node:child_process');
  const code = `
    import { AegisPipeline } from './dist/src/pipeline.js';
    import { embedWatermark } from './dist/src/npu/synthid.js';
    import { makeSyntheticLookingFrame } from './dist/src/capture/frames.js';
    import { mkdtempSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';

    // Deny all network surfaces the engine could conceivably touch
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    const { Socket } = await import('node:net');
    Socket.prototype.connect = () => { throw new Error('network forbidden'); };

    const p = new AegisPipeline({
      logDir: mkdtempSync(join(tmpdir(), 'aegis-privacy-')),
      signatureCachePath: join(process.cwd(), 'fixtures', 'signatures.json'),
    });
    const wm = embedWatermark(makeSyntheticLookingFrame(128, 128, 12), 'imagen');
    p.processFrame(wm);
    p.processUrl('https://secure-login-paypal.verify-user.top/login');
    p.processUrl(
      'https://paypa1-secure.account-verify.xyz/login',
      '<form><input type="password"/></form> You have won!',
    );
    console.log('PRIVACY_RUNTIME_OK');
  `;
  const out = await new Promise<string>((resolve, reject) => {
    spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .on('close', (code2) =>
        code2 === 0 ? resolve('ok') : reject(new Error(`child exited ${code2}`)),
      )
      .stdout.on('data', (d) => {
        const s = d.toString();
        if (s.includes('PRIVACY_RUNTIME_OK')) resolve('ok');
      });
  });
  assert.equal(out, 'ok');
});