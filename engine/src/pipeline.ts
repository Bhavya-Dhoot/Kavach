import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DetectionEvent,
  FrameBuffer,
  FrameResult,
  Settings,
  UrlResult,
} from './types.js';
import { DEFAULT_SETTINGS } from './types.js';
import { triggerFrame } from './q3/trigger.js';
import { extractUrlFeatures } from './q3/urlFeatures.js';
import { decodeSynthId } from './npu/synthid.js';
import { classifyGenerativeArtifacts, classifierVerdict } from './npu/fallbackClassifier.js';
import { loadSignatureCache, type SignatureCache } from './phishing/signatureCache.js';
import { analyzePageContent } from './phishing/pageAnalyzer.js';
import { scoreUrl, applyPageAnalysis } from './phishing/urlScorer.js';
import { overlayForAi, overlayForPhishing } from './overlay.js';
import { EncryptedLog, newEventId } from './log.js';
import type { AiVerdict } from './types.js';

export interface PipelineOptions {
  settings?: Partial<Settings>;
  /** Override log directory (defaults to engine/.aegis-log) */
  logDir?: string;
  signatureCachePath?: string;
}

/**
 * End-to-end Aegis Shield pipeline (PRD §6):
 * capture → Q3 triage → NPU verdict (or discard) → confidence → overlay → log.
 * Fully offline: no network APIs are referenced in this module.
 */
export class AegisPipeline {
  readonly settings: Settings;
  readonly log: EncryptedLog;
  readonly signatures: SignatureCache;

  constructor(opts: PipelineOptions = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    const logDir = opts.logDir ?? join(process.cwd(), '.aegis-log');
    mkdirSync(logDir, { recursive: true });
    this.log = new EncryptedLog(join(logDir, 'events.enc'));
    this.signatures = loadSignatureCache(opts.signatureCachePath);
  }

  processFrame(frame: FrameBuffer): FrameResult {
    const t0 = performance.now();
    const trigger = triggerFrame(frame);
    let verdict: AiVerdict;
    let verdictMs = 0;

    if (!trigger.escalate) {
      verdict = {
        type: 'no-detection',
        confidence: 1 - trigger.score * 0.3,
        method: 'classifier',
        label: 'Below trigger threshold',
      };
    } else {
      const vStart = performance.now();
      const wm = decodeSynthId(frame);
      if (wm.found) {
        verdict = {
          type: 'confirmed-ai',
          confidence: wm.confidence,
          method: 'synthid',
          generator: wm.generator,
          label: 'Confirmed AI-generated',
        };
      } else {
        const cls = classifyGenerativeArtifacts(frame);
        verdict = classifierVerdict(cls.score);
      }
      verdictMs = performance.now() - vStart;
    }

    const overlay = overlayForAi(verdict);
    const totalMs = performance.now() - t0;
    const event: DetectionEvent = {
      id: newEventId(),
      timestamp: new Date().toISOString(),
      channel: 'ai-media',
      source: frame.kind,
      verdict: verdict.type,
      confidence: verdict.confidence,
      signals: trigger.signals,
      overlay: overlay.kind,
    };
    if (verdict.type !== 'no-detection' || trigger.escalate) {
      this.log.append(event);
    }

    return {
      verdict,
      escalatedToNpu: trigger.escalate,
      triggerMs: trigger.ms,
      verdictMs,
      totalMs,
      overlay: overlay.kind === 'badge-likely' && verdict.type === 'no-detection'
        ? { ...overlay, title: '', detail: '' }
        : overlay,
      event,
    };
  }

  processUrl(url: string, pageHtml?: string): UrlResult {
    const t0 = performance.now();
    const trig = extractUrlFeatures(url);
    let verdict = scoreUrl(
      { url, q3Score: trig.score, q3Signals: trig.signals },
      this.signatures,
      this.settings.sensitivity,
    );
    let escalated = false;

    if (pageHtml && verdict.level !== 'blocked') {
      // PRD §8 step 3: page pass only when score is ambiguous
      if (verdict.level === 'suspicious' || (verdict.score > 0.25 && verdict.score < 0.7)) {
        escalated = true;
        const page = analyzePageContent(pageHtml, trig.features.host);
        verdict = applyPageAnalysis(verdict, page, this.settings.sensitivity);
      }
    }

    const scoreMs = performance.now() - t0;
    const overlay = overlayForPhishing(verdict.level, verdict.explanation);
    const event: DetectionEvent = {
      id: newEventId(),
      timestamp: new Date().toISOString(),
      channel: 'phishing',
      source: 'link',
      verdict: verdict.level,
      confidence: verdict.score,
      signals: verdict.signals,
      overlay: overlay.kind,
    };
    if (verdict.level !== 'safe') {
      this.log.append(event);
    }

    return {
      verdict,
      escalatedToPageModel: escalated,
      scoreMs,
      totalMs: performance.now() - t0,
      overlay,
      event,
    };
  }
}
