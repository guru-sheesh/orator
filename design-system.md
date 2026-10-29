# Orator Design System

Generated with UI/UX Pro Max (style: *Minimalism & Swiss*, dials variance 3 / motion 2 / density 5), then adapted to the product rules in `CLAUDE.md` §18: serious, calm, professional, dark mode first. No badges, coins, mascots, streak flames or celebration animations. Motivation comes from visible improvement and consistency.

Tokens live in [`src/styles/tokens.css`](src/styles/tokens.css) (Tailwind v4 `@theme`). Components use semantic tokens only (`bg-surface`, `text-muted`, `text-primary`…), never raw hex.

What I took from the tool and what I changed:
- **Kept:** Minimalism/Swiss style, Inter for UI, the warm "journal brown" primary (used for light mode), subtle motion, no excessive decoration.
- **Changed:** the tool's palette was light-only, so the dark palette is new and checked for contrast below. The tool's "scroll storytelling" page pattern is for marketing sites and does not apply to an app. The serif (Lora) came from the tool's typography search ("Wellness Calm" pairing), used only for transcripts and passages.

---

## 1. Colour

Dark is the default. Light is opt-in via `<html data-theme="light">`.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#121315` | `#F7F5F1` | App background |
| `surface` | `#1A1B1E` | `#FFFFFF` | Cards, sheets |
| `raised` | `#222327` | `#EFECE6` | Inputs, nested rows, pressed states |
| `border` | `#34363B` | `#D9D4CB` | Decorative dividers |
| `border-strong` | `#6E7178` | `#8C867C` | Input / control outlines (≥3:1) |
| `text` | `#ECEAE5` | `#1C1B19` | Primary text |
| `muted` | `#A8A49D` | `#57534D` | Secondary text |
| `subtle` | `#938F88` | `#6B665F` | Meta, captions |
| `primary` | `#E2A65A` | `#8A3D0C` | Primary actions, progress, focus ring |
| `on-primary` | `#1A1206` | `#FFFFFF` | Text on primary |
| `success` | `#86BC93` | `#2E6A3E` | "Complete" states only |
| `danger` | `#EE8274` | `#B3261E` | Recording state, destructive actions, issues |
| `info` | `#8FB8DE` | `#1E5A8C` | Pauses, neutral analysis markers |

Each status colour also has a `*-soft` tint (14% dark / 8–10% light) for backgrounds of chips and highlighted words.

### Contrast (WCAG AA, checked with a script)

| Pair | Dark | Light |
|---|---|---|
| text on bg / surface / raised | 15.5 / 14.3 / 13.1 | 15.8 / 17.2 / 14.6 |
| muted on bg / raised | 7.5 / 6.3 | 7.0 / 6.5 |
| subtle on bg / raised | 5.8 / 4.9 | 5.2 / 4.8 |
| primary on bg | 8.7 | 7.0 |
| on-primary on primary | 8.7 | 7.6 |
| success / danger / info on surface | 7.9 / 6.6 / 8.3 | 6.5 / 6.5 / 7.3 |
| border-strong on surface (non-text, needs 3:1) | 3.5 | 3.6 |

All text pairs pass AA (4.5:1); all control outlines pass 3:1. Colour is never the only signal: states always carry a word ("Complete", "Recording") or an icon.

## 2. Typography

| Role | Font | Size / line-height | Weight |
|---|---|---|---|
| Display (timers, key numbers) | Inter, tabular numerals | 40 / 1.1 | 600 |
| Headline (screen title) | Inter | 26 / 1.25 | 600 |
| Title (card title) | Inter | 20 / 1.35 | 600 |
| Body | Inter | 16 / 1.55 | 400 |
| Label / caption | Inter | 13 / 1.4 | 500, uppercase tracking 0.06em for section labels |
| Transcript / passage / quote | Lora | 18 / 1.7 | 400 (italic only for verified source excerpts) |

Google Fonts: `Inter:wght@400;500;600` and `Lora:ital,wght@0,400;0,500;1,400`, `display=swap`. Never below 13px. Numbers use `font-variant-numeric: tabular-nums` so timers and counts don't jitter.

## 3. Spacing, radii, elevation

