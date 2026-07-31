/**
 * 測定距離の補正（SPEC §5.2）
 *
 * 出典: マニュアル §3.5、表A
 *   logMAR 補正値 = log10( 30 / 実際の測定距離(cm) )
 *   M 補正値      = 30 / 実際の測定距離(cm)
 *
 * 補正は RA・CPS・曲線の横軸に適用する。**読書速度 cpm には適用しない。**
 */

/**
 * 加法的な角サイズ補正（logMAR）。
 *
 * @throws {RangeError} いずれかの距離が有限の正数でない場合
 */
export function distanceCorrectionLogMAR(
  viewingDistanceCm: number,
  standardDistanceCm: number,
): number {
  assertPositiveFinite(viewingDistanceCm, "viewingDistanceCm");
  assertPositiveFinite(standardDistanceCm, "standardDistanceCm");
  return Math.log10(standardDistanceCm / viewingDistanceCm);
}

/**
 * M 値に対する乗法的な補正（マニュアル表A の「M 補正値（倍数）」）。
 *
 * logMAR 補正と等価であり、補正後 logMAR から M を求めれば本関数は不要だが、
 * 原典の表と対照するために公開する。
 */
export function distanceCorrectionMMultiplier(
  viewingDistanceCm: number,
  standardDistanceCm: number,
): number {
  assertPositiveFinite(viewingDistanceCm, "viewingDistanceCm");
  assertPositiveFinite(standardDistanceCm, "standardDistanceCm");
  return standardDistanceCm / viewingDistanceCm;
}

/** チャート表示 logMAR に距離補正を加えた実効 logMAR。 */
export function correctedLogMAR(
  chartLogMAR: number,
  viewingDistanceCm: number,
  standardDistanceCm: number,
): number {
  if (!Number.isFinite(chartLogMAR)) {
    throw new RangeError(`chartLogMAR は有限である必要がある: ${String(chartLogMAR)}`);
  }
  return (
    chartLogMAR + distanceCorrectionLogMAR(viewingDistanceCm, standardDistanceCm)
  );
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} は有限の正数である必要がある: ${String(value)}`);
  }
}
