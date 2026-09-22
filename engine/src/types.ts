export type MediaKind = 'image' | 'video-frame' | 'screenshot';

/** Transient in-memory frame buffer (capture layer output). Never persisted. */
export interface FrameBuffer {
  kind: MediaKind;
  width: number;
  height: number;
  /** RGB, row-major, length = width * height * 3 */
  data: Uint8Array;
}

export type AiVerdictType = 'confirmed-ai' | 'likely-ai' | 'no-detection';

export interface AiVerdict {
  type: AiVerdictType;
  /** 1.0 for watermark-confirmed; classifier score for likely; 1 - score for none */
  confidence: number;
  method: 'synthid' | 'classifier';
  /** Generator family when watermark payload exposes it */
  generator?: string;
  label: string;
}

export type PhishingVerdictLevel = 'safe' | 'suspicious' | 'blocked';

export interface UrlFeatures {
  host: string;
  pathname: string;
  search: string;
  score: number;
  signals: string[];
}

export interface PhishingVerdict {
  level: PhishingVerdictLevel;
  score: number;
  signals: string[];
  /** Pre-tap badge or pre-load interstitial explanation */
  explanation: string;
}

export type OverlayKind =
  | 'badge-confirmed'
  | 'badge-likely'
  | 'badge-link-risk'
  | 'interstitial-blocked';

export interface OverlayAction {
  kind: OverlayKind;
  title: string;
  detail: string;
  canOverride: boolean;
  /** ms the UI must wait before accepting override (panic-tap guard) */
  overrideDelayMs: number;
}

export type Sensitivity = 'strict' | 'balanced' | 'permissive';

export interface Settings {
  sensitivity: Sensitivity;
  /** network calls are forbidden during detection; only used by signature sync job */
  allowOpportunisticSync: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 'balanced',
  allowOpportunisticSync: false,
};

export interface DetectionEvent {
  id: string;
  timestamp: string;
  channel: 'ai-media' | 'phishing';
  source: MediaKind | 'link';
  verdict: string;
  confidence: number;
  signals: string[];
  overlay: OverlayKind;
}

export interface FrameResult {
  verdict: AiVerdict;
  escalatedToNpu: boolean;
  triggerMs: number;
  verdictMs: number;
  totalMs: number;
  overlay: OverlayAction;
  event: DetectionEvent;
}

export interface UrlResult {
  verdict: PhishingVerdict;
  escalatedToPageModel: boolean;
  scoreMs: number;
  totalMs: number;
  overlay: OverlayAction;
  event: DetectionEvent;
}
