# Aegis Shield — Metrics, Performance Targets, and Risks

Canonical sources: [PRD.md §11 (Performance)](../PRD.md#11-performance-requirements), [§13 (KPIs)](../PRD.md#13-success-metrics-and-kpis), [§14 (Risks)](../PRD.md#14-risks-and-mitigations). This file consolidates them for quick reference during development and beta.

## Performance requirements (v1 targets)

All are design targets pending device-level benchmarking; validate on reference hardware before GA and re-validated per major OS/firmware update.

| Metric | Target | Hardware dependency |
|---|---|---|
| Image flag latency (render → badge) | <300ms, p95 | NPU inference speed, RAM residency |
| Phishing pre-tap score latency | <100ms, p95 | Q3 trigger engine only |
| Video frame sampling rate | 1fps sustained during playback | Q3 continuous triage without CPU contention |
| Background power draw (Q3 always-on) | <15mW sustained | Q3 dedicated low-power design |
| NPU inference burst power | <800mW, <300ms duration | Snapdragon 8 Elite Gen 5 NPU efficiency |
| Daily battery impact | <3% additional drain, typical use | Combined Q3 + NPU + thermal budget |
| Sustained inference without throttling | 20+ min continuous video-scroll session | 14,000mm² vapor chamber cooling |
| Model memory footprint (resident) | <150MB combined NPU-tier pool | 16GB LPDDR5X Ultra headroom |
| Cold-start to full protection active | <2s from app/OS boot | RAM residency + Q3 always-on state |

## Detection quality KPIs

| Metric | Target | Notes |
|---|---|---|
| SynthID watermark detection accuracy | >99.5% on watermarked test corpus | Cryptographic-style match, not fuzzy ML |
| Fallback classifier recall | >85% at <5% FPR | Held-out generative-content benchmark |
| Phishing block precision | >95% | False Block on a legitimate site is costly to trust |
| Phishing block recall | >90% | Against known scam-site corpora; re-measure monthly |

## Adoption, engagement, trust KPIs

| Metric | Target / intent |
|---|---|
| Setup completion rate | % who finish onboarding and grant Accessibility permission |
| 30-day retention | Protection still active (not silently disabled) |
| "Report a miss" submission rate | Signal of engaged, trusting users |
| Blocked-tier override rate | <8% — high override signals over-blocking |
| NPS / app-store rating | Specifically citing AI-flagging or scam-blocking feature |

Performance telemetry: opt-in, anonymized, local aggregation before any upload (see [PRD §12](../PRD.md#12-privacy-and-security)).

---

## Risk register

| Risk | Category | Mitigation | PRD ref |
|---|---|---|---|
| Watermark stripping becomes trivial, undermining confirmed-detection tier | Technical/adversarial | Treat fallback classifier as first-class; continual retraining against stripping techniques | [§14](../PRD.md#14-risks-and-mitigations) |
| Non-SynthID generators shrink confirmed coverage | Market/technical | Fallback classifier is model-agnostic; track generator market share | [§14](../PRD.md#14-risks-and-mitigations) |
| Accessibility permission triggers OS/store scrutiny or user distrust | Platform/trust | Transparent disclosure, persistent active-indicator, third-party audit before GA, minimal read scope | [§14](../PRD.md#14-risks-and-mitigations) |
| Phishing false positives on legitimate small/new businesses | Product/trust | Conservative Blocked threshold; default to Suspicious when ambiguous; fast-track allowlist appeals | [§14](../PRD.md#14-risks-and-mitigations) |
| Battery/thermal targets miss on real-world mixed workloads | Technical | Device-level testing under mixed load before GA | [§14](../PRD.md#14-risks-and-mitigations) |
| Scam sites adapt to evade the tool at scale | Adversarial | Signature cadence + heuristic diversity as long-term defense | [§14](../PRD.md#14-risks-and-mitigations) |
| Regulatory pushback on system-wide content scanning | Legal/regulatory | Architecture-level privacy guarantees as primary defense; legal review per market | [§14](../PRD.md#14-risks-and-mitigations) |

## Threat-model highlights (from PRD §12)

| Threat | Mitigation |
|---|---|
| Malicious app harvests overlay/accessibility access | Overlay in isolated process; Accessibility read-only, no input injection beyond block interstitial |
| SynthID stripped via re-encoding | Fallback classifier catches recompression/resize artifacts; documented arms race |
| Signature cache poisoned via MITM | Updates signed and verified on-device before apply |
| False Blocked on legitimate site | Override always available; "Report a miss" feeds local appeals/allowlist |

## How to use this doc during development

1. **Phase 1 gate:** internal dataset must hit every row of *Performance requirements* and *Detection quality* ([roadmap Phase 1](roadmap.md#phase-1--core-detection-mvp)).
2. **Phase 3 gate:** beta cohort must hit adoption/trust KPIs, especially override rate <8% ([roadmap Phase 3](roadmap.md#phase-3--hardening-and-ga)).
3. **Monthly:** re-measure phishing recall against fresh scam-site corpora; retrain fallback classifier against latest stripping techniques.

## Related reading

- Architecture that makes the budgets possible: [docs/architecture.md](architecture.md)
- Full UX and settings that drive adoption KPIs: [PRD §10](../PRD.md#10-user-experience-and-flows)
- Competitive context: [PRD §16](../PRD.md#16-competitive-landscape)
