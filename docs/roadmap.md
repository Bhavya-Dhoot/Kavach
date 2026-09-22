# Aegis Shield — Roadmap

Canonical source: [PRD.md §15 (Roadmap and Milestones)](../PRD.md#15-roadmap-and-milestones). This document is the working view with per-phase deliverables and links into the spec.

## Phase overview

| Phase | Name | Goal |
|---|---|---|
| 0 | Prototype | Prove SynthID decode works end-to-end on-device, offline, static images only |
| 1 | Core detection (MVP) | Fallback classifier + phishing URL scoring + system-wide overlay |
| 2 | Coverage expansion | Video frames, SMS/messaging links, page-content scam model |
| 3 | Hardening and GA | Security audit, real-world battery/thermal validation, appeals polish |
| 4 | v2 candidates (post-GA) | Text detection, cross-device sync (opt-in), enterprise/MDM |

Phases 0–1 are the minimum viable build to prove the **Q3-triage + NPU-verdict** architecture. Phases 2–3 take it from demo to shippable product.

---

## Phase 0 — Prototype

**Scope:** SynthID decoder integration on reference hardware; static-image path only.

Deliverables:

- [ ] SynthID watermark decoder running on Hexagon NPU (INT8), RAM-resident
- [ ] Minimal capture path for static images (JPEG/PNG/WebP)
- [ ] Offline end-to-end demo: image in → verdict out, no network

**Exit criteria:** watermark detection working end-to-end on device, offline ([PRD §15](../PRD.md#15-roadmap-and-milestones)).

Related: [PRD §7 detection pipeline](../PRD.md#7-feature-1--ai-generated-content-detection-synthid), [docs/architecture.md](architecture.md)

---

## Phase 1 — Core detection (MVP)

**Scope:** Add fallback classifier, add phishing URL scoring, system-wide overlay for images + browser links.

Deliverables:

- [ ] Fallback generative-artifact classifier (unwatermarked path, confidence-labelled)
- [ ] Q3 trigger classifier wired as always-on pre-filter (INT4, <10MB)
- [ ] URL feature scorer on Q3 + local signature cache (opportunistic Wi-Fi sync)
- [ ] System-wide overlay badges (Confirmed vs Likely visually distinct)
- [ ] Pre-tap risk badge + pre-load interstitial for browser links
- [ ] Meets [PRD §11 performance targets](../PRD.md#11-performance-requirements) on internal dataset

**Exit criteria:** Section 11 latency/accuracy targets met on internal dataset.

Related: [PRD §8](../PRD.md#8-feature-2--phishing-and-scam-website-detection), [PRD §9 ML pipeline](../PRD.md#9-on-device-ml-pipeline), [docs/metrics-and-risks.md](metrics-and-risks.md)

---

## Phase 2 — Coverage expansion

**Scope:** Video frame sampling, SMS/messaging-app link coverage, page-content scam-pattern model.

Deliverables:

- [ ] Video frames sampled at 1fps during playback; full-frame SynthID video decode where available
- [ ] Screenshot/screen-recording scan on capture
- [ ] Link coverage: SMS/RCS, email previews, WhatsApp/Telegram-class apps, QR scans
- [ ] Page-content scam-pattern model (brand-logo + login-form mismatch, scam templates)
- [ ] Sensitivity settings (Strict/Balanced/Permissive), per-app toggles, local history

**Exit criteria:** coverage surfaces match [PRD §8 spec](../PRD.md#8-feature-2--phishing-and-scam-website-detection).

---

## Phase 3 — Hardening and GA

**Scope:** Third-party security audit, real-world battery/thermal validation, override/appeals flow polish.

Deliverables:

- [ ] Third-party security audit of Accessibility/overlay surface (see [risk register](metrics-and-risks.md#risk-register))
- [ ] Mixed-real-workload battery/thermal validation (not synthetic single-feature benches)
- [ ] Override path (second tap + 3s delay) and "Report a miss" appeals/allowlist flow
- [ ] Signed signature-cache update pipeline verified under MITM test
- [ ] Beta cohort hits all [PRD §13 KPIs](../PRD.md#13-success-metrics-and-kpis)

**Exit criteria:** all Section 13 KPI targets met on beta cohort.

Related: [PRD §12 privacy and security](../PRD.md#12-privacy-and-security), [PRD §14 risks](../PRD.md#14-risks-and-mitigations)

---

## Phase 4 — v2 candidates (post-GA, scoped separately)

- AI-generated text detection (essays, chat messages) — explicitly a [v1 non-goal](../PRD.md#3-goals-and-non-goals)
- Cross-device history sync (opt-in) — v1 is local-only
- Enterprise / MDM fleet management console — v1 is consumer single-device

Prioritization post-GA based on user demand signal.

---

## Suggested tracking

When implementation starts, map each phase's checklist items to issues/milestones in the GitHub repo, keeping exit criteria as milestone completion definitions.
