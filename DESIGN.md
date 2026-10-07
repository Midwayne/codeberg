---
name: Codeberg web workspace
description: Existing semantic themes and compact controls for chat and settings.
colors:
  background: "oklch(0.145 0 0)"
  foreground: "oklch(0.985 0 0)"
  card: "oklch(0.205 0 0)"
  card-foreground: "oklch(0.985 0 0)"
  popover: "oklch(0.205 0 0)"
  popover-foreground: "oklch(0.985 0 0)"
  primary: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.205 0 0)"
  secondary: "oklch(0.269 0 0)"
  secondary-foreground: "oklch(0.985 0 0)"
  muted: "oklch(0.269 0 0)"
  muted-foreground: "oklch(0.708 0 0)"
  accent: "oklch(0.269 0 0)"
  accent-foreground: "oklch(0.985 0 0)"
  destructive: "oklch(0.704 0.191 22.216)"
  destructive-foreground: "#000000"
  border: "oklch(1 0 0 / 10%)"
  input: "oklch(1 0 0 / 15%)"
  ring: "oklch(0.556 0 0)"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
    fontSize: "0.75rem"
    lineHeight: "1rem"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "0.75rem"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
spacing:
  unit: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  6: "1.5rem"
  8: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "0.5rem 0.75rem"
  button-secondary:
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "0.5rem 0.75rem"
  button-icon:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.lg}"
    size: "2.75rem"
  input-select:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.75rem 0.5rem 0.5rem"
  navigation-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
  card-metric:
    rounded: "{rounded.xl}"
    padding: "1rem"
  chip-attachment:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.md}"
    typography: "{typography.label}"
---

# Design System: Codeberg web workspace

## Overview

This document records the existing web UI after a scoped refinement of chat and settings. Semantic palettes, system sans text, Lucide icons, borders, and native controls remain the visual authority. It describes implemented conventions; no replacement identity or display typeface was introduced.

**Key Characteristics:**
- Semantic themes across chat and settings.
- Readable compact text with larger touch controls.
- Flat bordered surfaces; native disclosures, inputs, and dialogs.

Scope: `agent/web-ui/`. The frontmatter records the default **Dark** theme. `src/lib/themes.ts` is authoritative for Light, Kanagawa, Tokyo Night, Catppuccin Mocha, Dracula, Nord, and Gruvbox; `src/index.css` provides the pre-JavaScript fallback. All themes use the same semantic roles. See [settings documentation](docs/settings.md) for selection and persistence.

## Colors

### Primary

Primary and primary-foreground form the action pair for New chat, Send/Stop, and model Save. Accent provides hover and selected navigation backgrounds; these are separate semantic roles even when a neutral palette shares values.

### Neutral

Background is the workspace canvas. Card and popover provide supporting surfaces; foreground and muted-foreground separate reading from metadata. Border and input define divisions and fields; ring marks keyboard focus. Destructive and its foreground identify irreversible actions and failures.

**The Semantic Roles Rule.** Use semantic roles for surfaces, text, actions, selection, and danger; palette values belong in the shared theme source.

## Typography

System sans is used for interface headings, body copy, labels, and controls. The monospace stack appears in code and command examples. These are UI headings rather than a separate display system.

The recorded headline is the Settings heading and mobile empty-chat heading. Empty-chat headings increase to (1.875rem) with line height (2.25rem) at the small breakpoint. Section and dialog titles use the title role. Body copy uses the body role, with longer explanatory copy commonly using line height (1.5rem). Labels and metadata use the label role. Mobile composer and model select text use (1rem), becoming body-sized at the small breakpoint. Measurements and counts use tabular numbers.

## Layout

A full dynamic-viewport flex shell keeps a stable header and separates scrolling conversation content from the bottom composer. Conversation and composer share a centered maximum width (48rem); the empty state narrows to (36rem). The desktop chat list is (18rem) wide. Below the medium breakpoint it becomes a native modal drawer, at most (20rem) wide with a (3rem) viewport margin. Selecting or starting a chat closes that drawer.

Settings uses a centered maximum width (72rem), with page padding (1rem), increasing to (2rem) at the small breakpoint. At the medium breakpoint its (12rem) navigation rail sits beside flexible content; below it, eight section buttons use two columns on phones and three from the small breakpoint. Theme previews use one column, two from (360px), and three at the extra-large breakpoint. The shared spacing rhythm is a quarter rem, with half steps where needed. Composer bottom padding respects the safe-area inset.

## Elevation & Depth

Most surfaces use tonal layering and thin semantic borders. Floating menus and dialogs use the existing large soft shadow; the mobile chat drawer explicitly has no shadow. Native dialog backdrops dim the workspace. Focus uses a two-pixel ring outline with a three-pixel offset; the composer instead changes its container border on focus. Short color/opacity feedback stays local to controls. Message navigation briefly highlights its target, with animation removed under reduced motion; the busy spinner also honors reduced motion. Exact shadow, motion, and breakpoint values are in `.impeccable/design.json`.

## Shapes

Gently curved controls use the medium and large radius steps. Cards, composer, and dialogs use the extra-large step; the mobile drawer meets the viewport with square corners. Borders define structure without ornamental framing. Lucide line icons typically use (1rem), with smaller utility icons (0.875rem).

