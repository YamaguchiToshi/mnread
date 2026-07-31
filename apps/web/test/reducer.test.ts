/**
 * 状態モデルと Undo の検証（Phase 3）
 *
 * DOM を通さず純関数として確かめる。キー操作の結果として何が起きるかは
 * scoresheet.test.tsx が見る。
 */

import { VARIANT_SPECS } from "@mnread/core";
import { describe, expect, it } from "vitest";

import { createHistory, reduce, type Action, type HistoryState } from "../src/session/reducer.js";
import {
  createSession,
  entryOrder,
  hasEnteredData,
  itemIndexToRowIndex,
  normalizeRow,
  parseField,
  toSessionInput,
} from "../src/session/state.js";

function run(actions: readonly Action[], initial = createHistory()): HistoryState {
  return actions.reduce(reduce, initial);
}

describe("初期状態", () => {
  it("19行すべてが「未提示」で始まる", () => {
    const draft = createSession();
    expect(draft.rows).toHaveLength(VARIANT_SPECS["MNREAD-J"].levelCount);
    expect(draft.rows.every((r) => r.status === "unpresented_after_stop")).toBe(true);
  });

  it("チャート段は 1.3 から -0.5 まで 0.1 刻みで、浮動小数点の誤差を持たない", () => {
    const draft = createSession();
    expect(draft.rows[0]!.chartLogMAR).toBe(1.3);
    expect(draft.rows[18]!.chartLogMAR).toBe(-0.5);
    expect(draft.rows[10]!.chartLogMAR).toBe(0.3);
  });

  it("未入力のセッションは core の検証を通る（検査中いつでも解析が成立する）", () => {
    const input = toSessionInput(createSession());
    expect(input.items).toHaveLength(19);
    expect(input.items.every((i) => i.timeSec === null && i.errorCount === null)).toBe(true);
  });

  it("未入力なら「触れていない」と判定される", () => {
    expect(hasEnteredData(createSession())).toBe(false);
  });
});

describe("テキスト → 数値", () => {
  it("空欄は null（値がない）", () => {
    expect(parseField("")).toBeNull();
    expect(parseField("   ")).toBeNull();
  });

  it("数値はそのまま", () => {
    expect(parseField("6.2")).toBe(6.2);
    expect(parseField(" 12 ")).toBe(12);
  });

  it("数値にならない文字列は NaN。0 に丸めない（ADR-0004）", () => {
    expect(parseField("あ")).toBeNaN();
    expect(parseField("6.2.3")).toBeNaN();
  });
});

describe("時間の入力と状態遷移", () => {
  it("時間を打つと行が「読んだ」になり、誤り数は既定 0 になる", () => {
    const state = run([{ type: "setCell", row: 0, field: "time", text: "6.2" }]);
    expect(state.present.rows[0]!.status).toBe("read");
    expect(state.present.rows[0]!.errorText).toBe("0");
  });

  it("時間を空にすると「未提示」に戻り、誤り数も消える", () => {
    const state = run([
      { type: "setCell", row: 0, field: "time", text: "6.2" },
      { type: "setCell", row: 0, field: "time", text: "" },
    ]);
    expect(state.present.rows[0]!.status).toBe("unpresented_after_stop");
    expect(state.present.rows[0]!.errorText).toBe("");
  });

  it("既定 0 の誤り数は上書きできる", () => {
    const state = run([
      { type: "setCell", row: 0, field: "time", text: "6.2" },
      { type: "setCell", row: 0, field: "errors", text: "3" },
    ]);
    expect(state.present.rows[0]!.errorText).toBe("3");
  });
});

describe("状態と欄の整合（SPEC §4.2）", () => {
  it("「不読」にすると時間も誤り数も持たない", () => {
    const state = run([
      { type: "setCell", row: 2, field: "time", text: "9.9" },
      { type: "setStatus", row: 2, status: "attempted_unread" },
    ]);
    const row = state.present.rows[2]!;
    expect(row.timeText).toBe("");
    expect(row.errorText).toBe("");
  });

  it("「時間未記録」は誤り数だけを持つ", () => {
    const state = run([
      { type: "setCell", row: 3, field: "time", text: "7.0" },
      { type: "setStatus", row: 3, status: "presented_time_missing" },
    ]);
    const row = state.present.rows[3]!;
    expect(row.timeText).toBe("");
    expect(row.errorText).toBe("0");
  });

  it("整合をとった行はすべて core の検証を通る", () => {
    const draft = createSession();
    for (const status of [
      "read",
      "attempted_unread",
      "presented_time_missing",
      "unpresented_after_stop",
      "skipped_large_assumed_readable",
      "skipped_large_unreadable",
    ] as const) {
      const row = normalizeRow({ ...draft.rows[0]!, status, timeText: "6.0" });
      // 「読んだ」だけが時間を持つ
      expect(row.timeText === "").toBe(status !== "read");
      // 誤り数を記録するのは「読んだ」と「時間未記録」だけ
      expect(row.errorText !== "").toBe(status === "read" || status === "presented_time_missing");
    }
  });
});

