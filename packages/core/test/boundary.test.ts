/**
 * 境界・状態ケース（報告書2 の B01〜B20）。
 *
 * B13〜B17 は曲線・CPS に関するものであり Phase 2 で扱う。
 * ここでは読み材料単位・RA・距離・検証に関わるケースを網羅する。
 */

import { describe, expect, it } from "vitest";

import {
  VARIANT_SPECS,
  computeReadingAcuity,
  distanceCorrectionLogMAR,
  hasBlockingError,
  readingSpeedCpm,
  resolveItems,
  validateSession,
} from "../src/index.js";
import type {
  ItemInput,
  ItemStatus,
  SessionInput,
  ValidationCode,
  Variant,
} from "../src/index.js";

const J = VARIANT_SPECS["MNREAD-J"];
const JK = VARIANT_SPECS["MNREAD-Jk"];

function item(
  chartLogMAR: number,
  status: ItemStatus,
  timeSec: number | null = null,
  errorCount: number | null = null,
): ItemInput {
  return { chartLogMAR, status, timeSec, errorCount, viewingDistanceCm: null };
}

function session(
  items: readonly ItemInput[],
  overrides: Partial<SessionInput> = {},
): SessionInput {
  return {
    variant: "MNREAD-J",
    chartVersion: "test",
    viewingDistanceCm: 30,
    polarity: "black_on_white",
    eye: "both",
    sequenceDirection: "large_to_small",
    items,
    ...overrides,
  };
}

const codesOf = (s: SessionInput, spec = J): ValidationCode[] =>
  validateSession(s, spec).map((i) => i.code);

describe("B01 誤り0・正の時間", () => {
  it("満点の速度を算出する", () => {
    expect(readingSpeedCpm(J, 6, 0)).toBeCloseTo(300, 12);
    expect(readingSpeedCpm(JK, 6, 0)).toBeCloseTo(240, 12);
  });
});

describe("B02 誤り数が定員と等しい", () => {
  it("厳密に 0 を返す（時間によらない）", () => {
    for (const t of [0.5, 1, 12.3, 500]) {
      expect(readingSpeedCpm(J, t, 30)).toBe(0);
      expect(readingSpeedCpm(JK, t, 24)).toBe(0);
    }
  });
});

describe("B03 誤り数が定員を超える", () => {
  it("低レベル関数は例外を送出する（黙って 0 に丸めない）", () => {
    expect(() => readingSpeedCpm(J, 5, 31)).toThrow(RangeError);
    expect(() => readingSpeedCpm(JK, 5, 25)).toThrow(RangeError);
  });

  it("検証は ERR_ERRORS_OUT_OF_RANGE を返し、解析をブロックする", () => {
    const s = session([item(1.3, "read", 5, 31)]);
    expect(codesOf(s)).toContain("ERR_ERRORS_OUT_OF_RANGE");
    expect(hasBlockingError(validateSession(s, J))).toBe(true);
  });

  it("Jk では 25 が範囲外だが J では有効", () => {
    const s = session([item(1.3, "read", 5, 25)], { variant: "MNREAD-Jk" });
    expect(codesOf(s, JK)).toContain("ERR_ERRORS_OUT_OF_RANGE");
    expect(codesOf(session([item(1.3, "read", 5, 25)]), J)).not.toContain(
      "ERR_ERRORS_OUT_OF_RANGE",
    );
  });
});

describe("B04 時間が 0 以下または非有限", () => {
  it("低レベル関数は例外を送出する", () => {
    for (const t of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => readingSpeedCpm(J, t, 0)).toThrow(RangeError);
    }
  });

  it("検証は ERR_TIME_NOT_POSITIVE を返す", () => {
    expect(codesOf(session([item(1.3, "read", 0, 0)]))).toContain(
      "ERR_TIME_NOT_POSITIVE",
    );
    expect(codesOf(session([item(1.3, "read", -5, 0)]))).toContain(
      "ERR_TIME_NOT_POSITIVE",
    );
  });
});

