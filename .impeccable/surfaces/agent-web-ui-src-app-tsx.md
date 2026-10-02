---
version: 1
slug: "agent-web-ui-src-app-tsx"
primary_target: "agent/web-ui/src/App.tsx"
related_targets: ["agent/web-ui/src/components/settings.tsx","agent/web-ui/src/components/chat/chat.tsx","agent/web-ui/src/components/workspace/workspace.tsx"]
---

# Codeberg web workspace

Mode: Operate. Scope: refine the existing chat and settings surfaces equally.
Preserve the existing themes, source-search behavior, session lifecycle, and model API.

## Direction contract

THESIS: Make daily investigation and preferences immediately usable, with clear controls and no cramped mobile workspace.

OWN-WORLD: Preserve the existing semantic palettes, system sans typography, Lucide icons, restrained borders, and compact native controls. Use primary color for actions and selection.

STORY: Users see their model context, start or resume a question, review a suggested prompt before sending, and find appearance, usage, and cleanup in settings.

FIRST VIEWPORT: A stable Codeberg header with named desktop actions; a desktop chat list beside a readable conversation; on phones the chat takes the width and the list opens as a native drawer. The composer remains reachable. Settings pairs a navigation rail with focused content, stacking on small screens.

FORM: Scoped refinement of the incumbent interface; no concept seed or replacement visual world. The signature interaction is choosing a first question into the focused composer, with no automatic send. Motion is limited to short control feedback and honors reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

For this ordinary refinement, documentation records existing conventions and the finished UX changes without inventing a new visual identity. Browser fixtures are temporary and explicitly labeled previews.
