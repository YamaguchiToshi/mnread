# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

The spec document (`MNREAD-J_Web_App_Specification.md`, in Japanese) lives at the repo root. A working prototype implementing it lives in `prototype/`: plain HTML/CSS/JS (no build step, no framework) plus Chart.js loaded from a CDN — `prototype/index.html`, `prototype/style.css`, `prototype/app.js`. This is a throwaway/demo-quality implementation of the full spec (input → calculation → chart → EMR text → printable report), not the production stack described in spec section 3 (React/Vue, PWA, etc.) — treat it as a reference for the domain logic, not as the architecture to build on top of.

**Run it**: `cd prototype && python3 -m http.server 8791`, then open `http://localhost:8791`. No install step. There is no test suite; `prototype/app.js`'s pure calculation functions (`computeAll` and helpers) were spot-checked via `node`'s `vm` module against hand-computed expected values during development — there's no persisted automated test file.

**Where the domain logic lives**: all of section 2.2's formulas (cpm, Δ logMAR, RA, MRS/CPS auto-detection) are implemented in `computeAll()` in `prototype/app.js`, near the top of the file, with the constants (`MAX_CHARS`, `ERR_DENOM`, `PLATEAU_RATIO`, `CPS_DROP_RATIO`) defined just above it. The spec does not fully specify MRS/CPS auto-detection or the font-size/magnification recommendation math, so this file makes explicit judgment calls (documented inline as comments) that should be reviewed against real clinical guidance before this becomes more than a prototype:
- MRS = average cpm of rows within `PLATEAU_RATIO` (90%) of the peak measured cpm.
- CPS = the largest-index (smallest print) row still at/above `CPS_DROP_RATIO` (85%) of MRS before the first drop below it.
- Both are manually overridable by dragging directly on the chart canvas (custom hit-testing in `attachDragHandlers`/`hitTest`/`moveDrag` in `app.js` — no external drag library).
- "読了文章数" (sentences completed, used in the RA formula) is counted as: rows above the first entered row (auto full-credit) + rows with a manually entered time. Rows explicitly marked "不読" are excluded from this count. This interpretation of the spec's "入力省略補正" rule is a judgment call, not stated explicitly in the spec.
- The recommended tablet/PC font size (pt) uses an unvalidated heuristic (`1M ≈ 10pt`) since the spec names the feature but gives no formula — flagged as "目安" (approximate) in the UI and in a code comment in `buildRecommendations()`.
- The A4 patient report is produced via browser print (`window.print()` + `@media print` CSS in `style.css`), not `html2pdf.js`/`jspdf` as section 3 suggests — simpler for a prototype, and users can "Save as PDF" from the browser's print dialog.

When real build/lint/test tooling is introduced (per spec section 3's suggested stack), replace this section with the actual commands.

## What this project is

A browser-based tool (SPA/PWA) for ophthalmology / low-vision clinics that analyzes MNREAD-J / MNREAD-Jk reading chart measurements (reading time and error counts per line) and automatically computes reading acuity, critical print size, and maximum reading speed. It generates text for pasting into electronic medical records and a printable A4 PDF report for patients/families.

**Critical constraint: this must be a fully client-side, offline-capable application.** Per the spec's security section, all computation and rendering happens locally in the browser — no patient data (PHI) may be sent to any external server. This constraint should drive architectural decisions (state management, PDF generation, and any future feature must stay client-side; avoid introducing server calls for patient data under any circumstance).

## Domain logic (from the spec — implement these exactly)

The spec (`MNREAD-J_Web_App_Specification.md`, section 2.2) defines the core clinical formulas. These are the algorithmic heart of the app and must be implemented precisely; when writing or reviewing analysis code, verify against these formulas rather than approximating:

- **Reading speed (cpm)**: `MNREAD-J: (30 - errors) / time_sec * 60`; `MNREAD-Jk: (24 - errors) / time_sec * 60` (30 vs 24 is the max character count per line, differs by chart type).
- **Viewing distance correction (Δ logMAR)**: `log10(30 / distance_cm)`, added to size-based logMAR values when the test distance isn't the default 30cm.
- **Reading Acuity (RA)**: `J: 1.4 - (sentences_completed * 0.1) + (total_errors / 300) + Δ logMAR`; `Jk: 1.4 - (sentences_completed * 0.1) + (total_errors / 240) + Δ logMAR`.
- **Maximum Reading Speed (MRS) / Critical Print Size (CPS)**: MRS is the plateau average of reading speed across print sizes; CPS is the smallest print size before speed drops below ~80–85% of MRS. Both must be interactively adjustable by the user via draggable chart sliders (horizontal for MRS, vertical for CPS) to correct for data noise — this manual-override capability is a required feature, not an edge case.
- **Jk → J clinical conversion**: when using the Jk (hiragana) chart, add `+0.1 logMAR` to CPS to estimate the real-world kanji/kana print-size equivalent.
- Untested/skipped rows have defined handling: sizes above where the patient started reading are treated as error-free at standard time (full credit); an unreadable row is scored as 0 cpm.

## Input model

Scoresheet-style entry across 19 fixed print-size steps (1.3 to -0.5 logMAR), with per-row reading time (seconds, 1 decimal) and error count, plus test metadata (chart type, polarity, eye, viewing distance, optional subject ID/age/sex/date). The spec calls for keyboard/numpad-optimized entry (Tab-order, no mouse required) — preserve this when building the input UI.

## Output surfaces

Three distinct outputs consume the same computed results — keep the calculation layer decoupled from presentation so all three stay in sync:
1. A log-scale dual-axis chart (print size vs. time and vs. speed).
2. A one-tap clipboard copy producing a fixed-format plain-text EMR note (see spec section 2.3② for the exact template/wording).
3. A printable A4 patient-facing PDF report with a red/yellow/green readability-zone visualization and magnification/font-size recommendations.

## Suggested stack (from spec section 3, not yet chosen/implemented)

React/Next.js or Vue/Vite; Chart.js+annotation plugin or D3/Plotly for the graph; html2pdf.js or jspdf+html2canvas for PDF export; Service Worker for offline PWA support; target WCAG 2.1 AA accessibility.
