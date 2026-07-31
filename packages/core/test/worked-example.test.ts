/**
 * マニュアル §4 の測定例に対するゴールデンテスト。
 *
 * 原典唯一の完全な測定例（患者HK、15cm、19行）。原典が本文中に示す表示値
 * （RA 0.8 → 補正後 1.1、CPS 1.1 → 1.4、5M → 10M、MRS 411 cpm）を、
 * 本実装のフル精度値が表示桁に丸めて再現することを確認する。
 */

import { describe, expect, it } from "vitest";
import { manualWorkedExample as fx } from "@mnread/fixtures";

import {
  VARIANT_SPECS,
  computeReadingAcuity,
  correctedLogMAR,
  decimalAcuity,
  mValue,
  readingAcuityClosedForm,
  resolveItems,
  validateSession,
} from "../src/index.js";
import type { ItemStatus, SessionInput } from "../src/index.js";

const spec = VARIANT_SPECS["MNREAD-J"];
const exp = fx.expectedFullPrecision;
const stated = fx.statedByManual;

const roundHalfUp = (v: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const session: SessionInput = {
  variant: "MNREAD-J",
  chartVersion: fx.session.chartVersion,
  viewingDistanceCm: fx.session.viewingDistanceCm,
  polarity: "black_on_white",
  eye: "both",
  sequenceDirection: "large_to_small",
  items: fx.items.map((it) => ({
    chartLogMAR: it.chartLogMAR,
    status: it.status as ItemStatus,
    timeSec: it.timeSec,
    errorCount: it.errorCount,
    viewingDistanceCm: null,
  })),
};

describe("マニュアル §4 測定例", () => {
  const issues = validateSession(session, spec);
  const items = resolveItems(session, spec);
  const ra = computeReadingAcuity(items, spec);

  it("入力検証を通過する（error なし）", () => {
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("各行の読書速度がフル精度で一致する", () => {
    for (const { chartLogMAR, speedCpm } of exp.itemSpeedsCpm) {
      const item = items.find((i) => i.chartLogMAR === chartLogMAR);
      expect(item, `logMAR ${chartLogMAR} の行が見つからない`).toBeDefined();
      expect(item!.speedCpm).toBeCloseTo(speedCpm, 10);
    }
  });

  it("0.5 logMAR は 0 cpm であって欠測ではない", () => {
    const item = items.find((i) => i.chartLogMAR === 0.5)!;
    expect(item.status).toBe("attempted_unread");
    expect(item.speedCpm).toBe(0);
    expect(item.includedInCurve).toBe(true);
  });

  it("0.4 logMAR 以下は欠測であって 0 cpm ではない", () => {
    for (const item of items.filter((i) => i.chartLogMAR <= 0.4)) {
      expect(item.status).toBe("unpresented_after_stop");
      expect(item.speedCpm).toBeNull();
      expect(item.includedInCurve).toBe(false);
      expect(item.includedInAcuity).toBe(false);
    }
  });

  it("読書視力がフル精度で一致し、原典の表示値 0.8 / 1.1 を再現する", () => {
    expect(ra).not.toBeNull();
    expect(ra!.raChartLogMAR).toBeCloseTo(exp.raChartLogMAR, 12);
    expect(ra!.distanceCorrectionLogMAR).toBeCloseTo(exp.distanceCorrectionLogMAR, 15);
    expect(ra!.raCorrectedLogMAR).toBeCloseTo(exp.raCorrectedLogMAR, 12);

    expect(roundHalfUp(ra!.raChartLogMAR, 1)).toBe(stated.raChartLogMAR);
    expect(roundHalfUp(ra!.raCorrectedLogMAR, 1)).toBe(stated.raCorrectedLogMAR);
  });

  it("読書視力の小数視力換算が原典の 0.08 を再現する", () => {
    expect(roundHalfUp(decimalAcuity(ra!.raCorrectedLogMAR), 2)).toBe(
      stated.raDecimalAcuity,
    );
  });

  it("読書視力の限界に到達しているため打ち切りではない", () => {
    expect(ra!.censored).toBe(false);
  });

  it("誤り分解能が原典の「0.003 logMAR に近い精度」と一致する", () => {
    // マニュアル §3.4: J は 30 文字なので約 0.003 logMAR、Jk は 24 文字で約 0.004。
    expect(ra!.errorResolutionLogMAR).toBeCloseTo(1 / 300, 15);
    expect(VARIANT_SPECS["MNREAD-Jk"].stepLogMAR / 24).toBeCloseTo(1 / 240, 15);
  });

  it("臨界文字サイズの距離補正が原典の 1.4 logMAR を再現する", () => {
    const cps = correctedLogMAR(stated.cpsChartLogMAR, 15, spec.standardDistanceCm);
    expect(cps).toBeCloseTo(exp.cpsCorrectedLogMAR, 12);
    expect(roundHalfUp(cps, 1)).toBe(stated.cpsCorrectedLogMAR);
    expect(roundHalfUp(decimalAcuity(cps), 2)).toBe(stated.cpsCorrectedDecimalAcuity);
  });

  it("M 値が原典の「5M → 距離補正2倍 → 10M」を再現する", () => {
    expect(mValue(stated.cpsChartLogMAR)).toBeCloseTo(stated.cpsChartMValue, 1);
    const cps = correctedLogMAR(stated.cpsChartLogMAR, 15, spec.standardDistanceCm);
    expect(mValue(cps)).toBeCloseTo(exp.cpsCorrectedMValue, 10);
    expect(roundHalfUp(mValue(cps))).toBe(stated.cpsCorrectedMValue);
  });
});

describe("RA の不変性（SPEC §5.3.3）", () => {
  /** 0.5 logMAR を attempted_unread ではなく未提示扱いにした版。 */
  const withoutUnread: SessionInput = {
    ...session,
    items: session.items.map((it) =>
      it.chartLogMAR === 0.5
        ? { ...it, status: "unpresented_after_stop" as const }
        : it,
    ),
  };

  it("全誤りの読み材料を算入してもしなくても RA は変わらない", () => {
    const a = computeReadingAcuity(resolveItems(session, spec), spec)!;
    const b = computeReadingAcuity(resolveItems(withoutUnread, spec), spec)!;

    expect(a.raChartLogMAR).toBeCloseTo(b.raChartLogMAR, 12);
    expect(a.raCorrectedLogMAR).toBeCloseTo(b.raCorrectedLogMAR, 12);

    // N と E 自体は異なる。原典 §4.5 は算入しない側（N=8, E=59）を採っている。
    expect(b.attemptedItemCount).toBe(stated.attemptedItemCount);
    expect(b.cumulativeErrors).toBe(stated.cumulativeErrors);
    expect(a.attemptedItemCount).toBe(stated.attemptedItemCount + 1);
    expect(a.cumulativeErrors).toBe(stated.cumulativeErrors + spec.charactersPerItem);
  });

  it("算入しない側は原典の計算式と厳密に一致する", () => {
    const b = computeReadingAcuity(resolveItems(withoutUnread, spec), spec)!;
    // 原典 §4.5: 1.4 - (8 x 0.1) + (59/300)
    expect(b.raChartLogMAR).toBeCloseTo(1.4 - 8 * 0.1 + 59 / 300, 12);
  });

  it("一般形と公式形が一致する（SPEC §5.3.2）", () => {
    const b = computeReadingAcuity(resolveItems(withoutUnread, spec), spec)!;
    expect(b.raChartLogMAR).toBeCloseTo(
      readingAcuityClosedForm(spec, b.attemptedItemCount, b.cumulativeErrors),
      12,
    );
  });
});
