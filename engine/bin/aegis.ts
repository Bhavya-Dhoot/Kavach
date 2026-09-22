#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { AegisPipeline } from '../src/pipeline.js';
import { embedWatermark } from '../src/npu/synthid.js';
import {
  makeNaturalFrame,
  makeSyntheticLookingFrame,
  decodePpm,
} from '../src/capture/frames.js';

const pipeline = new AegisPipeline({
  logDir: new URL('../.aegis-log/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
});

function printResult(title: string, lines: string[]): void {
  console.log(`\n=== ${title} ===`);
  for (const l of lines) console.log(l);
}

async function runDemo(): Promise<void> {
  console.log('Aegis Shield end-to-end demo (fully offline)\n');

  // 1) Watermarked AI image → Confirmed
  const base = makeSyntheticLookingFrame(128, 128, 42);
  const watermarked = embedWatermark(base, 'imagen');
  const wmResult = pipeline.processFrame(watermarked);
  printResult('1. SynthID watermarked image', [
    `  Q3 escalate: ${wmResult.escalatedToNpu} (trigger ${wmResult.triggerMs.toFixed(1)}ms)`,
    `  Verdict: ${wmResult.verdict.type} · ${wmResult.verdict.label}`,
    `  Generator: ${wmResult.verdict.generator ?? 'n/a'}`,
    `  Confidence: ${(wmResult.verdict.confidence * 100).toFixed(1)}%`,
    `  Overlay: ${wmResult.overlay.kind} — ${wmResult.overlay.title}`,
    `  Total: ${wmResult.totalMs.toFixed(1)}ms (budget 300ms)`,
  ]);

  // 2) Unwatermarked synthetic-looking → Likely (classifier)
  const synth = makeSyntheticLookingFrame(128, 128, 7);
  const synthResult = pipeline.processFrame(synth);
  printResult('2. Unwatermarked synthetic frame', [
    `  Q3 escalate: ${synthResult.escalatedToNpu}`,
    `  Verdict: ${synthResult.verdict.type} · ${synthResult.verdict.label}`,
    `  Confidence: ${(synthResult.verdict.confidence * 100).toFixed(1)}% (probabilistic)`,
    `  Overlay: ${synthResult.overlay.kind} — ${synthResult.overlay.title}`,
    `  Total: ${synthResult.totalMs.toFixed(1)}ms`,
  ]);

  // 3) Natural photo → no detection / no escalate
  const natural = makeNaturalFrame(128, 128, 99);
  const natResult = pipeline.processFrame(natural);
  printResult('3. Natural photo', [
    `  Q3 escalate: ${natResult.escalatedToNpu}`,
    `  Verdict: ${natResult.verdict.type}`,
    `  Total: ${natResult.totalMs.toFixed(1)}ms`,
  ]);

  // 4) Phishing URL from signature cache → Blocked interstitial
  const badUrl = 'https://secure-login-paypal.verify-user.top/login';
  const badResult = pipeline.processUrl(badUrl);
  printResult('4. Known-bad phishing URL', [
    `  Score: ${badResult.verdict.score}`,
    `  Level: ${badResult.verdict.level}`,
    `  Signals: ${badResult.verdict.signals.join(' | ')}`,
    `  Overlay: ${badResult.overlay.kind} — ${badResult.overlay.title}`,
    `  Override delay: ${badResult.overlay.overrideDelayMs}ms`,
    `  Explanation: ${badResult.verdict.explanation}`,
    `  Latency: ${badResult.totalMs.toFixed(1)}ms (budget 100ms)`,
  ]);

  // 5) Typosquat URL → Suspicious/Blocked + page model
  const typoUrl = 'https://paypa1-secure.account-verify.xyz/auth/login';
  const phishingPage = `
    <html><body>
    <h1>PayPal Account Verification</h1>
    <img src="https://cdn.example.com/paypal-logo.png" />
    <form action="/post"><input type="text" name="username" />
    <input type="password" name="password" /></form>
    <p>Your account will be suspended immediately if you do not verify.</p>
    </body></html>`;
  const typoResult = pipeline.processUrl(typoUrl, phishingPage);
  printResult('5. Typosquat URL + phishing page content', [
    `  Score: ${typoResult.verdict.score}`,
    `  Level: ${typoResult.verdict.level}`,
    `  Page model escalated: ${typoResult.escalatedToPageModel}`,
    `  Signals: ${typoResult.verdict.signals.join(' | ')}`,
    `  Overlay: ${typoResult.overlay.kind} — ${typoResult.overlay.title}`,
    `  Latency: ${typoResult.totalMs.toFixed(1)}ms`,
  ]);

  // 6) Benign URL → Safe
  const safeUrl = 'https://example.com/docs';
  const safeResult = pipeline.processUrl(safeUrl);
  printResult('6. Benign URL', [
    `  Score: ${safeResult.verdict.score}`,
    `  Level: ${safeResult.verdict.level}`,
    `  Overlay: ${safeResult.overlay.title || '(none)'}`,
  ]);

  const events = pipeline.log.readAll();
  console.log(`\nEncrypted local log: ${events.length} event(s) (nothing transmitted)\n`);
}

function runCheckUrl(url: string): void {
  const r = pipeline.processUrl(url);
  console.log(JSON.stringify({ url, verdict: r.verdict, overlay: r.overlay, totalMs: r.totalMs }, null, 2));
}

function runCheckImage(path: string): void {
  const buf = new Uint8Array(readFileSync(path));
  const frame = decodePpm(buf);
  const r = pipeline.processFrame(frame);
  console.log(JSON.stringify({ path, verdict: r.verdict, overlay: r.overlay, totalMs: r.totalMs }, null, 2));
}

function startDashboard(port = 8787): void {
  const server = createServer((req, res) => {
    const events = pipeline.log.readAll();
    if (req.url === '/api/events') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ events }, null, 2));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html><head><title>Aegis Shield Dashboard</title>
<style>
  body{font-family:ui-sans-serif,system-ui;background:#0b0f14;color:#e7ecf3;margin:0;padding:2rem}
  h1{font-size:1.4rem;letter-spacing:.04em}
  .badge{display:inline-block;padding:.15rem .5rem;border-radius:.35rem;font-size:.75rem;font-weight:600}
  .confirmed{background:#1d4ed8;color:#fff}.likely{background:#334155;color:#e2e8f0;border:1px solid #64748b}
  .blocked{background:#b91c1c;color:#fff}.suspicious{background:#a16207;color:#fff}.safe{background:#14532d;color:#fff}
  table{width:100%;border-collapse:collapse;margin-top:1rem}
  td,th{padding:.5rem;border-bottom:1px solid #1e293b;text-align:left;font-size:.9rem}
  .privacy{margin-top:2rem;color:#94a3b8;font-size:.85rem}
</style></head>
<body>
  <h1>AEGIS SHIELD — local dashboard</h1>
  <p style="color:#94a3b8">Detection events stored encrypted on-device only. Zero egress.</p>
  <div id="root">Loading…</div>
  <p class="privacy">Privacy guarantee: no content, URL, or screenshot leaves this device (PRD §12).</p>
<script>
fetch('/api/events').then(r=>r.json()).then(({events})=>{
  const root=document.getElementById('root');
  if(!events.length){root.innerHTML='<p>No detection events yet.</p>';return;}
  const rows=events.map(e=>\`<tr>
    <td>\${new Date(e.timestamp).toLocaleTimeString()}</td>
    <td>\${e.channel}</td>
    <td><span class="badge \${e.verdict.replace(/[^a-z]/g,'')}">\${e.verdict}</span></td>
    <td>\${(e.confidence*100).toFixed(1)}%</td>
    <td>\${(e.signals||[]).join(', ')}</td>
  </tr>\`).join('');
  root.innerHTML='<table><tr><th>Time</th><th>Channel</th><th>Verdict</th><th>Score</th><th>Signals</th></tr>'+rows+'</table>';
});
</script>
</body></html>`);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Aegis dashboard: http://127.0.0.1:${port} (local only)`);
  });
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'demo':
    await runDemo();
    break;
  case 'check-url':
    if (!args[0]) { console.error('usage: aegis check-url <url>'); process.exit(2); }
    runCheckUrl(args[0]);
    break;
  case 'check-image':
    if (!args[0]) { console.error('usage: aegis check-image <file.ppm>'); process.exit(2); }
    runCheckImage(args[0]);
    break;
  case 'dashboard':
    startDashboard(args[0] ? Number(args[0]) : 8787);
    break;
  default:
    console.log(`Aegis Shield CLI

Usage:
  aegis demo                     Run end-to-end offline demo
  aegis check-url <url>          Score a URL (phishing engine)
  aegis check-image <file.ppm>   Score a PPM image (AI-content engine)
  aegis dashboard [port]         Local-only dashboard (default 8787)
`);
    process.exit(cmd ? 2 : 0);
}