describe("実施順", () => {
  it("大→小では rows の順がそのまま items の順になる", () => {
    const draft = createSession();
    expect(entryOrder(draft)[0]).toBe(0);
    expect(toSessionInput(draft).items[0]!.chartLogMAR).toBe(1.3);
  });

  it("小→大では実施順（小さい文字が先）で items を組む", () => {
    const state = run([{ type: "setSequenceDirection", direction: "small_to_large" }]);
    const input = toSessionInput(state.present);
    expect(input.items[0]!.chartLogMAR).toBe(-0.5);
    expect(input.items[18]!.chartLogMAR).toBe(1.3);
  });

  it("小→大でも core の並び順警告は出ない（宣言と実際が一致するため）", () => {
    const state = run([{ type: "setSequenceDirection", direction: "small_to_large" }]);
    const input = toSessionInput(state.present);
    const sizes = input.items.map((i) => i.chartLogMAR);
    expect(sizes.every((v, i) => i === 0 || v >= sizes[i - 1]!)).toBe(true);
  });

  it("items の添字から行に戻せる", () => {
    const state = run([{ type: "setSequenceDirection", direction: "small_to_large" }]);
    expect(itemIndexToRowIndex(state.present, 0)).toBe(18);
    expect(itemIndexToRowIndex(state.present, 18)).toBe(0);
  });
});

describe("Undo / Redo", () => {
  it("同じ欄への連続入力は1段にまとまる", () => {
    const state = run([
      { type: "setCell", row: 0, field: "time", text: "6" },
      { type: "setCell", row: 0, field: "time", text: "6." },
      { type: "setCell", row: 0, field: "time", text: "6.2" },
    ]);
    const undone = reduce(state, { type: "undo" });
    expect(undone.present.rows[0]!.timeText).toBe("");
    expect(undone.present.rows[0]!.status).toBe("unpresented_after_stop");
  });

  it("別の行の入力は別の段になる", () => {
    const state = run([
      { type: "setCell", row: 0, field: "time", text: "6.2" },
      { type: "setCell", row: 1, field: "time", text: "5.8" },
    ]);
    const undone = reduce(state, { type: "undo" });
    expect(undone.present.rows[1]!.timeText).toBe("");
    expect(undone.present.rows[0]!.timeText).toBe("6.2");
  });

  it("状態変更は必ず独立した段になる", () => {
    const state = run([
      { type: "setCell", row: 0, field: "time", text: "6.2" },
      { type: "setStatus", row: 0, status: "attempted_unread" },
    ]);
    const undone = reduce(state, { type: "undo" });
    expect(undone.present.rows[0]!.status).toBe("read");
    expect(undone.present.rows[0]!.timeText).toBe("6.2");
  });

  it("Redo で元に戻る", () => {
    const state = run([{ type: "setCell", row: 0, field: "time", text: "6.2" }]);
    const roundTrip = reduce(reduce(state, { type: "undo" }), { type: "redo" });
    expect(roundTrip.present.rows[0]!.timeText).toBe("6.2");
  });

  it("Undo 直後の入力は取り消した段に合成されない", () => {
    const afterUndo = reduce(
      run([{ type: "setCell", row: 0, field: "time", text: "6.2" }]),
      { type: "undo" },
    );
    const retyped = reduce(afterUndo, { type: "setCell", row: 0, field: "time", text: "7" });
    expect(reduce(retyped, { type: "undo" }).present.rows[0]!.timeText).toBe("");
    expect(retyped.present.rows[0]!.timeText).toBe("7");
  });

  it("履歴がなければ Undo は何もしない", () => {
    const state = createHistory();
    expect(reduce(state, { type: "undo" })).toBe(state);
    expect(reduce(state, { type: "redo" })).toBe(state);
  });

  it("値の変わらない操作は履歴を作らない", () => {
    const state = run([{ type: "setCell", row: 0, field: "time", text: "6.2" }]);
    const same = reduce(state, { type: "setStatus", row: 0, status: "read" });
    expect(same).toBe(state);
  });
});

describe("チャート種別の変更", () => {
  it("Jk に変えても入力済みの誤り数を切り詰めない（範囲外なら core が拒否する）", () => {
    const state = run([
      { type: "setCell", row: 0, field: "time", text: "6.2" },
      { type: "setCell", row: 0, field: "errors", text: "28" },
      { type: "setVariant", variant: "MNREAD-Jk" },
    ]);
    expect(state.present.rows[0]!.errorText).toBe("28");
    expect(toSessionInput(state.present).items[0]!.errorCount).toBe(28);
  });
});
