---
version: 1
slug: model-usage
primary_target: agent/web-ui/src/components/model-usage.tsx
related_targets: [agent/web-ui/src/components/usage-chart.tsx, agent/web-ui/src/components/usage-history.tsx, agent/web-ui/src/components/usage-controls.tsx]
---

Mode: Operate. Extend Settings with model usage across all projects, using the supplied Cursor PDF as the content and composition reference.

## Direction contract

THESIS: Let users understand recorded model spend across all projects and inspect the requests behind it.

OWN-WORLD: Inherit Codeberg's semantic palettes, system sans, Lucide icons, native fields, compact navigation and restrained borders.

STORY: Choose a UTC period, read estimated USD spend and reported tokens, inspect daily activity and per-model totals, then review or export individual provider calls with project attribution.

FIRST VIEWPORT: Usage heading and All projects scope; date range and quick presets; three reference-inspired metrics for estimated spend, total tokens and model requests; a broad daily chart with tokens/spend control. Model breakdown and paginated request history follow.

FORM: A scoped, code-led extension following the user's explicit reference. No concept seed is required. Changing dates updates the entire report; hover and keyboard focus disclose exact daily totals.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
