# Aegis Shield

**A firewall for reality** — flags what is fake and blocks what is out to scam you, entirely on-device, in real time.

Aegis Shield is an on-device software layer for Android that continuously screens rendered content (images, video frames, web pages) for two threat classes:

1. **AI-generated / manipulated media** — SynthID watermark detection with a local classifier fallback for unwatermarked content.
2. **Phishing and scam websites** — on-device URL heuristics, a local threat-signature cache, and page-content pattern analysis.

All inference runs locally on the Snapdragon 8 Elite Gen 5's Hexagon NPU and the dedicated Q3 always-on co-processor. **Zero content leaves the device.**

## Repository layout

| Path | Purpose |
|---|---|
| [PRD.md](PRD.md) | The full product requirements document (16 sections, end-to-end) |
| [README.md](README.md) | This file — project overview and documentation index |
| [docs/architecture.md](docs/architecture.md) | Capture → Q3 triage → NPU verdict → overlay pipeline, expanded |
| [docs/roadmap.md](docs/roadmap.md) | Phase 0–4 plan with exit criteria |
| [docs/metrics-and-risks.md](docs/metrics-and-risks.md) | KPIs, performance targets, risk register |
| [scripts/verify-docs.ps1](scripts/verify-docs.ps1) | Verification script: PRD structure, doc links, integrity checks |

## Documentation index

Read in this order for full end-to-end context:

1. **[PRD.md](PRD.md)** — canonical specification: problem, goals, personas, hardware mapping, architecture, both features, ML pipeline, UX, performance, privacy, KPIs, risks, roadmap, competitive landscape.
2. **[docs/architecture.md](docs/architecture.md)** — how the four layers fit together and why the Q3-triage / NPU-verdict split matters.
3. **[docs/roadmap.md](docs/roadmap.md)** — what ships when, and the exit criteria per phase.
4. **[docs/metrics-and-risks.md](docs/metrics-and-risks.md)** — how success is measured and what could go wrong.

### PRD sections at a glance

| # | Section | PRD link |
|---|---|---|
| 1 | Executive Summary | [PRD.md §1](PRD.md#1-executive-summary) |
| 2 | Problem Statement | [PRD.md §2](PRD.md#2-problem-statement) |
| 3 | Goals and Non-Goals | [PRD.md §3](PRD.md#3-goals-and-non-goals) |
| 4 | Target Users and Use Cases | [PRD.md §4](PRD.md#4-target-users-and-use-cases) |
| 5 | Hardware Utilization | [PRD.md §5](PRD.md#5-hardware-utilization) |
| 6 | System Architecture | [PRD.md §6](PRD.md#6-system-architecture) |
| 7 | Feature 1 — AI Content Detection | [PRD.md §7](PRD.md#7-feature-1--ai-generated-content-detection-synthid) |
| 8 | Feature 2 — Phishing Detection | [PRD.md §8](PRD.md#8-feature-2--phishing-and-scam-website-detection) |
| 9 | On-Device ML Pipeline | [PRD.md §9](PRD.md#9-on-device-ml-pipeline) |
| 10 | User Experience and Flows | [PRD.md §10](PRD.md#10-user-experience-and-flows) |
| 11 | Performance Requirements | [PRD.md §11](PRD.md#11-performance-requirements) |
| 12 | Privacy and Security | [PRD.md §12](PRD.md#12-privacy-and-security) |
| 13 | Success Metrics and KPIs | [PRD.md §13](PRD.md#13-success-metrics-and-kpis) |
| 14 | Risks and Mitigations | [PRD.md §14](PRD.md#14-risks-and-mitigations) |
| 15 | Roadmap and Milestones | [PRD.md §15](PRD.md#15-roadmap-and-milestones) |
| 16 | Competitive Landscape | [PRD.md §16](PRD.md#16-competitive-landscape) |

## Core design bet

Cloud-based detection is too slow (can't flag content before you've seen it) and too privacy-invasive (every frame/URL leaving the device is itself a leak). Dedicated always-on silicon makes local inference viable:

- **Q3 co-processor** — sub-15mW always-on triage: decides what deserves a closer look (per-frame pre-filter, per-URL feature scoring).
- **Hexagon NPU** — only wakes on a positive trigger: SynthID watermark decode (~40–60MB INT8), fallback generative-artifact classifier (~25MB), page-content scam model (~15MB).
- **Target:** under 300ms render→badge for images, under 100ms pre-tap phishing score, under 3% daily battery impact, full offline operation.

## Verification

Documentation integrity is checked by:

```powershell
pwsh -File scripts/verify-docs.ps1
# or on Windows PowerShell 5.1:
powershell -ExecutionPolicy Bypass -File scripts/verify-docs.ps1
```

The script verifies:

- `PRD.md` contains all 16 numbered sections, in order, each non-trivial.
- The architecture mermaid flowchart and key tables are present.
- `README.md` and every file under `docs/` exist with required content.
- Every relative markdown link in the repo resolves to an existing file (and section anchors resolve to real headings where applicable).

## Privacy guarantee

No rendered content, screenshot, URL, or page-content sample is ever transmitted for scanning. The only network calls are opportunistic, signed pulls of the phishing signature cache and model weights — anonymous, no user or device identifier. See [PRD.md §12](PRD.md#12-privacy-and-security).

## Status

Documentation phase: full PRD + supporting docs complete. Implementation follows the roadmap in [docs/roadmap.md](docs/roadmap.md) (Phase 0 prototype onward) on reference hardware.