describe("B05 誤り数が負または非整数", () => {
  it("低レベル関数は例外を送出する", () => {
    expect(() => readingSpeedCpm(J, 5, -1)).toThrow(RangeError);
    expect(() => readingSpeedCpm(J, 5, 2.5)).toThrow(RangeError);
  });

  it("検証はそれぞれのコードを返す", () => {
    expect(codesOf(session([item(1.3, "read", 5, -1)]))).toContain(
      "ERR_ERRORS_OUT_OF_RANGE",
    );
    expect(codesOf(session([item(1.3, "read", 5, 2.5)]))).toContain(
      "ERR_ERRORS_NOT_INTEGER",
    );
  });
});

describe("B06 提示し読んだが時間が未記録", () => {
  const s = session([
    item(1.3, "read", 5, 0),
    item(1.2, "presented_time_missing", null, 3),
  ]);

  it("検証を通過する", () => {
    expect(hasBlockingError(validateSession(s, J))).toBe(false);
  });

  it("速度を捏造せず欠測とする", () => {
    const items = resolveItems(s, J);
    expect(items[1]!.speedCpm).toBeNull();
    expect(items[1]!.includedInCurve).toBe(false);
  });

  it("RA には算入し、記録された誤り数を反映する", () => {
    const items = resolveItems(s, J);
    expect(items[1]!.includedInAcuity).toBe(true);
    expect(items[1]!.acuityErrorContribution).toBe(3);
    expect(computeReadingAcuity(items, J)!.cumulativeErrors).toBe(3);
  });

  it("時間が入っている状態で presented_time_missing にすると矛盾として拒否", () => {
    const bad = session([item(1.3, "presented_time_missing", 5, 3)]);
    expect(codesOf(bad)).toContain("ERR_STATE_FIELD_MISMATCH");
  });
});

describe("B07 最小サイズを提示したが全く読めなかった", () => {
  const s = session([
    item(1.3, "read", 5, 0),
    item(1.2, "attempted_unread"),
  ]);

  it("0 cpm となり曲線に含まれる", () => {
    const items = resolveItems(s, J);
    expect(items[1]!.speedCpm).toBe(0);
    expect(items[1]!.includedInCurve).toBe(true);
  });

  it("RA に算入され、全文字を誤りとして寄与する", () => {
    const items = resolveItems(s, J);
    expect(items[1]!.acuityErrorContribution).toBe(30);
    const ra = computeReadingAcuity(items, J)!;
    expect(ra.attemptedItemCount).toBe(2);
    expect(ra.cumulativeErrors).toBe(30);
    expect(ra.censored).toBe(false);
  });
});

describe("B08 検査終了後に提示していない読み材料", () => {
  const s = session([
    item(1.3, "read", 5, 0),
    item(1.2, "attempted_unread"),
    item(1.1, "unpresented_after_stop"),
    item(1.0, "unpresented_after_stop"),
  ]);

  it("欠測であり 0 cpm ではない", () => {
    const items = resolveItems(s, J);
    expect(items[2]!.speedCpm).toBeNull();
    expect(items[3]!.speedCpm).toBeNull();
  });

  it("RA にも曲線にも算入しない", () => {
    const items = resolveItems(s, J);
    for (const i of [items[2]!, items[3]!]) {
      expect(i.includedInAcuity).toBe(false);
      expect(i.includedInCurve).toBe(false);
    }
    // L_min は 1.2（最後に試行したサイズ）であり 1.0 ではない。
    expect(computeReadingAcuity(items, J)!.lastAttemptedChartLogMAR).toBe(1.2);
  });
});

describe("B09 大きい文字を明らかに読めるとして省略", () => {
  it("RA には誤り0で算入し、速度は欠測とする（マニュアル §2.3(7)）", () => {
    const s = session([
      item(1.3, "skipped_large_assumed_readable"),
      item(1.2, "skipped_large_assumed_readable"),
      item(1.1, "read", 5, 4),
      item(1.0, "attempted_unread"),
    ]);
    const items = resolveItems(s, J);
    expect(items[0]!.includedInAcuity).toBe(true);
    expect(items[0]!.acuityErrorContribution).toBe(0);
    expect(items[0]!.speedCpm).toBeNull();
    expect(items[0]!.includedInCurve).toBe(false);

    const ra = computeReadingAcuity(items, J)!;
    expect(ra.attemptedItemCount).toBe(4);
    expect(ra.cumulativeErrors).toBe(4 + 30);
  });
});

