/**
 * 解析全体の組み立て（SPEC §8）
 *
 * 例外を投げず判別可能な返り値を用いる（ADR-0004）。error が1件でもあれば
 * 部分的な結果を返さず、検証結果のみを返す。
 */

import { computeAccessibility } from "./accessibility.js";
import { computeReadingAcuity } from "./acuity.js";
import { supportRange, unitConversion } from "./convert.js";
import { buildCurve, type CurvePoint } from "./curve.js";
import { distanceCorrectionLogMAR } from "./distance.js";
import { resolveItems } from "./items.js";
import { computeMrs } from "./mrs.js";
import { estimateExpDecay } from "./plateau/expdecay.js";
import { estimateManual } from "./plateau/manual.js";
import { estimateSdev } from "./plateau/sdev.js";
import { computeQualityFlags } from "./quality.js";
import type {
  AnalysisOptions,
  AnalysisOutcome,
  AnalysisResult,
  CpsEstimate,
  CpsMethodId,
  SelectionRecord,
  SessionInput,
} from "./types.js";
import { ALGORITHM_VERSION, SPEC_VERSION } from "./types.js";
import { hasBlockingError, validateSession } from "./validation.js";
import { DEFAULT_ANALYSIS_OPTIONS, VARIANT_SPECS } from "./variants.js";
import { readingZones } from "./zones.js";

/**
 * 主値として選ぶ順序（SPEC §5.5.1）。
 *
 * ADR-0006 により臨床の主値は常に目視判定である。検者がまだ判定していない
 * 場合に限り、SDev 法を暫定的に選ぶ。この場合 `selection.cpsMethod` が
 * `manual_visual_2002` 以外になるので、UI と出力はそれを明示すること
 * （「CPS = ○○」だけを出さないという規則がここでも効く）。
 *
 * **指数フィットはここに入れない（ADR-0015）。** SDev 法が推定不能になる主因は
 * 欠測段であり（`estimateSdev` は欠測段をまたがない）、欠測を無視して曲線全体に
 * フィットする手法でその穴を埋めるのは、SDev 法が拒んだ推定を別の算出法IDで
 * 行うことに等しい。合成 `sparse` 族ではこの昇格が起きた17本すべてで指数
 * フィットの CPS が真値から +0.54〜+0.69 logMAR 外れた。参考値としての併記は
 * 続ける（`enabledCpsMethods` の既定に `expdecay_90` は入っている）。
 */
const SELECTION_PRIORITY: readonly CpsMethodId[] = [
  "manual_visual_2002",
  "plateau_sdev_v1",
];

