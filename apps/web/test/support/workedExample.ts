/**
 * 原典 §4 の測定例を、テストから使える2つの形で用意する。
 *
 *   - `enterWorkedExample()` — 検者と同じ打鍵で画面に入力する
 *   - `workedExampleSession()` — core に直接渡せる SessionInput
 *
 * 出典: references/MNREAD-J-JkMan020518.pdf 図2（p.6）、§4.0〜§4.5（pp.8-9）
 * 患者HK、31歳、両眼、15cm、MNREAD-J1-1。1.3 から 0.6 まで読み、0.5 で不読。
 */

import type { ItemInput, SessionInput } from "@mnread/core";
import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/** 図2 のスコアシートの記載そのまま。 */
const ROWS: readonly { chartLogMAR: number; timeSec: number; errorCount: number }[] = [
  { chartLogMAR: 1.3, timeSec: 4.45, errorCount: 0 },
  { chartLogMAR: 1.2, timeSec: 4.12, errorCount: 0 },
  { chartLogMAR: 1.1, timeSec: 4.56, errorCount: 0 },
  { chartLogMAR: 1.0, timeSec: 10.13, errorCount: 0 },
  { chartLogMAR: 0.9, timeSec: 9.12, errorCount: 0 },
  { chartLogMAR: 0.8, timeSec: 11.05, errorCount: 7 },
  { chartLogMAR: 0.7, timeSec: 19.43, errorCount: 23 },
  { chartLogMAR: 0.6, timeSec: 16.18, errorCount: 29 },
];

const KEYSTROKES = [
  "4.45{Enter}",
  "4.12{Enter}",
  "4.56{Enter}",
  "10.13{Enter}",
  "9.12{Enter}",
  "11.05+7{Enter}",
  "19.43+23{Enter}",
  "16.18+29{Enter}",
  "*", // 0.5 logMAR は1文字も読めなかった
].join("");

export async function enterWorkedExample(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const distance = screen.getByLabelText("視距離（cm）");
  await user.clear(distance);
  await user.type(distance, "15");

  await user.click(screen.getByLabelText("1.30 logMAR の読書時間（秒）"));
  await user.keyboard(KEYSTROKES);
}

/** 検査を打ち切った 0.4 logMAR 以下は未提示のまま。 */
export function workedExampleSession(): SessionInput {
  const items: ItemInput[] = ROWS.map((r) => ({
    chartLogMAR: r.chartLogMAR,
    status: "read",
    timeSec: r.timeSec,
    errorCount: r.errorCount,
    viewingDistanceCm: null,
  }));
  items.push({
    chartLogMAR: 0.5,
    status: "attempted_unread",
    timeSec: null,
    errorCount: null,
    viewingDistanceCm: null,
  });
  for (let logMAR = 4; logMAR >= -5; logMAR -= 1) {
    items.push({
      chartLogMAR: logMAR / 10,
      status: "unpresented_after_stop",
      timeSec: null,
      errorCount: null,
      viewingDistanceCm: null,
    });
  }

  return {
    variant: "MNREAD-J",
    chartVersion: "MNREAD-J1-1",
    viewingDistanceCm: 15,
    polarity: "black_on_white",
    eye: "both",
    sequenceDirection: "large_to_small",
    subject: { subjectId: "HK", age: 31, testDate: "2002-05-18" },
    items,
  };
}
