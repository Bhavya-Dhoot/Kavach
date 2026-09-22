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
import { ConfigStore } from './configStore.js';
import { scanMessage, type MessageScanResult } from './surfaces/messageScanner.js';
import { VideoSampler } from './video/videoSampler.js';
import type { AiVerdict } from './types.js';

export interface PipelineOptions {
  settings?: Partial<Settings>;
  /** Override log directory (defaults to engine/.aegis-log) */
  logDir?: string;
  signatureCachePath?: string;
  /** Override config/allowlist file (defaults to <logDir>/config.json) */
  configPath?: string;
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
  readonly config: ConfigStore;
  readonly videoSampler: VideoSampler;
  /** Exposed for tests/diagnostics: the directory holding log + config. */
  readonly dataDir: string;

  constructor(opts: PipelineOptions = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    const logDir = opts.logDir ?? join(process.cwd(), '.aegis-log');
    mkdirSync(logDir, { recursive: true });
    this.dataDir = logDir;
    this.log = new EncryptedLog(join(logDir, 'events.enc'));
    this.signatures = loadSignatureCache(opts.signatureCachePath);
    this.config = new ConfigStore(opts.configPath ?? join(logDir, 'config.json'));
    this.videoSampler = new VideoSampler({ fps: this.settings.videoFps });
  }

  /** PRD §6 capture → Q3 → NPU verdict for a single rendered media frame. */
  processFrame(frame: FrameBuffer, appId?: string): FrameResult {
    if (appId !== undefined && !this.config.appEnabled(appId)) {
      return this.skippedFrame(frame, `app '${appId}' disabled`);
    }
    return this.processFrameInternal(frame);
  }

  /** PRD §9: sample a video frame stream at 1fps; only emitted frames are scored. */
  processVideo(frame: FrameBuffer, now = performance.now()): FrameResult | null {
    const sampled = this.videoSampler.sample(frame, now);
    if (!sampled) return null;
    return this.processFrameInternal(sampled.frame);
  }

  private processFrameInternal(frame: FrameBuffer): FrameResult {
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

  processUrl(url: string, pageHtml?: string, appId?: string): UrlResult {
    const parsed = extractUrlFeatures(url);
    if (appId !== undefined && !this.config.appEnabled(appId)) {
      return this.skippedUrl(url, parsed.host, `app '${appId}' disabled`);
    }
    if (this.config.isAllowed(parsed.host)) {
      // PRD §12: user override adds host to local allowlist — skip scanning.
      const event: DetectionEvent = {
        id: newEventId(),
        timestamp: new Date().toISOString(),
        channel: 'phishing',
        source: 'link',
        verdict: 'safe',
        confidence: 0,
        signals: ['allowlisted'],
        overlay: 'badge-link-risk',
      };
      return {
        verdict: { level: 'safe', score: 0, signals: ['allowlisted'], explanation: 'User-allowed host' },
        escalatedToPageModel: false,
        scoreMs: 0,
        totalMs: 0,
        overlay: overlayForPhishing('safe', 'User-allowed host'),
        event,
      };
    }

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

  /** PRD: override a Blocked verdict → persist to allowlist so host is exempt. */
  overrideBlocked(host: string, reason?: string): void {
    this.config.overrideBlocked(host, reason ?? 'user override');
  }

  /** PRD §10: per-app kill switch flips a cached skip without scoring. */
  setAppEnabled(appId: string, enabled: boolean): void {
    this.config.setAppPolicy(appId, { enabled });
  }

  /**
   * PRD §8: a link surfaced anywhere (SMS / email / messaging app). Extracts
   * every URL from message text and pre-tap scores each.
   */
  processMessage(text: string, appId?: string): MessageScanResult {
    return scanMessage(this, text);
  }

  private skippedFrame(frame: FrameBuffer, reason: string): FrameResult {
    const verdict: AiVerdict = {
      type: 'no-detection',
      confidence: 0,
      method: 'classifier',
      label: reason,
    };
    const event: DetectionEvent = {
      id: newEventId(),
      timestamp: new Date().toISOString(),
      channel: 'ai-media',
      source: frame.kind,
      verdict: 'no-detection',
      confidence: 0,
      signals: [reason],
      overlay: 'badge-confirmed',
    };
    return {
      verdict,
      escalatedToNpu: false,
      triggerMs: 0,
      verdictMs: 0,
      totalMs: 0,
      overlay: overlayForAi(verdict),
      event,
    };
  }

  private skippedUrl(url: string, host: string, reason: string): UrlResult {
    const verdict = {
      level: 'safe' as const,
      score: 0,
      signals: [reason],
      explanation: reason,
    };
    const event: DetectionEvent = {
      id: newEventId(),
      timestamp: new Date().toISOString(),
      channel: 'phishing',
      source: 'link',
      verdict: 'safe',
      confidence: 0,
      signals: [reason],
      overlay: 'badge-link-risk',
    };
    return {
      verdict,
      escalatedToPageModel: false,
      scoreMs: 0,
      totalMs: 0,
      overlay: overlayForPhishing('safe', reason),
      event,
    };
  }
}
