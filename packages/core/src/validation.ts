/**
 * 入力検証（SPEC §6、ADR-0004）
 *
 * 不正入力は拒否する。黙って丸めたり補完したりしない。
 * 例外ではなく `ValidationIssue[]` を返すのは、UI が全行のエラーを同時に
 * 表示する必要があるため（最初の1件で打ち切らない）。
 */

import { statusRule } from "./items.js";
import { readingSpeedCpm } from "./speed.js";
import type {
  ItemInput,
  SessionInput,
  ValidationIssue,
  VariantSpec,
} from "./types.js";

/**
 * 生理的にありえない読書時間の目安。
 *
 * 下限はマニュアル表C の下端（1.0 秒 = J で 1800 cpm）。上限は Q&A の
 * 「1 文字読むのに1分以上ねばるような場合は、逆に無理をしないように」に基づく
 * 緩い目安。いずれも警告のみで、記録を拒否も削除もしない。臨床的根拠のある
 * 閾値ではないため、実測データで調整してよい。
 */
const PLAUSIBLE_TIME_SEC = { min: 1.0, max: 180 } as const;

export function validateSession(
  input: SessionInput,
  spec: VariantSpec,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Number.isFinite(input.viewingDistanceCm) || input.viewingDistanceCm <= 0) {
    issues.push({
      code: "ERR_DISTANCE_NOT_POSITIVE",
      severity: "error",
      itemIndex: null,
      field: "viewingDistanceCm",
      message: `測定距離は正の数である必要があります: ${String(input.viewingDistanceCm)}`,
    });
  }

  input.items.forEach((item, index) => {
    validateItem(item, index, spec, issues);
  });

  checkDuplicateSizes(input, issues);
  checkSequenceDirection(input, issues);
  checkDistanceVariation(input, issues);
  checkImplausibleTimes(input, spec, issues);

  return issues;
}

/** error を1件でも含むか。含む場合、解析結果を返してはならない。 */
export function hasBlockingError(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/* ---------------------------------------------------------- */

function validateItem(
  item: ItemInput,
  index: number,
  spec: VariantSpec,
  issues: ValidationIssue[],
): void {
  const push = (
    code: ValidationIssue["code"],
    field: string,
    message: string,
  ): void => {
    issues.push({ code, severity: "error", itemIndex: index, field, message });
  };

  if (item.viewingDistanceCm !== null) {
    if (!Number.isFinite(item.viewingDistanceCm) || item.viewingDistanceCm <= 0) {
      push(
        "ERR_DISTANCE_NOT_POSITIVE",
        "viewingDistanceCm",
        `行の測定距離は正の数である必要があります: ${String(item.viewingDistanceCm)}`,
      );
    }
  }

  // 誤り数の妥当性は、状態にかかわらず値が入っていれば検査する。
  if (item.errorCount !== null) {
    if (!Number.isInteger(item.errorCount)) {
      push(
        "ERR_ERRORS_NOT_INTEGER",
        "errorCount",
        `読み損じ文字数は整数である必要があります: ${String(item.errorCount)}`,
      );
    } else if (item.errorCount < 0 || item.errorCount > spec.charactersPerItem) {
      push(
        "ERR_ERRORS_OUT_OF_RANGE",
        "errorCount",
        `読み損じ文字数は 0〜${spec.charactersPerItem} の範囲である必要があります: ${item.errorCount}`,
      );
    }
  }

  if (item.timeSec !== null) {
    if (!Number.isFinite(item.timeSec) || item.timeSec <= 0) {
      push(
        "ERR_TIME_NOT_POSITIVE",
        "timeSec",
        `読書時間は正の数である必要があります: ${String(item.timeSec)}`,
      );
    }
  }

  // 状態とフィールドの整合。
  const rule = statusRule(item.status);
  const needsTime = rule.speed === "computed";
  const needsErrors = rule.errorContribution === "recorded";

  if (needsTime && item.timeSec === null) {
    push(
      "ERR_STATE_FIELD_MISMATCH",
      "timeSec",
      "「読んだ」行には読書時間が必要です。時間が未記録なら状態を presented_time_missing にしてください。",
    );
  }
  if (needsErrors && item.errorCount === null) {
    push(
      "ERR_STATE_FIELD_MISMATCH",
      "errorCount",
      "この状態には読み損じ文字数が必要です。",
    );
  }
  if (!needsErrors && item.errorCount !== null) {
    push(
      "ERR_STATE_FIELD_MISMATCH",
      "errorCount",
      `状態 ${item.status} では読み損じ文字数は記録しません（暗黙に決まります）。`,
    );
  }
  if (item.status === "presented_time_missing" && item.timeSec !== null) {
    push(
      "ERR_STATE_FIELD_MISMATCH",
      "timeSec",
      "状態 presented_time_missing に読書時間が入っています。状態を read にしてください。",
    );
  }
  if (
    (item.status === "unpresented_after_stop" ||
      item.status === "skipped_large_assumed_readable" ||
      item.status === "skipped_large_unreadable") &&
    item.timeSec !== null
  ) {
    push(
      "ERR_STATE_FIELD_MISMATCH",
      "timeSec",
      `状態 ${item.status} では読書時間は記録しません。`,
    );
  }
}

function checkDuplicateSizes(
  input: SessionInput,
  issues: ValidationIssue[],
): void {
  const seen = new Map<number, number>();
  input.items.forEach((item, index) => {
    // 浮動小数点の等値比較を避けるため整数キーに正規化する。
    const key = Math.round(item.chartLogMAR * 1000);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      return;
    }
    issues.push({
      code: "ERR_DUPLICATE_SIZE",
      severity: "error",
      itemIndex: index,
      field: "chartLogMAR",
      message: `文字サイズ ${item.chartLogMAR} logMAR が重複しています（${first + 1} 行目と ${index + 1} 行目）。`,
    });
  });
}

