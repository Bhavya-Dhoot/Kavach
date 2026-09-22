# Aegis Shield — System Architecture

This document expands [PRD.md §6 (System Architecture)](../PRD.md#6-system-architecture) and [§5 (Hardware Utilization)](../PRD.md#5-hardware-utilization). The PRD remains the canonical spec; this file is the readable deep-dive.

## Design principle: triage, then verdict

The system is a two-tier pipeline. A dedicated always-on co-processor (**Q3**) runs tiny models that answer one question: *"does this frame or URL deserve a closer look?"* Only on a positive trigger does the power-hungry **Hexagon NPU** spin up for the full verdict. This split is what makes always-on protection viable on a phone battery.

```
Capture ──► Q3 triage (always-on, <15mW)
                │
                ├─ negative ──► discard (no escalation)
                │
                ├─ frame looks synthetic ──► NPU verdict pipeline
                │       SynthID decoder → (fallback) generative-artifact classifier
                │
                └─ URL seen ──► Phishing scoring engine
                        signature cache + URL heuristics (+ DOM pass if opened)
                
Both paths ──► Confidence engine ──► Overlay renderer ──► User action
                         │
                         └──► Local encrypted log (device-only, purgeable)
```

## The four layers

### 1. Capture layer

- **Accessibility Service** — observes rendered content across apps (per-app opt-in via Android's screen-reader-adjacent permission model). Read-only inspection; no covert surveillance scope.
- **WebView content-observer hook** — catches page content in default and third-party browsers without requiring the browser's cooperation.
- **MediaProjection** — screenshots and screen-recordings, scanned on capture.
- **No storage of recordings** — only transient in-memory frame buffers, cleared within seconds of a verdict.

### 2. Q3 trigger engine (triage)

Always running, sub-1mW class workload on the dedicated co-processor:

| Model | Size | Role |
|---|---|---|
| Trigger classifier (image/frame) | <10MB INT4 | Binary: escalate this frame to NPU? |
| URL feature scorer | <5MB INT4 | Extracts domain age proxy, TLD risk, homoglyph/typosquat distance, redirect-chain length before a page loads |

The trigger classifier is a compact binary model (under 5M parameters). Most frames and most URLs terminate here — negative results are discarded with no NPU wake-up.

### 3. Verdict pipeline (NPU)

Invoked only on a positive Q3 trigger:

1. **SynthID watermark decoder** (~40–60MB, INT8) — extracts the statistical watermark embedded by SynthID-compliant generators (Gemini, Imagen, Veo, and third-party licensees). A match yields **Confirmed AI-generated** with generator family when exposed.
2. **Fallback generative-artifact classifier** (~25MB, INT8) — runs when no watermark is found; scores compression patterns, frequency-domain anomalies, and temporal inconsistency. Yields **Likely AI-generated (unwatermarked)** with a confidence score, never presented as certain.
3. **Page-content scam-pattern model** (~15MB, INT8) — only on ambiguous URL scores; detects brand-logo-plus-login-form mismatches and known scam templates (fake shipping trackers, bank portals, prize pages).

Models are kept warm in a reserved ~150MB RAM pool (not cold-loaded per call), cutting repeat-invocation latency by an estimated 60–70%.

### 4. Presentation (overlay) + confidence + log

- **Confidence engine** — normalizes watermark verdicts, classifier scores, and phishing scores into user-facing tiers (Confirmed / Likely; Safe / Suspicious / Blocked).
- **Overlay renderer** — system-level UI layer (isolated process) draws badges and interstitials without source-app cooperation. AI flags are non-intrusive badges; only Blocked-tier phishing verdicts get a full interstitial (override requires second tap + 3-second delay).
- **Local encrypted log** — detection events at rest in device keystore-backed storage; user-purgeable; never transmitted.

## Data-flow guarantees

| Property | How it is achieved |
|---|---|
| Zero content egress | Frame buffers are memory-only and time-bounded; URLs are scored locally; no scan APIs are called over the network |
| Offline-first | Signature cache and model weights sync opportunistically over Wi-Fi; detection never blocks on network |
| Integrity of updates | Signature updates are signed and verified on-device before apply (anti-MITM) |
| Permission honesty | Accessibility scope minimized; persistent "Aegis Shield is active" indicator; third-party audit before GA |

## Hardware mapping (summary)

Full table in [PRD.md §5](../PRD.md#5-hardware-utilization):

- **Snapdragon 8 Elite Gen 5** — NPU (verdict models), GPU (frame pre-processing), CPU (orchestration, phishing heuristics, overlay).
- **Q3 co-processor** — always-on trigger models and URL feature extraction.
- **16GB LPDDR5X Ultra** — all models resident simultaneously; ~150MB warm pool for NPU tier.
- **14,000mm² vapor chamber** — sustains NPU boost clocks through 20+ minute sessions without accuracy-degrading thermal fallback.

## Latency budget (image path)

| Stage | Budget |
|---|---|
| Q3 trigger | <15ms |
| NPU verdict (incl. RAM-resident model access) | <250ms |
| Overlay render | <35ms |
| **End-to-end (render → badge), p95** | **<300ms** |

Phishing pre-tap scoring: **<100ms p95**, Q3-only for most URLs (no NPU escalation).

## Related reading

- Feature specs: [PRD.md §7](../PRD.md#7-feature-1--ai-generated-content-detection-synthid), [PRD.md §8](../PRD.md#8-feature-2--phishing-and-scam-website-detection)
- ML model inventory: [PRD.md §9](../PRD.md#9-on-device-ml-pipeline)
- Privacy threat model: [PRD.md §12](../PRD.md#12-privacy-and-security)
- Metrics: [docs/metrics-and-risks.md](metrics-and-risks.md)