describe("B10 大きい文字が読めない（輪状暗点等）", () => {
  it("通常の小文字側の失敗とは別の状態として保持し、0 cpm を曲線に載せる", () => {
    const s = session([
      item(1.3, "skipped_large_unreadable"),
      item(1.2, "read", 5, 0),
    ]);
    const items = resolveItems(s, J);
    expect(items[0]!.status).toBe("skipped_large_unreadable");
    expect(items[0]!.speedCpm).toBe(0);
    expect(items[0]!.includedInCurve).toBe(true);
    expect(items[0]!.acuityErrorContribution).toBe(30);
    // 小文字側の失敗（attempted_unread）と状態が区別されている。
    expect(items[0]!.status).not.toBe("attempted_unread");
  });
});

describe("B11 標準距離ちょうど", () => {
  it("補正は厳密に 0", () => {
    expect(distanceCorrectionLogMAR(30, 30)).toBe(0);
  });
});

describe("B12 近距離・遠距離", () => {
  it("15cm と 60cm で符号が反転し絶対値が一致する", () => {
    expect(distanceCorrectionLogMAR(15, 30)).toBeCloseTo(0.3010299956639812, 15);
    expect(distanceCorrectionLogMAR(60, 30)).toBeCloseTo(-0.3010299956639812, 15);
  });

  it("距離が 0 以下なら例外", () => {
    expect(() => distanceCorrectionLogMAR(0, 30)).toThrow(RangeError);
    expect(() => distanceCorrectionLogMAR(-15, 30)).toThrow(RangeError);
  });

  it("セッションの距離が不正なら検証がブロックする", () => {
    const s = session([item(1.3, "read", 5, 0)], { viewingDistanceCm: 0 });
    expect(codesOf(s)).toContain("ERR_DISTANCE_NOT_POSITIVE");
  });
});

describe("B18 同じ時間・誤り数を J と Jk に与える", () => {
  it("定員と RA 分母が別々に効く", () => {
    expect(readingSpeedCpm(J, 6, 4)).toBeCloseTo((60 * 26) / 6, 12);
    expect(readingSpeedCpm(JK, 6, 4)).toBeCloseTo((60 * 20) / 6, 12);

    const items = [item(1.3, "read", 6, 4), item(1.2, "attempted_unread")];
    const raJ = computeReadingAcuity(resolveItems(session(items), J), J)!;
    const raJk = computeReadingAcuity(
      resolveItems(session(items, { variant: "MNREAD-Jk" }), JK),
      JK,
    )!;

    // 全誤りの寄与が n0 だけ異なるため、E も RA も一致しない。
    expect(raJ.cumulativeErrors).toBe(4 + 30);
    expect(raJk.cumulativeErrors).toBe(4 + 24);
    expect(raJ.errorResolutionLogMAR).toBeCloseTo(1 / 300, 15);
    expect(raJk.errorResolutionLogMAR).toBeCloseTo(1 / 240, 15);
    expect(raJ.raChartLogMAR).not.toBeCloseTo(raJk.raChartLogMAR, 6);
  });
});

describe("B19 上位を省略して途中から開始", () => {
  it("省略した上段は正読として N に含める（マニュアル §2.3(7)）", () => {
    const s = session([
      item(1.3, "skipped_large_assumed_readable"),
      item(1.2, "skipped_large_assumed_readable"),
      item(1.1, "skipped_large_assumed_readable"),
      item(1.0, "read", 6, 0),
      item(0.9, "read", 8, 10),
      item(0.8, "attempted_unread"),
    ]);
    const ra = computeReadingAcuity(resolveItems(s, J), J)!;
    expect(ra.attemptedItemCount).toBe(6);
    expect(ra.cumulativeErrors).toBe(0 + 0 + 0 + 0 + 10 + 30);
    // 一般形: L_min(0.8) + 0.1 * 40 / 30
    expect(ra.raChartLogMAR).toBeCloseTo(0.8 + (0.1 * 40) / 30, 12);
    // 公式形: 1.4 - 0.1*6 + 40/300
    expect(ra.raChartLogMAR).toBeCloseTo(1.4 - 0.6 + 40 / 300, 12);
  });
});