function checkSequenceDirection(
  input: SessionInput,
  issues: ValidationIssue[],
): void {
  const sizes = input.items.map((i) => i.chartLogMAR);
  const descending = sizes.every((v, i) => i === 0 || v <= sizes[i - 1]!);
  const ascending = sizes.every((v, i) => i === 0 || v >= sizes[i - 1]!);
  const expectedDescending = input.sequenceDirection === "large_to_small";

  if (expectedDescending ? descending : ascending) return;

  issues.push({
    code: "WARN_SEQUENCE_REVERSED",
    severity: "warning",
    itemIndex: null,
    field: "items",
    message: `読み材料の並びが sequenceDirection（${input.sequenceDirection}）と一致しません。解析時に整列します。`,
  });
}

function checkDistanceVariation(
  input: SessionInput,
  issues: ValidationIssue[],
): void {
  const distances = new Set(
    input.items
      .filter((i) => i.status !== "unpresented_after_stop")
      .map((i) => i.viewingDistanceCm ?? input.viewingDistanceCm),
  );
  if (distances.size <= 1) return;

  issues.push({
    code: "WARN_DISTANCE_VARIED",
    severity: "warning",
    itemIndex: null,
    field: "viewingDistanceCm",
    message: `測定距離が行によって異なります（${[...distances].join(", ")} cm）。行ごとの距離で補正します。`,
  });
}

function checkImplausibleTimes(
  input: SessionInput,
  spec: VariantSpec,
  issues: ValidationIssue[],
): void {
  input.items.forEach((item, index) => {
    if (item.status !== "read") return;
    const t = item.timeSec;
    if (t === null || !Number.isFinite(t) || t <= 0) return;
    if (t >= PLAUSIBLE_TIME_SEC.min && t <= PLAUSIBLE_TIME_SEC.max) return;

    const e = item.errorCount ?? 0;
    const speed =
      Number.isInteger(e) && e >= 0 && e <= spec.charactersPerItem
        ? readingSpeedCpm(spec, t, e)
        : null;

    issues.push({
      code: "WARN_IMPLAUSIBLE_SPEED",
      severity: "warning",
      itemIndex: index,
      field: "timeSec",
      message:
        t < PLAUSIBLE_TIME_SEC.min
          ? `読書時間 ${t} 秒は速すぎます${speed === null ? "" : `（${Math.round(speed)} cpm）`}。記録を確認してください。`
          : `読書時間 ${t} 秒は遅すぎます${speed === null ? "" : `（${Math.round(speed)} cpm）`}。記録を確認してください。`,
    });
  });
}
