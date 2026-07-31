# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based MNREAD-J / MNREAD-Jk reading-chart analysis tool for an ophthalmology clinic. Orthoptists (視能訓練士) enter per-line reading time and error counts during the exam; the app computes reading acuity (RA), maximum reading speed (MRS), and critical print size (CPS), then produces text for the electronic medical record and a printable A4 report for the patient.

Fully client-side and offline-capable. **No patient data leaves the browser, and nothing is persisted** — data leaves only through an explicit file export the user initiates.

## The normative documents

Read these before changing anything that affects a computed value:

- **`oda.lab/`** — the primary sources, as PDFs: the official 2002 Oda manual (`MNREAD-J-JkMan020518.pdf`) and the Oda lab Q&A (`odalab web resource center.pdf`). **These are the final authority on every formula.** Reading them requires poppler (`brew install poppler`); the Read tool renders pages visually, which is necessary because the formulae, tables, and the worked-example scoresheet are laid out graphically.
- **`SPEC.md`** — the single source of truth for the implementation: formulae, item states, validation rules, output schema, rounding policy. Carries `SPEC_VERSION`. Every formula cites its manual/Q&A locator. **If the implementation disagrees with SPEC.md, SPEC.md is right** — change it first, deliberately, then the code. If SPEC.md disagrees with `oda.lab/`, the primary source is right.
- **`docs/adr/`** — 13 decisions with their reasoning (ADR-0009 is superseded by ADR-0011). Consult these before "fixing" something that looks wrong; several apparent oddities are deliberate.
- **`PLAN.md`** — phased implementation and verification plan.
- `deep-research-report-1.md` / `-2.md` — secondary research summaries (Japanese: computation; English: validation). Useful for the automated-CPS literature, which the primary sources don't cover. **Do not resolve a formula question from these** — go to `oda.lab/`. Their `citeturnNNviewN` markers are research-tool artifacts.

Do not restate SPEC.md's formulae in other files. A second copy will drift.

## Commands

```
pnpm install
pnpm typecheck          # all packages
pnpm test               # all packages (Vitest — from Phase 1)
pnpm verify:fixtures    # check the transcribed golden data against reference formulae
```

Run a single package: `pnpm --filter @mnread/core test`.
Run one test file: `pnpm --filter @mnread/core test -- speed.test.ts`.

The web app: `pnpm --filter @mnread/web dev` (serves at `/mnread/`), `… build`, `… test`.

Node 22+, pnpm workspace. `packages/core` is consumed as TypeScript source (no build step needed for tests).

## Layout

```
oda.lab/             一次資料PDF（公式マニュアル・Q&A）
packages/core/       純粋TS。DOM・日付・乱数・ロケール非依存。全関数が純粋関数
  src/types.ts         SPEC.md の契約をコードで表現したもの
  src/variants.ts      チャート定数・換算定数
packages/fixtures/   一次資料から転記したゴールデンデータ
  data/*.json          出所・許容誤差つき
  verify-transcription.mjs   独立の参照式による転記検証
apps/web/            React + 自前SVGチャート。外部CDN依存なし
  src/session/state.ts     打った文字 → SessionInput。状態遷移のみ、算術なし
  src/session/derive.ts    core を呼ぶ唯一の場所。画面の数値はすべてここ経由
  src/format.ts            表示丸め（SPEC §9）。丸めてよいのはここだけ
  src/labels.ts            算出法IDの日本語表示名。対応表のみ、算術なし
  src/components/          ScoreSheet（入力）・SpeedCurve（曲線）・JudgementPanel ほか
  src/output/              電子カルテ文・A4レポート・JSON/CSV 書き出し
```

`verify-transcription.mjs` deliberately does **not** import `@mnread/core` — it re-derives the reference formulae inline. If it imported core, an error in core could validate a matching transcription error. Keep it independent.

## Rules that are easy to violate

These come from the ADRs. Each one was a real defect in the earlier prototype.

