/**
 * 読書視力 RA（SPEC §5.3）
 *
 * 出典: マニュアル §3.4
 *   MNREAD-J : 読書視力 = 1.4 − (文章数 × 0.1) + (読み損じ文字数 / 300)
 *   MNREAD-Jk: 読書視力 = 1.4 − (文章数 × 0.1) + (読み損じ文字数 / 240)
 *
 * 実装は一般形 RA = L_min + h·E/n0 を用いる（SPEC §5.3.2）。上端 1.3・刻み 0.1 の
 * 標準チャートでは L_min = 1.4 − 0.1N となり公式形と一致する。一般形にしておくと
 * チャートの上端や刻みが変わっても式を書き換えずに済む。
 */

import type { ItemResult, ReadingAcuityResult, VariantSpec } from "./types.js";

/**
 * 読書視力を算出する。RA に算入される読み材料が1つもない場合は null。
 *
 * 距離補正には、最後に試行した読み材料（最小サイズ）の実効距離を用いる。
 * 通常は全行で距離が等しく、セッションの距離と一致する。
 */
export function computeReadingAcuity(
  items: readonly ItemResult[],
  spec: VariantSpec,
): ReadingAcuityResult | null {
  const counted = items.filter((it) => it.includedInAcuity);
  if (counted.length === 0) return null;

  // 最後に試行した読み材料 = チャート表示サイズが最小のもの。
  // 入力順に依存しないよう、順序ではなく値で決める。
  let last = counted[0]!;
  for (const it of counted) {
    if (it.chartLogMAR < last.chartLogMAR) last = it;
  }

  const cumulativeErrors = counted.reduce(
    (sum, it) => sum + it.acuityErrorContribution,
    0,
  );

  const errorResolutionLogMAR = spec.stepLogMAR / spec.charactersPerItem;
  const raChartLogMAR =
    last.chartLogMAR + errorResolutionLogMAR * cumulativeErrors;

  const distanceCorrection = last.distanceCorrectionLogMAR ?? 0;

  // マニュアル §2.3(5) および Q&A:「全く読めなくなるまで」測定する。
  // 最小サイズでも全文字を読み損じていないなら、読書視力の下限に達していない。
  const censored = last.acuityErrorContribution < spec.charactersPerItem;

  return {
    attemptedItemCount: counted.length,
    cumulativeErrors,
    lastAttemptedChartLogMAR: last.chartLogMAR,
    raChartLogMAR,
    distanceCorrectionLogMAR: distanceCorrection,
    raCorrectedLogMAR: raChartLogMAR + distanceCorrection,
    censored,
    errorResolutionLogMAR,
  };
}

/**
 * 公式形 RA = 1.4 − 0.1N + E/d による算出。
 *
 * 標準チャート（上端 1.3、刻み 0.1、19段）専用。一般形との一致を検証するために
 * 公開しており、本体の算出には `computeReadingAcuity()` を用いる。
 */
export function readingAcuityClosedForm(
  spec: VariantSpec,
  attemptedItemCount: number,
  cumulativeErrors: number,
): number {
  const denominator = spec.charactersPerItem / spec.stepLogMAR;
  return (
    spec.topLogMAR +
    spec.stepLogMAR -
    spec.stepLogMAR * attemptedItemCount +
    cumulativeErrors / denominator
  );
}