- **Spacing:** 4px base. Allowed steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Screen gutter 20px. Gap between cards 12px. Card padding 16–20px.
- **Radii:** `sm` 8 (chips, inputs), `md` 12 (buttons), `lg` 16 (cards, sheets), `pill` (segmented controls, progress bars).
- **Elevation:** dark mode uses surface steps (`bg → surface → raised`), not shadows. Only bottom sheets get `shadow-sheet`. Light mode cards use a 1px `border`.
- **Motion:** 150ms (press) and 220ms (panels) with `ease-standard`. No bounce, no confetti, no count-up animations. Everything goes instant under `prefers-reduced-motion`.

## 4. Layout

- Target frame 390×844. Content is one column with a 20px gutter; max width 480px when opened on a larger screen.
- Respect safe areas: `padding-bottom: env(safe-area-inset-bottom)` on the bottom nav and the record bar.
- Primary actions sit in the bottom third (thumb zone). Destructive actions are never the primary button.

## 5. Components

### Buttons
- **Primary:** `bg-primary text-on-primary`, height 52, radius `md`, 16px semibold. One per screen.
- **Secondary:** `bg-raised text-text`, 1px `border`, height 48.
- **Ghost:** text only in `primary`, min 44×44 hit area.
- **Destructive:** `text-danger` ghost, or `bg-danger text-on-danger` only inside a confirmation dialog.
- Pressed state: 4% darken plus scale 0.98 for 150ms. Disabled: 40% opacity plus `aria-disabled`.

### Card
`bg-surface`, radius `lg`, padding 16–20. Optional header row: label (caption, uppercase, `subtle`) and an action on the right.

### Progress ring / bar
- **Ring:** 4px stroke, track `raised`, fill `primary`; turns `success` with a check icon only when the target is met. The value is always printed in text beside or inside it.
- **Bar:** 6px, `pill` radius, same colour rules.
- `role="progressbar"` with `aria-valuenow` / `aria-valuemax`.

### Record button
- 80px circle (spec minimum 72), centred in the bottom thumb zone.
- **Idle:** `bg-danger` with a mic icon (`on-danger`), label "Record" below.
- **Recording:** the icon becomes a square stop; an elapsed timer (display size) shows above; a calm 2s opacity pulse on the outer ring (off with reduced motion). The label reads "Recording · tap to stop".
- `aria-pressed` reflects the state.

### Waveform player
- Bars rendered on canvas, 2px wide with 2px gaps. Played portion `primary`, unplayed `border-strong`. Playhead 2px `text`.
- Controls: 44px play/pause, −5s / +5s, speed (0.75× / 1×). The current time and duration use tabular numerals.

### Transcript view (word highlighting)
- Lora 18/1.7 in a `surface` card.
- **Current word:** `bg-primary-soft` plus `text`, 4px radius.
- **Filler:** dotted underline in `danger` plus a tooltip-free inline label on tap.
- **Pause marker:** a small `info` pill showing seconds (`‖ 1.4s`), inserted between words.
- **Unclear word:** dashed `info` underline, with the label "may be hard to understand". Never "wrong" (accent rule).

### Feedback cards
Section order follows CLAUDE.md §10. Each card has a caption label and a body. Source cards are visually distinct:
- **Authentic source:** left 3px `primary` rule, serif italic excerpt, metadata row (speaker · title · date · rights).
- **Application (generated):** a `raised` background labelled "Application: written for your answer, not a quotation".
- **No source:** an `info-soft` banner with the text "No verified source in the library for this; this is general guidance."

### Attempt comparison table
Two numeric columns (Attempt 1, Attempt 2) plus a change column. The change shows a direction icon and a word ("3 fewer") in `success` or `muted`, never colour alone. No total score row.

### Bottom navigation
Four tabs: Today, Speak, Journal, Read. Height 64 plus safe area, Lucide icons 24px plus 12px labels. The active tab shows its icon and label in `primary` with a 2px top indicator. Each target is ≥ 48×48.

### Inputs
Height 48, `bg-raised`, 1px `border-strong`, radius `sm`. The label is always visible above the field (never placeholder-only). Errors show below the field in `danger`, with an icon.

## 6. Icons
Lucide only, 24px (nav) and 20px (inline), stroke 1.75. No emoji. Icon-only buttons always carry an `aria-label`.

## 7. Voice
Plain, specific, adult. "You used 'basically' four times" rather than "Oops!". No exclamation marks in system copy. AI-generated material is always labelled "AI-generated practice material".
