/**
 * 判読ゾーン（SPEC §5.8、ADR-0013）
 *
 * 患者・支援者向けレポートで文字サイズを「不可 / 努力 / 快適」の3帯に分ける。
 * **原典に規定がない本プロジェクト固有の裁定であり**（OPEN-7）、Phase 5 の
 * 実測較正対象である。
 *
 * 境界は RA と CPS の2点のみ。支援余裕 0.1 logMAR はここに入れない
 * （CPS〜CPS+0.1 では実際に最大読書速度が出ているため、「努力」に落とすと
 * 測定した事実と表示が食い違う）。余裕は `supportRange()` の推奨サイズ範囲
 * として別枠に出す。
 */

import { isNonStandardDistance, pointSizeAtDistance } from "./convert.js";
import type {
  CpsEstimate,
  ReadingAcuityResult,
  ReadingZone,
  ReadingZoneId,
  ReadingZoneSet,
} from "./types.js";

/**
 * 判読ゾーンを求める。
 *
 * CPS が推定不能、または RA が算出できない場合は `null` を返す。数値を出せない
 * ことを数値で表現しない（SPEC §5.5.4 と同じ規則）。
 *
 * RA > CPS の退化（誤りが多く RA の誤り項に押し上げられた場合）では、値を
 * 入れ替えず「努力」を空のゾーンとして返す。呼び出し側は `raAboveCps` を見て
 * `RA_ABOVE_CPS` を立てる。
 *
 * 各境界のポイントは**測定距離と標準距離の両方**を返す（SPEC §5.8）。ポイントは
 * 物理量であり、読む距離を決めなければ大きさが決まらない。
 */
export function readingZones(
  readingAcuity: ReadingAcuityResult | null,
  cps: CpsEstimate | null,
  targetDistanceCm: number,
  standardDistanceCm: number,
): ReadingZoneSet | null {
  if (readingAcuity === null) return null;
  if (cps === null || !cps.estimable || cps.cpsCorrectedLogMAR === null) return null;

  const ra = readingAcuity.raCorrectedLogMAR;
  const cpsLogMAR = cps.cpsCorrectedLogMAR;
  if (!Number.isFinite(ra) || !Number.isFinite(cpsLogMAR)) return null;

  const toPoint = (logMAR: number | null, distanceCm: number): number | null =>
    logMAR === null ? null : pointSizeAtDistance(logMAR, distanceCm);

  const zone = (
    id: ReadingZoneId,
    min: number | null,
    max: number | null,
  ): ReadingZone => ({
    id,
    minCorrectedLogMAR: min,
    maxCorrectedLogMAR: max,
    minPoint: toPoint(min, targetDistanceCm),
    maxPoint: toPoint(max, targetDistanceCm),
    minPointAtStandard: toPoint(min, standardDistanceCm),
    maxPointAtStandard: toPoint(max, standardDistanceCm),
    empty: min !== null && max !== null && min >= max,
  });

  return {
    zones: [
      zone("unreadable", null, ra),
      zone("effortful", ra, cpsLogMAR),
      zone("comfortable", cpsLogMAR, null),
    ],
    cpsMethod: cps.method,
    cpsCorrectedLogMAR: cpsLogMAR,
    raCorrectedLogMAR: ra,
    raCensored: readingAcuity.censored,
    raAboveCps: ra > cpsLogMAR,
    targetDistanceCm,
    standardDistanceCm,
    nonStandardDistance: isNonStandardDistance(targetDistanceCm, standardDistanceCm),
  };
}

/**
 * ある文字サイズがどのゾーンに入るか。
 *
 * レポートが「この教材（○ pt）はどの帯か」を示すために使う。UI 側で
 * 境界と比較する算術を書かせないための関数である（ADR-0010）。
 * 退化（RA > CPS）では「努力」が空なので、この関数も「努力」を返さない。
 */
export function classifyZone(
  zones: ReadingZoneSet,
  correctedLogMAR: number,
): ReadingZoneId {
  if (correctedLogMAR < zones.raCorrectedLogMAR) return "unreadable";
  if (correctedLogMAR < zones.cpsCorrectedLogMAR) return "effortful";
  return "comfortable";
}
