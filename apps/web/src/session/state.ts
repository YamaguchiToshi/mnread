/**
 * 入力画面の状態モデル（Phase 3）
 *
 * ここは「検者が打った文字」を保持する層であり、臨床値は一切算出しない（ADR-0010）。
 * 数値は `@mnread/core` に渡し、妥当かどうかの判定も core の `validateSession()` に委ねる。
 * 本ファイルが行うのは、テキスト → 数値の変換と、SPEC §4.2 の状態遷移だけである。
 *
 * 変換できないテキストは `NaN` として core に渡す。UI 側で「たぶん0だろう」と補うと
 * ADR-0004（拒否する。黙って丸めない）に反するため、判定は必ず core を通す。
 */

import {
  chartLogMARLevels,
  VARIANT_SPECS,
  type Eye,
  type ItemInput,
  type ItemStatus,
  type Polarity,
  type SequenceDirection,
  type SessionInput,
  type SubjectMeta,
  type Variant,
} from "@mnread/core";

/* ============================================================
   行
   ============================================================ */

/** 入力欄の識別子。キーボード移動の単位でもある。 */
export type CellField = "time" | "errors" | "distance";

export interface RowDraft {
  /** チャートに印刷された logMAR。行の同一性はこの値で決まる */
  readonly chartLogMAR: number;
  readonly status: ItemStatus;
  /** 入力欄の生テキスト。数値にならない間もそのまま保持する */
  readonly timeText: string;
  readonly errorText: string;
  /** 行別視距離。空ならセッション既定値 */
  readonly distanceText: string;
  readonly note: string;
}

/**
 * 状態ごとに、どの欄に値を持てるか（SPEC §4.2 / core の validateSession と対応）。
 *
 * core は「状態と欄の有無が矛盾する」入力を error として拒否する。UI がその矛盾を
 * 作らないよう、状態を変えた時点で欄を整える。この表は core の `statusRule()` の
 * 言い換えではなく、**入力欄の可否**という UI 固有の関心事である。
 */
interface FieldPolicy {
  readonly time: "required" | "forbidden";
  readonly errors: "required" | "forbidden";
}

const FIELD_POLICY: Readonly<Record<ItemStatus, FieldPolicy>> = {
  read: { time: "required", errors: "required" },
  attempted_unread: { time: "forbidden", errors: "forbidden" },
  presented_time_missing: { time: "forbidden", errors: "required" },
  unpresented_after_stop: { time: "forbidden", errors: "forbidden" },
  skipped_large_assumed_readable: { time: "forbidden", errors: "forbidden" },
  skipped_large_unreadable: { time: "forbidden", errors: "forbidden" },
} as const;

export function fieldPolicy(status: ItemStatus): FieldPolicy {
  return FIELD_POLICY[status];
}

/**
 * 入力欄を編集できるか。`FIELD_POLICY`（core との契約）とは別の関心事である。
 *
 * 未提示の行の時間欄だけは、値を持てない状態であるにもかかわらず開けておく。
 * 検者はそこに打ち始めることで行を「読んだ」に遷移させるからであり、これを閉じると
 * 検査が始められない。打った瞬間に状態が変わるため、core に矛盾した入力は渡らない。
 */
export function isCellEnabled(status: ItemStatus, field: "time" | "errors"): boolean {
  if (field === "time") {
    return status === "read" || status === "unpresented_after_stop";
  }
  return FIELD_POLICY[status].errors === "required";
}

/** 状態メニューの並び。テンキーの 1〜6 に対応する。 */
export const STATUS_ORDER: readonly ItemStatus[] = [
  "read",
  "attempted_unread",
  "presented_time_missing",
  "unpresented_after_stop",
  "skipped_large_assumed_readable",
  "skipped_large_unreadable",
];

export const STATUS_LABEL: Readonly<Record<ItemStatus, string>> = {
  read: "読んだ",
  attempted_unread: "不読（0 cpm）",
  presented_time_missing: "時間未記録",
  unpresented_after_stop: "未提示",
  skipped_large_assumed_readable: "上位省略（読める）",
  skipped_large_unreadable: "大文字側が読めない",
};

/** 表内に出す短い記号。列幅を食わないようにする。 */
export const STATUS_SHORT: Readonly<Record<ItemStatus, string>> = {
  read: "読",
  attempted_unread: "不読",
  presented_time_missing: "時間なし",
  unpresented_after_stop: "未提示",
  skipped_large_assumed_readable: "省略",
  skipped_large_unreadable: "大不読",
};

/* ============================================================
   セッション
   ============================================================ */

export interface SessionDraft {
  readonly variant: Variant;
  readonly chartVersion: string;
  readonly distanceText: string;
  readonly polarity: Polarity;
  readonly eye: Eye;
  readonly sequenceDirection: SequenceDirection;
  readonly subjectId: string;
  readonly ageText: string;
  readonly sex: string;
  readonly testDate: string;
  /** 行別視距離の列を表示するか。既定は非表示（通常は全行同一距離） */
  readonly perRowDistance: boolean;
  /** チャート順（大→小）で固定。表示順・items 順は sequenceDirection から導く */
  readonly rows: readonly RowDraft[];
}