export function analyze(
  input: SessionInput,
  overrides: Partial<AnalysisOptions> = {},
): AnalysisOutcome {
  const options: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS, ...overrides };
  const spec = VARIANT_SPECS[input.variant];

  const issues = validateSession(input, spec);
  if (hasBlockingError(issues)) {
    return { ok: false, issues };
  }

  const items = resolveItems(input, spec);
  const readingAcuity = computeReadingAcuity(items, spec);
  const curve = buildCurve(items);

  const enabled = new Set(options.enabledCpsMethods);
  const estimates: CpsEstimate[] = [];
  const plateaus = new Map<CpsMethodId, readonly CurvePoint[]>();

  if (enabled.has("manual_visual_2002")) {
    const r = estimateManual(curve, options.manualPlateau);
    estimates.push(r.estimate);
    plateaus.set("manual_visual_2002", r.plateau);
  }
  if (enabled.has("plateau_sdev_v1")) {
    const r = estimateSdev(curve);
    estimates.push(r.estimate);
    plateaus.set("plateau_sdev_v1", r.plateau);
  }
  if (
    enabled.has("expdecay_80") ||
    enabled.has("expdecay_90") ||
    enabled.has("expdecay_95")
  ) {
    const r = estimateExpDecay(curve);
    for (const e of r.estimates) {
      if (!enabled.has(e.method)) continue;
      estimates.push(e);
      plateaus.set(e.method, r.plateaus.get(e.method) ?? []);
    }
  }

  const selected = pickSelected(estimates);
  const selectedPlateau =
    selected === null ? [] : (plateaus.get(selected.method) ?? []);

  const mrs = computeMrs(selectedPlateau, spec);

  const accessibility = computeAccessibility(
    items,
    spec.standardDistanceCm,
    input.viewingDistanceCm,
  );

  const cpsLogMAR = selected?.estimable === true ? selected.cpsCorrectedLogMAR : null;
  const cpsConversion =
    cpsLogMAR === null ? null : unitConversion(cpsLogMAR, input.viewingDistanceCm);
  const raConversion =
    readingAcuity === null
      ? null
      : unitConversion(readingAcuity.raCorrectedLogMAR, input.viewingDistanceCm);
  const support =
    cpsLogMAR === null
      ? null
      : supportRange(
          cpsLogMAR,
          options.supportMarginLogMAR,
          input.viewingDistanceCm,
          spec.standardDistanceCm,
        );

  const zones = readingZones(
    readingAcuity,
    selected,
    input.viewingDistanceCm,
    spec.standardDistanceCm,
  );
  const selection = buildSelectionRecord(estimates, selected, options);

  const qualityFlags = computeQualityFlags({
    curve,
    estimates,
    selected,
    mrs,
    readingAcuity,
    zones,
    selection,
    hasLargeUnreadable: items.some((i) => i.status === "skipped_large_unreadable"),
    hasImplausibleValue: issues.some((i) => i.code === "WARN_IMPLAUSIBLE_SPEED"),
    options,
  });

  const result: AnalysisResult = {
    specVersion: SPEC_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    variantSpec: spec,
    input,
    manualPlateau: options.manualPlateau,
    items,
    readingAcuity,
    mrs,
    cps: estimates,
    selection,
    accessibility,
    distanceCorrectionLogMAR: distanceCorrectionLogMAR(
      input.viewingDistanceCm,
      spec.standardDistanceCm,
    ),
    cpsConversion,
    raConversion,
    supportRange: support,
    zones,
    qualityFlags,
    requiresReview: qualityFlags.length > 0,
    warnings: issues.filter((i) => i.severity === "warning"),
  };

  return { ok: true, result };
}

function pickSelected(estimates: readonly CpsEstimate[]): CpsEstimate | null {
  for (const method of SELECTION_PRIORITY) {
    const found = estimates.find((e) => e.method === method && e.estimable);
    if (found !== undefined) return found;
  }
  return estimates[0] ?? null;
}

/**
 * 判定の由来を記録する（SPEC §8.4）。
 *
 * 「上書き」とは、検者の目視判定が自動値（`plateau_sdev_v1`）と**異なるプラトーを
 * 指している**ことを言う。CPS の値が一致していてもプラトーの構成が違えば MRS が
 * 変わるため、比較は値ではなく点の集合で行う。
 *
 * 目視判定がない場合は上書きではない（検者はまだ何も覆していない）。自動値しか
 * ない状態であることは `cpsMethod` に現れる。
 */
function buildSelectionRecord(
  estimates: readonly CpsEstimate[],
  selected: CpsEstimate | null,
  options: AnalysisOptions,
): SelectionRecord {
  const manual = estimates.find((e) => e.method === "manual_visual_2002");
  const auto = estimates.find((e) => e.method === "plateau_sdev_v1");

  const overridesAutomatic =
    manual?.estimable === true &&
    (auto?.estimable !== true ||
      !sameIndices(manual.plateauItemIndices, auto.plateauItemIndices));

  return {
    cpsMethod: selected?.method ?? "manual_visual_2002",
    mrsMethod: "arithmetic",
    overrideReason: overridesAutomatic ? options.overrideReason : null,
    overridesAutomatic,
  };
}

function sameIndices(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}