## Components

- **Buttons:** primary fill for main actions, bordered secondary controls, and quiet icon actions with accent hover. Shared icon buttons are (2.75rem) square on phones and (2.25rem) at the small breakpoint. Main composer actions remain (2.75rem). Disabled opacity communicates availability.
- **Inputs / Fields:** shared native selects show medium-weight text and a small down chevron (0.875rem), with a transparent background and no border. They size to their selected content, truncate within the available width, and keep a minimum height (2.75rem). Hover and keyboard focus use accent-foreground text; the shared focus outline remains visible. Disabled selects and chevrons use half opacity, and option surfaces use popover and popover-foreground. The composer is a bordered card with an auto-growing textarea capped at (200px), attachment chips, and Send/Stop. Enter sends, Shift+Enter adds a line; IME composition is respected. Slash suggestions insert a command before submission.
- **Chips:** attachments sit in muted rounded capsules with truncated names and separately named remove actions.
- **Source citations:** numbered chips stay inline with the prose they support, including when a response puts references on separate lines. Hover or keyboard focus reveals the source; clicking copies it. Code blocks and table boundaries retain their formatting.
- **Cards / Containers:** resource metrics and cleanup options use thin borders, extra-large corners, and one-rem padding. Theme previews show palette colors; native radio selection adds a ring and check mark, with keyboard focus visible.
- **Navigation:** named desktop header actions become accessible icon actions on smaller screens. Selected settings and chat rows use accent backgrounds. Chat rows show two-line titles, metadata, and separate actions; native dialogs handle mobile chat navigation, models, and chat-delete confirmation.
- **Projects:** Settings lists project names as headings, marks the current project, and opens a focused inline form through Rename. Save name is the primary action; Cancel or Escape closes the form and restores focus. Compact definition rows align directory names and paths, stable IDs, and config directories on desktop, then stack their labels on phones. Copy buttons sit beside paths and IDs; a native Config files disclosure explains their contents. The shared catalog path follows the project list. Catalog and config paths come from the server's configured home. Saving updates the selector while retaining the selected ID and workspace state.
- **Empty chat:** the heading leads straight into suggested questions with a two-rem gap, followed by the existing command tip. Selecting a question still fills and focuses an editable draft.
- **Knowledge consolidation:** Learning settings includes manual report generation and an optional daily proposal switch. Recent reports open inline, with native disclosures for before/after notes, preserved sources, and archive/link metadata. Apply, Dismiss and Undo are named actions. Paused, empty, loading, failed, and confirmed-decision states remain visible. Diffs stack on phones and use two columns on wide screens.
- **Canvas:** an optional project setting gives each chat one automatic local Excalidraw canvas. The first drawing renders as an inline tool artifact with a Canvas label and an expand icon; its preview stays mounted at that response as subsequent mutations update the drawing. Drawing tools show a brief Agent is editing status in the card. Its preview hides editor controls. Expanding opens the same scene in a full-window editor with save status, conflict recovery and Excalidraw's standard file/image export menu. The scene enters over 220 ms with opacity and a 6 px settle; remote content changes crossfade rendered pixels over 180 ms and show Canvas updated feedback. Manual edits and save echoes stay immediate. Reduced motion uses an opacity-only entrance and static update feedback; keyboard expansion skips the entrance. There are no canvas names, selection or creation controls. Branches copy the parent’s current drawing independently.
- **Feedback:** loading uses status text; resource/model failures provide a retry action. Project names have disabled, saving, success, and error states. Cleanup selection stays disabled without a valid preview. Chat deletion names the conversation and focuses Cancel initially. Suggested first questions fill and focus the composer without sending.
- **Occasional UI motion:** centered project/chat dialogs enter with a 0.95-to-1 scale and opacity over 220 ms; model settings uses a top-right origin over 180 ms. Their exits take 150 ms. The mobile chat drawer travels from the left over 220 ms and returns over 180 ms. These use the canvas exponential curve, with a 150 ms backdrop fade. Native modality and focus release immediately on close; retained dialog content is inert during its visual exit. Cleanup confirmation reserves its natural space and settles by 4 px over 180 ms, reversing over 150 ms. Skill import and extension success messages fade over 150 ms in reserved wrapping space. Reduced motion uses 100 ms opacity-only feedback; keyboard-triggered changes stay immediate. Search, streaming answers, charts, settings/review navigation, and existing canvas interactions keep their established behavior.

## Do's and Don'ts

### Do:
- **Do** use semantic CSS tokens so every installed theme updates the same controls.
- **Do** retain accessible names for icon actions and visible focus feedback.
- **Do** let suggestions populate an editable, focused draft before sending.
- **Do** keep mobile conversation space and the composer reachable.

### Don't:
- **Don't** replace the installed palette or typography when extending these surfaces.
- **Don't** remove native control behavior or disabled/loading feedback.

Loading surfaces use static semantic-color placeholders, an activity indicator, and short opacity crossfades. Forms reserve their body height; workspace and lazy screens fill the existing viewport. Refreshes retain existing usage data. Reduced motion removes rotation and shortens fades; keyboard interactions remain immediate.