- **Never put calculation in the UI layer** (ADR-0010). Every number displayed comes from a `core` return value — including unit conversions, recommended print sizes, and the numeric parts of findings text. "It's just for display" is how the prototype ended up with two untested conversion bugs.
- **Never round inside `core`** (ADR-0003). Full double precision throughout; the UI rounds at render time. Golden tests run at 1e-10 tolerance, which internal rounding makes impossible.
- **Reject invalid input; never clamp or impute** (ADR-0004). `errors > n0`, `t <= 0`, negative distance are errors, not data. `analyze()` returns a discriminated `AnalysisOutcome` rather than throwing, so the UI can show every row's error at once. If any error is present, return no partial result.
- **0 cpm and missing are different** (ADR-0002). 0 cpm is a measured fact and belongs on the curve; missing has no value and cannot be averaged or log-transformed. The item state is a 6-value enum — never reconstruct it from booleans.
- **The main chart is log reading speed, and 0 cpm gets its own band** (ADR-0011, which supersedes ADR-0009). The manual's 図4 and the wider MNREAD literature both plot log speed, and it's the space the fits live in. A log axis cannot carry 0 cpm — that's a reason to break the axis and draw the zeros below it, not a reason to abandon the log scale. The manual's own 図4 drops the 0.5 logMAR zero point that defined that patient's reading acuity; don't repeat it.
- **A CPS value without an algorithm ID is not a result** (ADR-0006). Never emit a bare "CPS = 0.6 logMAR" to screen, EMR text, or export. The clinical primary is always `manual_visual_2002`; automated methods are shown alongside, never as replacements.
- **Never apply the distance correction to cpm.** It applies to RA, CPS, and the curve's x-axis only.
- **Never carry an English MNREAD constant into a Japanese mode** (ADR-0001). Not 10 words, not 40 cm, not the 200 wpm ACC divisor.
- **MRS emits three values, not one** (ADR-0005). The manual's text and its worked example disagree; the code must not silently pick a side. **This applies to the UI too** — showing only `primaryMrs()` picks the side that `core` deliberately refused to pick. On the manual's worked example the methods split 412 / 411 / 411 cpm, and the manual's own stated value is the 411.
- **The judgment UI takes one input: the plateau point set** (ADR-0012). CPS and MRS are both functions of `P` (`CPS = min logMAR`, `MRS = mean speed`). A control that moves the CPS line independently of `P` lets you emit a CPS and an MRS that point at different plateaus, and nothing downstream can see the contradiction. The CPS drag is kept, but mapped onto "which measured size does the plateau start at" — it snaps and rebuilds `P` as a contiguous run. The MRS line gets no handle.
- **The JSON export must round-trip.** It carries `input` *and* `manualPlateau` — CPS and MRS are functions of that selection, so an export without it cannot explain its own numbers, and re-analysis has to start from scratch. `apps/web/test/import.test.tsx` pins export → import → export as byte-identical; if you add a field that determines a result, it belongs in the export.
- **The support margin is not a zone boundary** (ADR-0013). The 3 reading zones split at RA and CPS only. Between CPS and CPS+0.1 the patient really is reading at maximum speed; labelling that band "effortful" makes the handout disagree with the measurement. The margin belongs in the recommended-size range `[pt(CPS), pt(CPS+0.1)]`, in its own box.
- **Never report a value from a model that doesn't fit.** `expdecay_*` returns `estimable: false` when the residual RMSE is too high — the exponential model genuinely cannot fit a sharp two-limb curve, and a CPS derived from a bad fit is noise with a number attached.
- **Over-flagging is the safe direction.** The clinical primary is the ORT's visual judgment, so a spurious review request costs a glance at the graph; a silently wrong CPS reaches the medical record. The synthetic suite enforces zero "silent-wrong" across all 15 curve families — that criterion is more important than any accuracy percentage.

## Open questions

`SPEC.md` §11 tracks unresolved items; code that depends on one carries an `// OPEN-n` comment. OPEN-1 (the M-value offset) was **resolved against the primary sources** — Q&A A7 states `M = 10^(logMAR − 0.4)` outright, and the manual's chart-printed M sizes and its "4M ≈ 28pt" both agree. The remaining items (OPEN-2 … OPEN-5) are minor and none block Phase 1.