export function emptyRow(chartLogMAR: number): RowDraft {
  return {
    chartLogMAR,
    status: "unpresented_after_stop",
    timeText: "",
    errorText: "",
    distanceText: "",
    note: "",
  };
}

/**
 * 未入力のセッション。
 *
 * 全行の初期状態を `unpresented_after_stop`（未提示）とするのは、検査開始前の事実が
 * まさに「まだ提示していない」だからである。この状態は core の検証を通るため、
 * 検査中いつでも `analyze()` が成立し、曲線を出し続けられる。
 */
export function createSession(variant: Variant = "MNREAD-J"): SessionDraft {
  return {
    variant,
    chartVersion: "",
    distanceText: String(VARIANT_SPECS[variant].standardDistanceCm),
    polarity: "black_on_white",
    eye: "both",
    sequenceDirection: "large_to_small",
    subjectId: "",
    ageText: "",
    sex: "",
    testDate: "",
    perRowDistance: false,
    rows: chartLogMARLevels(VARIANT_SPECS[variant]).map(emptyRow),
  };
}

/* ============================================================
   表示順 / items 順
   ============================================================ */

/**
 * 行を検査実施順に並べたときの、`rows` 上の添字。
 *
 * 小→大で実施した場合、検者は小さい文字から打つ。画面の並びも `items` の並びも
 * 実施順に合わせる（core の並び順検証が意味を持つようにするため）。解析は core が
 * 値で整列するので、どちらの順でも同じ結果になる。
 */
export function entryOrder(draft: SessionDraft): readonly number[] {
  const indices = draft.rows.map((_, i) => i);
  return draft.sequenceDirection === "small_to_large"
    ? [...indices].reverse()
    : indices;
}

/** items の添字 → rows の添字。core の ValidationIssue.itemIndex を行に戻すのに使う。 */
export function itemIndexToRowIndex(draft: SessionDraft, itemIndex: number): number {
  return entryOrder(draft)[itemIndex] ?? itemIndex;
}

/** rows の添字 → items の添字。 */
export function rowIndexToItemIndex(draft: SessionDraft, rowIndex: number): number {
  return entryOrder(draft).indexOf(rowIndex);
}

/* ============================================================
   テキスト → 数値
   ============================================================ */

/**
 * 入力欄のテキストを数値に変換する。
 *
 *   空文字      → null（値がない）
 *   数値        → その値
 *   それ以外    → NaN（値が不正であるという事実。0 に丸めない）
 *
 * NaN をそのまま core に渡すのは、不正であるという判定を UI が先取りしないためである。
 * core が `ERR_*` を返し、UI はそれを表示するだけでよい。
 */
export function parseField(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // Number() は "" や空白を 0 にするため、上で弾いた後に使う。
  return Number(trimmed);
}

/** 状態の要求どおりに欄を整える。値の捏造ではなく SPEC §4.2 の状態遷移。 */
export function normalizeRow(row: RowDraft): RowDraft {
  const policy = FIELD_POLICY[row.status];
  const timeText = policy.time === "forbidden" ? "" : row.timeText;
  const errorText =
    policy.errors === "forbidden"
      ? ""
      : row.errorText === ""
        ? "0" // 「誤り数は既定0で飛ばせる」（PLAN Phase 3）
        : row.errorText;
  if (timeText === row.timeText && errorText === row.errorText) return row;
  return { ...row, timeText, errorText };
}

function toItemInput(row: RowDraft): ItemInput {
  const policy = FIELD_POLICY[row.status];
  return {
    chartLogMAR: row.chartLogMAR,
    status: row.status,
    timeSec: policy.time === "forbidden" ? null : parseField(row.timeText),
    errorCount: policy.errors === "forbidden" ? null : parseField(row.errorText),
    viewingDistanceCm: parseField(row.distanceText),
    ...(row.note === "" ? {} : { note: row.note }),
  };
}

function toSubjectMeta(draft: SessionDraft): SubjectMeta | undefined {
  const age = parseField(draft.ageText);
  const meta: SubjectMeta = {
    ...(draft.subjectId === "" ? {} : { subjectId: draft.subjectId }),
    ...(age === null ? {} : { age }),
    ...(draft.sex === "" ? {} : { sex: draft.sex }),
    ...(draft.testDate === "" ? {} : { testDate: draft.testDate }),
  };
  return Object.keys(meta).length === 0 ? undefined : meta;
}

/** ドラフトを core の入力に変換する。ここでも値の補完・丸めは行わない。 */
export function toSessionInput(draft: SessionDraft): SessionInput {
  const order = entryOrder(draft);
  const meta = toSubjectMeta(draft);
  return {
    variant: draft.variant,
    chartVersion: draft.chartVersion,
    viewingDistanceCm: parseField(draft.distanceText) ?? Number.NaN,
    polarity: draft.polarity,
    eye: draft.eye,
    sequenceDirection: draft.sequenceDirection,
    ...(meta === undefined ? {} : { subject: meta }),
    items: order.map((i) => toItemInput(draft.rows[i]!)),
  };
}

/** 1行でも検者が触れているか。未保存の破棄を警告するかどうかの判定に使う。 */
export function hasEnteredData(draft: SessionDraft): boolean {
  return draft.rows.some(
    (r) => r.status !== "unpresented_after_stop" || r.note !== "" || r.distanceText !== "",
  );
}
