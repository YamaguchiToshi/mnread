/**
 * 読み材料の状態解決（SPEC §4.2、ADR-0002）
 *
 * 6値の状態から、速度・RA への寄与・曲線への描画可否を決める。
 * 「0 cpm（測定された事実）」と「欠測（情報がない）」を混同しないことが本質。
 */

import { correctedLogMAR, distanceCorrectionLogMAR } from "./distance.js";
import { readingSpeedCpm } from "./speed.js";
import type { ItemResult, ItemStatus, SessionInput, VariantSpec } from "./types.js";

/** 状態ごとの扱い。SPEC §4.2 の表と1対1に対応させている。 */
export interface StatusRule {
  /** RA の N に算入するか */
  readonly includedInAcuity: boolean;
  /** 読書速度曲線に描画するか */
  readonly includedInCurve: boolean;
  /** RA の E への寄与: 記録値 / 全文字 / なし */
  readonly errorContribution: "recorded" | "full" | "zero";
  /** 速度: 算出 / 厳密に0 / 欠測 */
  readonly speed: "computed" | "zero" | "missing";
}

const STATUS_RULES: Readonly<Record<ItemStatus, StatusRule>> = {
  read: {
    includedInAcuity: true,
    includedInCurve: true,
    errorContribution: "recorded",
    speed: "computed",
  },
  attempted_unread: {
    includedInAcuity: true,
    includedInCurve: true,
    errorContribution: "full",
    speed: "zero",
  },
  presented_time_missing: {
    includedInAcuity: true,
    includedInCurve: false,
    errorContribution: "recorded",
    speed: "missing",
  },
  unpresented_after_stop: {
    includedInAcuity: false,
    includedInCurve: false,
    errorContribution: "zero",
    speed: "missing",
  },
  skipped_large_assumed_readable: {
    includedInAcuity: true,
    includedInCurve: false,
    errorContribution: "zero",
    speed: "missing",
  },
  skipped_large_unreadable: {
    includedInAcuity: true,
    includedInCurve: true,
    errorContribution: "full",
    speed: "zero",
  },
} as const;

export function statusRule(status: ItemStatus): StatusRule {
  return STATUS_RULES[status];
}

/**
 * 各読み材料の算出結果を求める。
 *
 * 入力は `validateSession()` を通過していることを前提とする。
 * 行ごとの距離が指定されていればそれを、なければセッションの距離を用いる。
 */
export function resolveItems(
  input: SessionInput,
  spec: VariantSpec,
): readonly ItemResult[] {
  return input.items.map((item, index) => {
    const rule = STATUS_RULES[item.status];
    const distanceCm = item.viewingDistanceCm ?? input.viewingDistanceCm;

    const hasDistance = Number.isFinite(distanceCm) && distanceCm > 0;
    const correction = hasDistance
      ? distanceCorrectionLogMAR(distanceCm, spec.standardDistanceCm)
      : null;
    const effectiveLogMAR = hasDistance
      ? correctedLogMAR(item.chartLogMAR, distanceCm, spec.standardDistanceCm)
      : null;

    let speedCpm: number | null;
    switch (rule.speed) {
      case "computed":
        // read 状態では validateSession が timeSec / errorCount の存在を保証する。
        speedCpm = readingSpeedCpm(spec, item.timeSec ?? 0, item.errorCount ?? 0);
        break;
      case "zero":
        speedCpm = 0;
        break;
      case "missing":
        speedCpm = null;
        break;
    }

    let acuityErrorContribution: number;
    switch (rule.errorContribution) {
      case "recorded":
        acuityErrorContribution = item.errorCount ?? 0;
        break;
      case "full":
        acuityErrorContribution = spec.charactersPerItem;
        break;
      case "zero":
        acuityErrorContribution = 0;
        break;
    }

    return {
      index,
      chartLogMAR: item.chartLogMAR,
      correctedLogMAR: effectiveLogMAR,
      speedCpm,
      status: item.status,
      timeSec: item.timeSec,
      errorCount: item.errorCount,
      includedInAcuity: rule.includedInAcuity,
      acuityErrorContribution: rule.includedInAcuity ? acuityErrorContribution : 0,
      includedInCurve: rule.includedInCurve && speedCpm !== null,
      distanceCorrectionLogMAR: correction,
    };
  });
}
