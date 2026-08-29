/**
 * 単位換算（SPEC §5.7、ADR-0007）
 *
 * すべて**距離補正後の logMAR** を入力に取る。
 * 出典はマニュアル §3.6・図1a、Q&A A4.2 / A4.3 / A7。
 */

import type { SupportRange, UnitConversion } from "./types.js";
import {
  JAPANESE_CHARACTER_ANGLE_COEFFICIENT,
  M_REFERENCE_LOG_OFFSET,
  MM_PER_POINT,
  POINT_CONVERSION_COEFFICIENT,
} from "./variants.js";

/** 小数視力（マニュアル §3.6: 小数視力 = 1 ÷ 10^logMAR）。 */
export function decimalAcuity(logMAR: number): number {
  assertFinite(logMAR, "logMAR");
  return Math.pow(10, -logMAR);
}

/**
 * M 値（Q&A A7: M値 = 10^(logMAR − 0.4)）。
 *
 * M は Magnification の頭字であり、新聞を読むのに必要な倍率を表す。
 * 30cm 以外で測定した場合は、補正後 logMAR を渡せばよい
 * （マニュアル表A の乗数 30/D による補正と等価）。
 */
export function mValue(correctedLogMAR: number): number {
  assertFinite(correctedLogMAR, "correctedLogMAR");
  return Math.pow(10, correctedLogMAR - M_REFERENCE_LOG_OFFSET);
}

/**
 * MNREAD-J 相当ポイントサイズ（30cm 基準）。
 *
 * Q&A A4.3: ポイントサイズ = tan(10^logMAR × 5/60 度) × 1908
 *
 * 「相当値」であり、任意のフォントの実際の字面高とは一致しない。
 * 表示時は必ず「MNREAD-J 相当」と明記すること。
 */
export function pointSizeAt30cm(correctedLogMAR: number): number {
  assertFinite(correctedLogMAR, "correctedLogMAR");
  const degrees = Math.pow(10, correctedLogMAR) * (5 / 60);
  return Math.tan(degrees * (Math.PI / 180)) * POINT_CONVERSION_COEFFICIENT;
}

/** 目標読書距離で同じ角サイズを得るためのポイント相当値。 */
export function pointSizeAtDistance(
  correctedLogMAR: number,
  targetDistanceCm: number,
): number {
  if (!Number.isFinite(targetDistanceCm) || targetDistanceCm <= 0) {
    throw new RangeError(
      `targetDistanceCm は有限の正数である必要がある: ${String(targetDistanceCm)}`,
    );
  }
  return pointSizeAt30cm(correctedLogMAR) * (targetDistanceCm / 30);
}

/** DTP ポイントから物理ボディ高（mm）。 */
export function bodyHeightMm(pointSize: number): number {
  assertFinite(pointSize, "pointSize");
  return pointSize * MM_PER_POINT;
}

/**
 * 日本語文字の視角（arcmin）。Q&A A4.2: 視角 = 10^logMAR × 11.4。
 *
 * OPEN-5: A4.3 のポイント換算式が含意する係数は 11.22 であり、A4.2 の 11.4 とは
 * 約1.6% 異なる。本関数は情報表示にのみ用い、pt・M・臨床値はこれに依存しない。
 */
export function visualAngleArcmin(correctedLogMAR: number): number {
  assertFinite(correctedLogMAR, "correctedLogMAR");
  return Math.pow(10, correctedLogMAR) * JAPANESE_CHARACTER_ANGLE_COEFFICIENT;
}

/** 換算値をまとめて算出する。 */
export function unitConversion(
  correctedLogMAR: number,
  targetDistanceCm: number,
): UnitConversion {
  const pointAt30cm = pointSizeAt30cm(correctedLogMAR);
  const pointAtDistance = pointSizeAtDistance(correctedLogMAR, targetDistanceCm);
  return {
    correctedLogMAR,
    decimalAcuity: decimalAcuity(correctedLogMAR),
    mValue: mValue(correctedLogMAR),
    pointAt30cm,
    pointAtDistance,
    bodyHeightMm: bodyHeightMm(pointAtDistance),
    visualAngleArcmin: visualAngleArcmin(correctedLogMAR),
  };
}

/**
 * 支援用サイズ範囲（SPEC §5.7）。
 *
 * 下限は CPS そのもの、上限は CPS に余裕を加えたサイズ。**測定距離での値と
 * 標準距離での値を両方返す。** ポイントは物理量なので、どの距離で読むかを
 * 決めないと大きさが決まらない。片方だけを返すと、受け取った側が「どちらの
 * 距離の数字か」を紙面から知る手立てがなくなる（視能訓練士レビュー 2026-08）。
 * CPS は「快適さを保証する推奨サイズ」ではなく「最大速度を支える最小サイズ」
 * であるため、この2つを混ぜて1つの推奨値として提示してはならない。
 *
 * マニュアル §3.7 は、Jk の結果から漢字かな交じり文用のエイドを選ぶ場合に
 * 0.1 logMAR（約26%）高めの倍率を勧めており、既定の余裕はこれに合わせている。
 */
export function supportRange(
  cpsCorrectedLogMAR: number,
  marginLogMAR: number,
  targetDistanceCm: number,
  standardDistanceCm: number,
): SupportRange {
  assertFinite(cpsCorrectedLogMAR, "cpsCorrectedLogMAR");
  assertFinite(marginLogMAR, "marginLogMAR");
  const upperLogMAR = cpsCorrectedLogMAR + marginLogMAR;
  return {
    lowerPoint: pointSizeAtDistance(cpsCorrectedLogMAR, targetDistanceCm),
    upperPoint: pointSizeAtDistance(upperLogMAR, targetDistanceCm),
    lowerPointAtStandard: pointSizeAtDistance(cpsCorrectedLogMAR, standardDistanceCm),
    upperPointAtStandard: pointSizeAtDistance(upperLogMAR, standardDistanceCm),
    targetDistanceCm,
    standardDistanceCm,
    nonStandardDistance: isNonStandardDistance(targetDistanceCm, standardDistanceCm),
    marginLogMAR,
    marginRatio: Math.pow(10, marginLogMAR),
  };
}

/**
 * 測定距離が標準距離と異なるか。
 *
 * 表示側が距離を比べる算術を書かずに済むよう、判定を core に置く（ADR-0010）。
 * 許容差は §5.6 の `nonStandardDistance` と同じ 1e-9。
 */
export function isNonStandardDistance(
  targetDistanceCm: number,
  standardDistanceCm: number,
): boolean {
  return Math.abs(targetDistanceCm - standardDistanceCm) > 1e-9;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} は有限である必要がある: ${String(value)}`);
  }
}
