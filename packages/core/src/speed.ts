/**
 * 読書速度（SPEC §5.1）
 *
 * 出典: マニュアル §3.1
 *   MNREAD-J : 読書速度(cpm) = (30 - 読み損じた文字数) ÷ 秒数 × 60
 *   MNREAD-Jk: 読書速度(cpm) = (24 - 読み損じた文字数) ÷ 秒数 × 60
 */

import type { VariantSpec } from "./types.js";

/**
 * 誤り補正済み読書速度（cpm）。
 *
 * 前提条件を満たさない入力では例外を送出する。これは実装の誤りを示す。
 * 利用者入力の検証は `validateSession()` が担い、そちらは例外ではなく
 * `ValidationIssue[]` を返す（ADR-0004）。本関数はその検証を通過した値に
 * 対して呼ぶこと。
 *
 * @throws {RangeError} timeSec が有限の正数でない場合
 * @throws {RangeError} errorCount が 0..n0 の整数でない場合
 */
export function readingSpeedCpm(
  spec: VariantSpec,
  timeSec: number,
  errorCount: number,
): number {
  if (!Number.isFinite(timeSec) || timeSec <= 0) {
    throw new RangeError(
      `timeSec は有限の正数である必要がある: ${String(timeSec)}`,
    );
  }
  if (!Number.isInteger(errorCount)) {
    throw new RangeError(
      `errorCount は整数である必要がある: ${String(errorCount)}`,
    );
  }
  if (errorCount < 0 || errorCount > spec.charactersPerItem) {
    throw new RangeError(
      `errorCount は 0..${spec.charactersPerItem} の範囲である必要がある: ${errorCount}`,
    );
  }

  // errorCount === charactersPerItem のとき厳密に 0 を返す（マニュアル §3.1:
  // 「30 文字全部を読み損じた場合は、読書速度はゼロになります」）。
  return (60 * (spec.charactersPerItem - errorCount)) / timeSec;
}