## The plateau algorithm was redesigned twice — read SPEC §5.5.2 before touching it

`plateau_sdev_v1` is not a literature algorithm; it is a project-specific ruling (OPEN-3). Two earlier designs were discarded for reasons worth knowing:

1. Requiring every plateau point within 1.96 SD rejects long plateaus structurally (probability ≈ 0.95ⁿ; 66% at 8 points).
2. A fixed "80% of the plateau level" made the SD term inert — mutation testing showed the multiplier could be changed from 0 to 3 with no test failing. That design was the prototype's fixed-ratio rule wearing a different name.

The current design derives the band from the patient's own variability and re-estimates it from the whole plateau. All six mutations of its decisions now fail tests. When changing it, re-run the mutation checks — a passing suite is not evidence that a design decision is load-bearing.

## Verified against the primary sources

Every formula in SPEC.md has been checked numerically against the originals, not just against the research reports:

| Check | Result |
|---|---|
| pt conversion vs Q&A A4.3's 9-digit table (21 rows) | max relative error 2.8×10⁻⁹ |
| Distance correction + M multiplier vs manual 表A (33 rows) | exact after the manual's 2-dp rounding |
| Decimal acuity vs manual 表B, speed vs 表C | exact after rounding |
| Manual §4 worked example (full 19-row session) | RA, CPS, MRS, M value all reproduce the manual's stated values |

`pnpm verify:fixtures` re-runs all of it.

The one caveat worth knowing: the chart's printed M sizes are R10 preferred numbers (1.2589 printed as "1.3"), so they agree with the formula only to ~3.2%. They confirm the magnitude, not the formula. The formula's real evidence is Q&A A7 and the manual's "1.1 logMAR = 5M" (0.24%).

## Phase status

**Phases 0–4 are complete.** 489 tests pass (core 344 + web 145).

`packages/core` is finished for clinical purposes: reading speed, distance correction, item states, reading acuity, unit conversions, validation, the plateau / CPS / MRS layer, the accessibility index, reading zones, and `analyze()`. Test detection power was confirmed by mutation testing — breaking a constant or a sign fails between 7 and 67 tests.

`apps/web` has all three screens: **入力** (19-row score sheet, keypad-only, live cpm and curve), **判定** (plateau selection on the curve, CPS boundary drag, exclusions with reasons, override reason, the manual's log-time secondary plot), **出力** (EMR text, A4 patient report, JSON/CSV export + JSON import for re-analysis).

**Phase 5 is underway** (started 2026-08-01): validation against real records. Nothing in it can be done from the development side alone — the records, the visual CPS, and the verdict on the patient-facing Japanese all live in the clinic. So the phase opens by putting the app where clinicians can use it: `main` is now built and served to <https://yamaguchitoshi.github.io/mnread/> by `.github/workflows/pages.yml` (the `gh-pages` prototype is retired), and `docs/review-request.md` is the request to hand to them. The work itself: 20–30 past cases against hand calculation or MNJA, double-entry by two ORTs, calibration of the thresholds that are currently provisional (OPEN-2, OPEN-4, OPEN-6, OPEN-7), and **clinician review of everything patient-facing** — the zone wording, the A4 report's Japanese, the EMR template. The acceptance bar is that *every* discrepancy is explained, not that a percentage is met.

Deploys are gated: `pages.yml` runs typecheck, `verify:fixtures`, and the full suite before publishing. Serving a broken calculation matters more than serving it quickly.

> Three UI defects in Phase 4 only appeared when the app was driven in a real browser — an SVG hit-test order problem, labels running off the plot, and the A4 report breaking across two pages. jsdom renders but does not lay out or hit-test. **For anything involving SVG geometry or print CSS, drive the real thing.**

When adding to `core`, follow the existing shape: a low-level function throws `RangeError` on a precondition violation (that's a bug — validation should have run first), while `validateSession()` returns `ValidationIssue[]` for anything a user could type.

When adding to `apps/web`, the number must come from `core` and reach the screen through `src/session/derive.ts`; `src/format.ts` is the only place allowed to round. If a display needs a number `core` doesn't return, add it to `core` — do not compute it in a component.
