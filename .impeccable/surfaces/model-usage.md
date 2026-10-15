---
version: 1
slug: model-usage
primary_target: agent/web-ui/src/components/model-usage.tsx
related_targets: [agent/web-ui/src/components/usage-chart.tsx, agent/web-ui/src/components/usage-history.tsx, agent/web-ui/src/components/usage-controls.tsx]
---

Mode: Operate. Extend Settings with model usage across all projects, using the supplied Cursor PDF as the content and composition reference.

## Direction contract

THESIS: Let users inspect provider-reported input and output tokens across all projects and the requests behind them.

OWN-WORLD: Inherit Codeberg's semantic palettes, system sans, Lucide icons, native fields, compact navigation and restrained borders.

STORY: Choose a UTC period and All / Chat / Learning activity, read separate input and output counts with activity contributions in All, inspect daily activity and per-model totals, then review or export individual provider calls with project attribution. Cache breakdowns and spend estimates are omitted from the view and CSV.

FIRST VIEWPORT: Usage heading and All projects scope; date range and quick presets; two metrics for input tokens and output tokens; a broad daily chart with an input/output selector. Model breakdown and paginated request history follow.

FORM: A scoped, code-led extension following the user's explicit reference. No concept seed is required. Changing dates or activity updates the entire report and CSV; changing activity resets pagination; hover and keyboard focus disclose exact daily totals.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
