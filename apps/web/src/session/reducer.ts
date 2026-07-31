/**
 * 入力操作の適用と Undo（Phase 3）
 *
 * 純関数として書く。React に依存させないのは、キーボード操作の全系列を
 * DOM なしでテストできるようにするためである。
 */

import type { Eye, ItemStatus, Polarity, SequenceDirection, Variant } from "@mnread/core";
import {
  createSession,
  normalizeRow,
  type CellField,
  type SessionDraft,
} from "./state.js";

/* ============================================================
   操作
   ============================================================ */

export type Action =
  | { readonly type: "setCell"; readonly row: number; readonly field: CellField; readonly text: string }
  | { readonly type: "setStatus"; readonly row: number; readonly status: ItemStatus }
  | { readonly type: "clearRow"; readonly row: number }
  | { readonly type: "setVariant"; readonly variant: Variant }
  | { readonly type: "setDistance"; readonly text: string }
  | { readonly type: "setChartVersion"; readonly text: string }
  | { readonly type: "setSubjectId"; readonly text: string }
  | { readonly type: "setAge"; readonly text: string }
  | { readonly type: "setSex"; readonly text: string }
  | { readonly type: "setTestDate"; readonly text: string }
  | { readonly type: "setPolarity"; readonly polarity: Polarity }
  | { readonly type: "setEye"; readonly eye: Eye }
  | { readonly type: "setSequenceDirection"; readonly direction: SequenceDirection }
  | { readonly type: "togglePerRowDistance" }
  | { readonly type: "resetSession" }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

/* ============================================================
   履歴
   ============================================================ */

export interface HistoryState {
  readonly past: readonly SessionDraft[];
  readonly present: SessionDraft;
  readonly future: readonly SessionDraft[];
  /** 直前の操作の合成キー。連続入力を1段の Undo にまとめるために持つ */
  readonly lastCoalesceKey: string | null;
}

/** 履歴の上限。19行の浅い構造なので深めに取ってよい。 */
const HISTORY_LIMIT = 200;

export function createHistory(draft: SessionDraft = createSession()): HistoryState {
  return { past: [], present: draft, future: [], lastCoalesceKey: null };
}

/**
 * 連続した文字入力を1つの Undo にまとめるためのキー。
 *
 * 1打鍵ごとに履歴を刻むと、Undo が「1文字消す」操作になり、検査中の誤入力を
 * 取り消す用途に耐えない。同じ欄への連続入力は1段にまとめる。
 */
function coalesceKey(action: Action): string | null {
  switch (action.type) {
    case "setCell":
      return `cell:${action.row}:${action.field}`;
    case "setDistance":
      return "distance";
    case "setChartVersion":
      return "chartVersion";
    case "setSubjectId":
      return "subjectId";
    case "setAge":
      return "age";
    case "setSex":
      return "sex";
    case "setTestDate":
      return "testDate";
    default:
      return null;
  }
}

export function reduce(state: HistoryState, action: Action): HistoryState {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (previous === undefined) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      // Undo 直後の入力を直前の編集に合成すると、取り消したはずの段が復活する。
      lastCoalesceKey: null,
    };
  }
  if (action.type === "redo") {
    const next = state.future[0];
    if (next === undefined) return state;
    return {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
      lastCoalesceKey: null,
    };
  }

  const present = applyToDraft(state.present, action);
  if (present === state.present) return state;

  const key = coalesceKey(action);
  const merge = key !== null && key === state.lastCoalesceKey;

  return {
    past: merge ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    lastCoalesceKey: key,
  };
}

/* ============================================================
   ドラフトへの適用
   ============================================================ */

function replaceRow(
  draft: SessionDraft,
  index: number,
  update: (row: SessionDraft["rows"][number]) => SessionDraft["rows"][number],
): SessionDraft {
  const row = draft.rows[index];
  if (row === undefined) return draft;
  const next = update(row);
  if (next === row) return draft;
  return {
    ...draft,
    rows: draft.rows.map((r, i) => (i === index ? next : r)),
  };
}

function applyToDraft(draft: SessionDraft, action: Action): SessionDraft {
  switch (action.type) {
    case "setCell":
      return replaceRow(draft, action.row, (row) => {
        if (action.field === "distance") {
          return { ...row, distanceText: action.text };
        }
        if (action.field === "errors") {
          return { ...row, errorText: action.text };
        }
        // 時間を打ち始めた行は「読んだ」に遷移する。検査中の実際の流れがそうであり、
        // 状態を別途指定させると1操作増える。空にすれば未提示へ戻る。
        if (row.status === "unpresented_after_stop" && action.text.trim() !== "") {
          return normalizeRow({ ...row, status: "read", timeText: action.text });
        }
        if (row.status === "read" && action.text.trim() === "") {
          return normalizeRow({ ...row, status: "unpresented_after_stop", timeText: "" });
        }
        return { ...row, timeText: action.text };
      });

    case "setStatus":
      return replaceRow(draft, action.row, (row) =>
        row.status === action.status ? row : normalizeRow({ ...row, status: action.status }),
      );

    case "clearRow":
      return replaceRow(draft, action.row, (row) =>
        normalizeRow({
          ...row,
          status: "unpresented_after_stop",
          timeText: "",
          errorText: "",
          note: "",
        }),
      );

    case "setVariant":
      // n0 が変わるため、既に入力済みの誤り数が範囲外になりうる。値は捨てず、
      // core の検証に出させる（黙って切り詰めない）。
      return draft.variant === action.variant ? draft : { ...draft, variant: action.variant };

    case "setDistance":
      return { ...draft, distanceText: action.text };
    case "setChartVersion":
      return { ...draft, chartVersion: action.text };
    case "setSubjectId":
      return { ...draft, subjectId: action.text };
    case "setAge":
      return { ...draft, ageText: action.text };
    case "setSex":
      return { ...draft, sex: action.text };
    case "setTestDate":
      return { ...draft, testDate: action.text };
    case "setPolarity":
      return { ...draft, polarity: action.polarity };
    case "setEye":
      return { ...draft, eye: action.eye };
    case "setSequenceDirection":
      return draft.sequenceDirection === action.direction
        ? draft
        : { ...draft, sequenceDirection: action.direction };
    case "togglePerRowDistance":
      return { ...draft, perRowDistance: !draft.perRowDistance };
    case "resetSession":
      return createSession(draft.variant);

    case "undo":
    case "redo":
      return draft;
  }
}