describe("B20 サイズの重複・逆順", () => {
  it("重複は拒否する（黙って上書きしない）", () => {
    const s = session([item(1.3, "read", 5, 0), item(1.3, "read", 6, 0)]);
    expect(codesOf(s)).toContain("ERR_DUPLICATE_SIZE");
    expect(hasBlockingError(validateSession(s, J))).toBe(true);
  });

  it("逆順は警告のうえ解析する", () => {
    const s = session([item(1.2, "read", 5, 0), item(1.3, "read", 6, 0)]);
    const issues = validateSession(s, J);
    expect(issues.map((i) => i.code)).toContain("WARN_SEQUENCE_REVERSED");
    expect(hasBlockingError(issues)).toBe(false);
  });

  it("小→大の検査を宣言していれば警告しない", () => {
    const s = session([item(1.2, "read", 5, 0), item(1.3, "read", 6, 0)], {
      sequenceDirection: "small_to_large",
    });
    expect(codesOf(s)).not.toContain("WARN_SEQUENCE_REVERSED");
  });

  it("入力順に関わらず L_min は値で決まる", () => {
    const ascending = session(
      [item(0.9, "attempted_unread"), item(1.3, "read", 5, 0)],
      { sequenceDirection: "small_to_large" },
    );
    const ra = computeReadingAcuity(resolveItems(ascending, J), J)!;
    expect(ra.lastAttemptedChartLogMAR).toBe(0.9);
  });
});

describe("部分入力とエラーの区別", () => {
  it("未提示のみのセッションは RA を返さない（0 ではなく null）", () => {
    const s = session([
      item(1.3, "unpresented_after_stop"),
      item(1.2, "unpresented_after_stop"),
    ]);
    expect(computeReadingAcuity(resolveItems(s, J), J)).toBeNull();
  });

  it("未入力の行はエラーではない", () => {
    const s = session([item(1.3, "unpresented_after_stop")]);
    expect(hasBlockingError(validateSession(s, J))).toBe(false);
  });
});

describe("読書視力の打ち切り（SPEC §5.3.4）", () => {
  it("最小サイズで全誤りに至っていなければ censored", () => {
    const s = session([item(1.3, "read", 5, 0), item(1.2, "read", 20, 25)]);
    expect(computeReadingAcuity(resolveItems(s, J), J)!.censored).toBe(true);
  });

  it("全誤りに至っていれば censored ではない", () => {
    const s = session([item(1.3, "read", 5, 0), item(1.2, "read", 20, 30)]);
    expect(computeReadingAcuity(resolveItems(s, J), J)!.censored).toBe(false);
  });
});

describe("生理的にありえない読書時間", () => {
  it("速すぎ・遅すぎは警告するが記録は拒否しない", () => {
    const fast = validateSession(session([item(1.3, "read", 0.4, 0)]), J);
    expect(fast.map((i) => i.code)).toContain("WARN_IMPLAUSIBLE_SPEED");
    expect(hasBlockingError(fast)).toBe(false);

    const slow = validateSession(session([item(1.3, "read", 400, 0)]), J);
    expect(slow.map((i) => i.code)).toContain("WARN_IMPLAUSIBLE_SPEED");
    expect(hasBlockingError(slow)).toBe(false);
  });
});

describe("行ごとに距離が異なる場合", () => {
  it("警告のうえ、行ごとの距離で補正する", () => {
    const s = session([
      { ...item(1.3, "read", 5, 0), viewingDistanceCm: 30 },
      { ...item(1.2, "read", 5, 0), viewingDistanceCm: 15 },
    ]);
    expect(codesOf(s)).toContain("WARN_DISTANCE_VARIED");

    const items = resolveItems(s, J);
    expect(items[0]!.distanceCorrectionLogMAR).toBe(0);
    expect(items[1]!.distanceCorrectionLogMAR).toBeCloseTo(0.3010299956639812, 15);
    expect(items[1]!.correctedLogMAR).toBeCloseTo(1.2 + 0.3010299956639812, 12);
  });
});

describe("チャート種別ごとの定数", () => {
  it.each<[Variant, number, number]>([
    ["MNREAD-J", 30, 300],
    ["MNREAD-Jk", 24, 240],
  ])("%s は定員 %d・RA 分母 %d", (variant, chars, denom) => {
    const spec = VARIANT_SPECS[variant];
    expect(spec.charactersPerItem).toBe(chars);
    expect(spec.charactersPerItem / spec.stepLogMAR).toBeCloseTo(denom, 10);
    expect(spec.standardDistanceCm).toBe(30);
  });
});
