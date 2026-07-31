/**
 * 目視判定による臨界文字サイズ（`manual_visual_2002`）
 *
 * 臨床の主値（ADR-0006）。検者がグラフ上で選択したプラトーをそのまま用いる。
 * 原典 §3.2 の「読書速度が落ちはじめる直前の文字サイズ」を、検者の判断として
 * 受け取る純関数であり、アルゴリズムは何も推定しない。
 *
 * 原典 §5 は、MNJA の自動推定がばらつきの大きいデータで臨界文字サイズを
 * 低く推定しうるとして「自ら手書きで推定した値を利用してください」と指示している。
 * この関数はその指示をコードに落としたものにあたる。
 */

import type { CurvePoint } from "../curve.js";
import type { CpsEstimate, PlateauSelection } from "../types.js";

const METHOD = "manual_visual_2002" as const;

export interface ManualPlateauResult {
  readonly estimate: CpsEstimate;
  /** MRS 算出に渡すプラトー点。推定不能なら空 */
  readonly plateau: readonly CurvePoint[];
}

export function estimateManual(
  curve: readonly CurvePoint[],
  selection: PlateauSelection | null,
): ManualPlateauResult {
  if (selection === null) {
    return notEstimable("検者によるプラトー選択がない");
  }

  const byItemIndex = new Map(curve.map((p) => [p.itemIndex, p]));
  const excluded = new Set(selection.excludedItemIndices);

  const missing: number[] = [];
  const plateau: CurvePoint[] = [];
  for (const idx of selection.plateauItemIndices) {
    if (excluded.has(idx)) continue;
    const point = byItemIndex.get(idx);
    if (point === undefined) {
      missing.push(idx);
      continue;
    }
    plateau.push(point);
  }

  if (missing.length > 0) {
    // 曲線に載らない点（欠測・未提示）をプラトーに選ぶことはできない。
    // 黙って無視すると MRS が選択と食い違うため、推定不能として返す。
    return notEstimable(
      `選択された点のうち ${missing.length} 件が曲線上に存在しない（欠測または未提示）`,
    );
  }
  if (plateau.length === 0) {
    return notEstimable("選択されたプラトーが空である");
  }

  plateau.sort((a, b) => b.correctedLogMAR - a.correctedLogMAR);
  const smallest = plateau[plateau.length - 1]!;

  return {
    estimate: {
      method: METHOD,
      estimable: true,
      notEstimableReason: null,
      cpsChartLogMAR: smallest.chartLogMAR,
      cpsCorrectedLogMAR: smallest.correctedLogMAR,
      extrapolated: false,
      plateauItemIndices: plateau.map((p) => p.itemIndex),
      fit: null,
    },
    plateau,
  };
}

function notEstimable(reason: string): ManualPlateauResult {
  return {
    estimate: {
      method: METHOD,
      estimable: false,
      notEstimableReason: reason,
      cpsChartLogMAR: null,
      cpsCorrectedLogMAR: null,
      extrapolated: false,
      plateauItemIndices: [],
      fit: null,
    },
    plateau: [],
  };
}
