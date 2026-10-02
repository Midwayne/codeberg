# Documentation evidence

Baseline: `dbed533` (standard themes); finished source: the scoped chat/settings working-tree refinement. This pass loaded the installed Impeccable 4.3.1 documenter definition and `reference/document.md`. No existing DESIGN.md or design sidecar was found.

Sources checked: `agent/web-ui/src/index.css`, `lib/themes.ts`, `App.tsx`, shared `components/ui.tsx`, appearance, settings, model settings, chat/empty/composer, and workspace/sidebar. Tailwind's installed theme supplies the inherited sans/mono stacks, type scale, spacing, breakpoint, transition, and shadow values. `git show HEAD` confirmed the existing palettes, semantic token mapping, native fields/disclosures, borders, and typography. Themes did not change in the refinement.

Recorded changes: named desktop header actions; mobile chat drawer and readable conversation; larger common controls; editable suggested questions; composer keyboard/IME behavior and safe-area padding; settings rail/compact mobile row, Appearance default, and retry/unavailable states; native modal focus behavior and chat-delete confirmation. `docs/settings.md` already documents the settings changes and was preserved.

Finish-review handoff: ship, no material fixes; nine desktop/mobile captures and main source reviewed. Reported verification: `make agent-check` passed typechecks, builds, and 428 tests with one skipped; web UI tests passed 66 tests. Documentation changes do not alter executable source.

Review images under `.impeccable/review/` are ignored local evidence, not shipping raster assets. Desktop captures use 1440×900; mobile captures use 390×844. They came from a temporary, labeled synthetic sessions/models/usage fixture preview, without a live backend. Desktop/mobile PNGs are lossless conversions of the corresponding JPEG captures; `user-390.jpg` is the settled rich-conversation source copied to `mobile-conversation.jpg`. The preview servers and browser tab were closed after review.

Not canonized or repaired: incumbent small uppercase labels in chat search/tool views and training-review kickers, plus the fixed emerald copy-success icon, remain outside the recorded reusable rules. They predate this scoped refinement; the documentation boundary does not authorize UI repairs. No color ramps or creative identity were synthesized to make those exceptions into house style.
