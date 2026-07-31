/**
 * 読書アクセシビリティ対象範囲平均速度（SPEC §5.6、ADR-0008）
 *
 * 英語版 ACC の正規化定数 200 wpm は英語母語話者から得られたものであり
 * cpm に転用しない。日本語版では**非正規化のまま**返し、`normalized` は常に null。
 * 表示名も `ACC` と単独表示してはならない。
 *
 * 欠測の扱いは原著（Calabrèse 2016）の規則に従う。
 *   - 読書視力限界により読めない → 0
 *   - 大きい文字が読めない       → 0
 *   - 便宜上省略した             → 次に実測された速度で補完
 * これ以外の補間は行わない。
 */

import { mean } from "./curve.js";
import type { AccessibilityResult, ItemResult } from "./types.js";
import { ACCESSIBILITY_RANGE_CHART_LOGMAR } from "./variants.js";

export function computeAccessibility(
  items: readonly ItemResult[],
  standardDistanceCm: number,
  viewingDistanceCm: number,
): AccessibilityResult {
  const { min, max } = ACCESSIBILITY_RANGE_CHART_LOGMAR;

  // 対象は**チャート表示値**で 1.3〜0.4 の10行。補正後の値で選ばない
  // （原著は「チャート上の最大10サイズ」を対象としているため）。
  const inRange = items
    .filter((i) => i.chartLogMAR >= min - 1e-9 && i.chartLogMAR <= max + 1e-9)
    .sort((a, b) => b.chartLogMAR - a.chartLogMAR);

  const speeds: number[] = [];
  for (let i = 0; i < inRange.length; i += 1) {
    const item = inRange[i]!;
    switch (item.status) {
      case "read":
        if (item.speedCpm !== null) speeds.push(item.speedCpm);
        break;

      // 読書視力限界により読めない / 大きい文字が読めない → 0
      case "attempted_unread":
      case "skipped_large_unreadable":
      case "unpresented_after_stop":
        speeds.push(0);
        break;

      // 便宜上省略した → 次に実測された速度で補完
      case "skipped_large_assumed_readable": {
        const next = inRange
          .slice(i + 1)
          .find((n) => n.status === "read" && n.speedCpm !== null);
        if (next?.speedCpm !== undefined && next.speedCpm !== null) {
          speeds.push(next.speedCpm);
        }
        break;
      }

      // 原著の規則が想定していない状態。捏造せず対象から外し、n を減らす。
      case "presented_time_missing":
        break;
    }
  }

  return {
    meanSpeedCpm: speeds.length > 0 ? mean(speeds) : null,
    n: speeds.length,
    normalized: null,
    nonStandardDistance: Math.abs(viewingDistanceCm - standardDistanceCm) > 1e-9,
  };
}
