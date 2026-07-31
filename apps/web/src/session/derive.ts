/**
 * ドラフト → 表示用データ（Phase 3）
 *
 * 画面に出る数値はすべてここで `@mnread/core` から取る（ADR-0010）。
 * 本ファイルに算術は書かない。書きたくなったら core に足すのが正しい。
 */

import {
  analyze,
  correctedLogMAR,
  hasBlockingError,
  readingSpeedCpm,
  validateSession,
  VARIANT_SPECS,
  type AnalysisOutcome,
  type ItemStatus,
  type ValidationIssue,
  type VariantSpec,
} from "@mnread/core";

import {
  entryOrder,
  parseField,
  toSessionInput,
  type RowDraft,
  type SessionDraft,
} from "./state.js";

export interface RowView {
  /** rows 上の添字。画面の並びとは別 */
  readonly rowIndex: number;
  /** SessionInput.items 上の添字。core の ValidationIssue と突き合わせる */
  readonly itemIndex: number;
  readonly draft: RowDraft;
  readonly status: ItemStatus;
  readonly chartLogMAR: number;
  /** 距離補正後 logMAR。距離が不正なら null */
  readonly correctedLogMAR: number | null;
  /**
   * この行の読書速度。
   *   number（0 を含む） = 測定された事実
   *   null              = 欠測、または入力エラーで算出できない
   * （ADR-0002。0 と欠測を混同しない）
   */
  readonly speedCpm: number | null;
  readonly issues: readonly ValidationIssue[];
  readonly hasError: boolean;
  /** 検者が触れた行か。未提示のまま何も入っていなければ false */
  readonly touched: boolean;
}

export interface SessionView {
  readonly spec: VariantSpec;
  readonly rows: readonly RowView[];
  /** 行に結び付かない、セッション全体の検証結果 */
  readonly sessionIssues: readonly ValidationIssue[];
  readonly allIssues: readonly ValidationIssue[];
  /** error が1件でもあるか。true の間、解析結果は出さない（ADR-0004） */
  readonly hasError: boolean;
  /** error がある間は ok:false。UI はそのとき値を一切表示しない */
  readonly outcome: AnalysisOutcome;
}

export function deriveSessionView(draft: SessionDraft): SessionView {
  const spec = VARIANT_SPECS[draft.variant];
  const input = toSessionInput(draft);
  const issues = validateSession(input, spec);

  const order = entryOrder(draft);
  const byItemIndex = new Map<number, ValidationIssue[]>();
  const sessionIssues: ValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.itemIndex === null) {
      sessionIssues.push(issue);
      continue;
    }
    const list = byItemIndex.get(issue.itemIndex) ?? [];
    list.push(issue);
    byItemIndex.set(issue.itemIndex, list);
  }

  const sessionDistance = parseField(draft.distanceText);

  const rows = draft.rows.map((row, rowIndex) => {
    const itemIndex = order.indexOf(rowIndex);
    const rowIssues = byItemIndex.get(itemIndex) ?? [];
    const hasRowError = rowIssues.some((i) => i.severity === "error");
    return {
      rowIndex,
      itemIndex,
      draft: row,
      status: row.status,
      chartLogMAR: row.chartLogMAR,
      correctedLogMAR: rowCorrectedLogMAR(row, sessionDistance, spec),
      speedCpm: rowSpeedCpm(row, spec, hasRowError),
      issues: rowIssues,
      hasError: hasRowError,
      touched: row.status !== "unpresented_after_stop",
    } satisfies RowView;
  });

  return {
    spec,
    rows,
    sessionIssues,
    allIssues: issues,
    hasError: hasBlockingError(issues),
    // 検者の目視判定は Phase 4。ここでは自動法のみが動く。
    outcome: analyze(input, { manualPlateau: null }),
  };
}

/* ---------------------------------------------------------- */

/**
 * 1行分の読書速度。
 *
 * 行に error があるあいだは算出しない。core の低レベル関数は前提条件違反で
 * RangeError を投げる契約なので、検証を通っていない値を渡してはならない。
 */
function rowSpeedCpm(
  row: RowDraft,
  spec: VariantSpec,
  hasRowError: boolean,
): number | null {
  if (hasRowError) return null;
  switch (row.status) {
    case "read": {
      const time = parseField(row.timeText);
      const errors = parseField(row.errorText);
      if (time === null || errors === null) return null;
      return readingSpeedCpm(spec, time, errors);
    }
    // 「読めなかった」は測定された事実であり 0 cpm（欠測ではない）。
    case "attempted_unread":
    case "skipped_large_unreadable":
      return 0;
    case "presented_time_missing":
    case "unpresented_after_stop":
    case "skipped_large_assumed_readable":
      return null;
  }
}

function rowCorrectedLogMAR(
  row: RowDraft,
  sessionDistanceCm: number | null,
  spec: VariantSpec,
): number | null {
  const distance = parseField(row.distanceText) ?? sessionDistanceCm;
  if (distance === null || !Number.isFinite(distance) || distance <= 0) return null;
  return correctedLogMAR(row.chartLogMAR, distance, spec.standardDistanceCm);
}
