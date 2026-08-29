/**
 * 判読ゾーンと判定の監査記録（Phase 4）
 *
 * ゾーンは原典に規定のない本プロジェクト固有の裁定（SPEC §5.8 / ADR-0013、OPEN-7）
 * であるため、検証できるのは「裁定どおりに実装されているか」までである。境界の
 * 臨床的妥当性は Phase 5 の実測較正で見る。
 *
 * ここで押さえるのは次の4点。
 *   - 境界は RA と CPS の2点のみで、支援余裕 0.1 logMAR が混入していないこと
 *   - CPS が推定不能ならゾーンを出さないこと（数値を出せないことを数値で表現しない）
 *   - RA > CPS の退化を潰さず、フラグを立てて返すこと
 *   - 自動値と異なる判定に理由がなければ監査フラグが立つこと
 */

import { describe, expect, it } from "vitest";
import { manualWorkedExample as fx } from "@mnread/fixtures";

import {
  analyze,
  buildCurve,
  classifyZone,
  estimateSdev,
  pointSizeAtDistance,
  readingZones,
  resolveItems,
  VARIANT_SPECS,
} from "../src/index.js";
import type {
  CpsEstimate,
  ItemStatus,
  ReadingAcuityResult,
  SessionInput,
} from "../src/index.js";

const spec = VARIANT_SPECS["MNREAD-J"];
const exp = fx.expectedFullPrecision;

function workedExample(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    variant: "MNREAD-J",
    chartVersion: fx.session.chartVersion,
    viewingDistanceCm: 15,
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
    ...overrides,
  };
}

function analyzed(input: SessionInput, options = {}) {
  const out = analyze(input, options);
  if (!out.ok) throw new Error(`解析が通らなかった: ${JSON.stringify(out.issues)}`);
  return out.result;
}

/* ============================================================
   境界の位置
   ============================================================ */

describe("判読ゾーン（SPEC §5.8）", () => {
  it("境界は RA と CPS の2点のみで、3帯が隙間なく並ぶ", () => {
    const r = analyzed(workedExample());
    const zones = r.zones!;
    expect(zones).not.toBeNull();

    expect(zones.zones.map((z) => z.id)).toEqual([
      "unreadable",
      "effortful",
      "comfortable",
    ]);

    const [unreadable, effortful, comfortable] = zones.zones;

    // 不可は下に開き、快適は上に開く。
    expect(unreadable!.minCorrectedLogMAR).toBeNull();
    expect(comfortable!.maxCorrectedLogMAR).toBeNull();

    // 隣接する帯の境界は同一の値であり、隙間も重なりもない。
    expect(unreadable!.maxCorrectedLogMAR).toBe(effortful!.minCorrectedLogMAR);
    expect(effortful!.maxCorrectedLogMAR).toBe(comfortable!.minCorrectedLogMAR);

    expect(effortful!.minCorrectedLogMAR).toBeCloseTo(exp.raCorrectedLogMAR, 12);
    expect(comfortable!.minCorrectedLogMAR).toBeCloseTo(exp.cpsCorrectedLogMAR, 12);
  });

  it("支援余裕 0.1 logMAR を境界に混ぜない（ADR-0013）", () => {
    const r = analyzed(workedExample());
    const comfortable = r.zones!.zones.find((z) => z.id === "comfortable")!;

    // 快適の下端は CPS そのもの。CPS + 0.1 ではない。
    expect(comfortable.minCorrectedLogMAR).toBeCloseTo(exp.cpsCorrectedLogMAR, 12);
    expect(comfortable.minCorrectedLogMAR).not.toBeCloseTo(
      exp.cpsCorrectedLogMAR + 0.1,
      6,
    );

    // 余裕は推奨サイズ範囲として別枠に出る。
    expect(r.supportRange!.lowerPoint).toBeCloseTo(comfortable.minPoint!, 12);
    expect(r.supportRange!.upperPoint).toBeGreaterThan(r.supportRange!.lowerPoint);
    expect(r.supportRange!.marginLogMAR).toBe(0.1);
  });

  it("境界のポイントは測定距離での MNREAD-J 相当値である", () => {
    const r = analyzed(workedExample());
    const zones = r.zones!;
    expect(zones.targetDistanceCm).toBe(15);

    for (const zone of zones.zones) {
      for (const [logMAR, point] of [
        [zone.minCorrectedLogMAR, zone.minPoint],
        [zone.maxCorrectedLogMAR, zone.maxPoint],
      ] as const) {
        if (logMAR === null) {
          expect(point).toBeNull();
        } else {
          expect(point).toBeCloseTo(pointSizeAtDistance(logMAR, 15), 12);
        }
      }
    }
  });

  it("CPS の算出法 ID を伴って返る（ADR-0006）", () => {
    const r = analyzed(workedExample());
    // 検者の判定がないので暫定的に自動値が主値になる。その事実がゾーンにも残る。
    expect(r.zones!.cpsMethod).toBe("plateau_sdev_v1");
    expect(r.zones!.cpsMethod).toBe(r.selection.cpsMethod);
  });

  it("原典 §4 測定例のゾーン境界（ゴールデン）", () => {
    const r = analyzed(workedExample());
    const zones = r.zones!;

    // 15cm 測定なので距離補正は +0.30103。RA 1.0977 / CPS 1.4010 logMAR。
    expect(zones.raCorrectedLogMAR).toBeCloseTo(1.0976966623306477, 12);
    expect(zones.cpsCorrectedLogMAR).toBeCloseTo(1.4010299956639813, 12);
    expect(zones.raCensored).toBe(false);
    expect(zones.raAboveCps).toBe(false);

    // 15cm での MNREAD-J 相当ポイント。
    const effortful = zones.zones.find((z) => z.id === "effortful")!;
    expect(effortful.minPoint).toBeCloseTo(pointSizeAtDistance(1.0976966623306477, 15), 9);
    expect(effortful.maxPoint).toBeCloseTo(pointSizeAtDistance(1.4010299956639813, 15), 9);
    expect(effortful.empty).toBe(false);
  });
});

/* ============================================================
   推定不能とゾーンの不存在
   ============================================================ */

describe("ゾーンを出さない条件", () => {
  it("CPS が推定不能ならゾーンは null（数値を出せないことを数値で表現しない）", () => {
    // 有効速度点が足りない曲線。
    const input = workedExample({
      items: fx.items.map((it, i) => ({
        chartLogMAR: it.chartLogMAR,
        status: (i < 2 ? "read" : "unpresented_after_stop") as ItemStatus,
        timeSec: i < 2 ? it.timeSec : null,
        errorCount: i < 2 ? it.errorCount : null,
        viewingDistanceCm: null,
      })),
    });
    const r = analyzed(input);
    expect(r.cps.every((e) => !e.estimable)).toBe(true);
    expect(r.zones).toBeNull();
    expect(r.supportRange).toBeNull();
  });

  it("RA が算出できなければゾーンは null", () => {
    expect(readingZones(null, estimableCps(1.0), 30, 30)).toBeNull();
  });

  it("CPS 推定値が null でもゾーンは null", () => {
    expect(readingZones(acuity(0.5), null, 30, 30)).toBeNull();
  });
});

/* ============================================================
   退化（RA > CPS）
   ============================================================ */

describe("RA > CPS の退化（SPEC §5.8）", () => {
  /**
   * 大きい文字でも30文字中29文字を読み落とす例。読めた1文字あたりの速度は
   * 出るのでプラトーは立つが、RA の誤り項 +E/300 が RA を CPS より上へ押し上げる。
   */
  function degenerateSession(): SessionInput {
    const rows = [
      { chartLogMAR: 1.3, timeSec: 2, errorCount: 29 },
      { chartLogMAR: 1.2, timeSec: 2, errorCount: 29 },
      { chartLogMAR: 1.1, timeSec: 2, errorCount: 29 },
      { chartLogMAR: 1.0, timeSec: 2, errorCount: 30 },
    ];
    return {
      variant: "MNREAD-J",
      chartVersion: "test",
      viewingDistanceCm: 30,
      polarity: "black_on_white",
      eye: "both",
      sequenceDirection: "large_to_small",
      items: rows.map((r) => ({
        chartLogMAR: r.chartLogMAR,
        status: "read" as ItemStatus,
        timeSec: r.timeSec,
        errorCount: r.errorCount,
        viewingDistanceCm: null,
      })),
    };
  }

  it("値を入れ替えず、努力ゾーンを空のまま返す", () => {
    const r = analyzed(degenerateSession());
    const zones = r.zones!;

    // RA = 1.4 - 4×0.1 + 117/300 = 1.39、CPS = 1.1（30cm なので補正 0）。
    expect(zones.raCorrectedLogMAR).toBeCloseTo(1.39, 10);
    expect(zones.cpsCorrectedLogMAR).toBeCloseTo(1.1, 10);
    expect(zones.raAboveCps).toBe(true);

    const effortful = zones.zones.find((z) => z.id === "effortful")!;
    expect(effortful.empty).toBe(true);
    // 入れ替えていない。min > max のまま事実として残る。
    expect(effortful.minCorrectedLogMAR!).toBeGreaterThan(effortful.maxCorrectedLogMAR!);
  });

  it("RA_ABOVE_CPS フラグが立ち、目視確認を要求する", () => {
    const r = analyzed(degenerateSession());
    expect(r.qualityFlags).toContain("RA_ABOVE_CPS");
    expect(r.requiresReview).toBe(true);
  });

  it("退化していない曲線ではフラグが立たない", () => {
    const r = analyzed(workedExample());
    expect(r.qualityFlags).not.toContain("RA_ABOVE_CPS");
  });
});

/* ============================================================
   サイズの分類
   ============================================================ */

describe("classifyZone()", () => {
  const zones = readingZones(acuity(0.5), estimableCps(1.0), 30, 30)!;

  it("境界は下側の帯に含まれない（半開区間 [min, max)）", () => {
    expect(classifyZone(zones, 0.5)).toBe("effortful");
    expect(classifyZone(zones, 1.0)).toBe("comfortable");
  });

  it("境界の外側はそれぞれの帯に入る", () => {
    expect(classifyZone(zones, 0.49)).toBe("unreadable");
    expect(classifyZone(zones, 0.99)).toBe("effortful");
    expect(classifyZone(zones, 1.01)).toBe("comfortable");
  });
});

/* ============================================================
   判定の監査記録（SPEC §8.4）
   ============================================================ */

describe("上書きの記録", () => {
  const input = workedExample();
  const autoPlateau = estimateSdev(
    buildCurve(resolveItems(input, spec)),
  ).estimate.plateauItemIndices;

  it("自動値と同じプラトーを選んだなら上書きではない", () => {
    const r = analyzed(input, {
      manualPlateau: {
        plateauItemIndices: autoPlateau,
        excludedItemIndices: [],
        exclusionReasons: {},
      },
    });
    expect(r.selection.cpsMethod).toBe("manual_visual_2002");
    expect(r.selection.overridesAutomatic).toBe(false);
    expect(r.qualityFlags).not.toContain("OVERRIDE_REASON_MISSING");
  });

  it("異なるプラトーを選び理由がなければ OVERRIDE_REASON_MISSING", () => {
    const r = analyzed(input, {
      manualPlateau: {
        plateauItemIndices: autoPlateau.slice(0, 2),
        excludedItemIndices: [],
        exclusionReasons: {},
      },
    });
    expect(r.selection.overridesAutomatic).toBe(true);
    expect(r.selection.overrideReason).toBeNull();
    expect(r.qualityFlags).toContain("OVERRIDE_REASON_MISSING");
  });

  it("理由を記録すればフラグは消え、理由が結果に残る", () => {
    const r = analyzed(input, {
      manualPlateau: {
        plateauItemIndices: autoPlateau.slice(0, 2),
        excludedItemIndices: [],
        exclusionReasons: {},
      },
      overrideReason: "1.1 logMAR は読み直しがあり速度が過大と判断した",
    });
    expect(r.selection.overridesAutomatic).toBe(true);
    expect(r.selection.overrideReason).toBe(
      "1.1 logMAR は読み直しがあり速度が過大と判断した",
    );
    expect(r.qualityFlags).not.toContain("OVERRIDE_REASON_MISSING");
  });

  it("空白だけの理由は理由として扱わない", () => {
    const r = analyzed(input, {
      manualPlateau: {
        plateauItemIndices: autoPlateau.slice(0, 2),
        excludedItemIndices: [],
        exclusionReasons: {},
      },
      overrideReason: "   ",
    });
    expect(r.qualityFlags).toContain("OVERRIDE_REASON_MISSING");
  });

  it("目視判定がなければ上書きではない（検者はまだ何も覆していない）", () => {
    const r = analyzed(input);
    expect(r.selection.cpsMethod).toBe("plateau_sdev_v1");
    expect(r.selection.overridesAutomatic).toBe(false);
    expect(r.qualityFlags).not.toContain("OVERRIDE_REASON_MISSING");
  });
});

/* ============================================================
   全出力に必要な付随情報（SPEC §8.1）
   ============================================================ */

describe("付随情報", () => {
  it("距離補正値と RA の換算が解析結果に含まれる", () => {
    const r = analyzed(workedExample());
    expect(r.distanceCorrectionLogMAR).toBeCloseTo(exp.distanceCorrectionLogMAR, 12);
    expect(r.raConversion!.correctedLogMAR).toBeCloseTo(exp.raCorrectedLogMAR, 12);
    expect(r.raConversion!.decimalAcuity).toBeCloseTo(exp.raDecimalAcuity, 12);
  });
});

/* ---------------------------------------------------------- */

function acuity(raCorrectedLogMAR: number): ReadingAcuityResult {
  return {
    attemptedItemCount: 5,
    cumulativeErrors: 0,
    lastAttemptedChartLogMAR: raCorrectedLogMAR,
    raChartLogMAR: raCorrectedLogMAR,
    distanceCorrectionLogMAR: 0,
    raCorrectedLogMAR,
    censored: false,
    errorResolutionLogMAR: 1 / 300,
  };
}

function estimableCps(cpsCorrectedLogMAR: number): CpsEstimate {
  return {
    method: "plateau_sdev_v1",
    estimable: true,
    notEstimableReason: null,
    cpsChartLogMAR: cpsCorrectedLogMAR,
    cpsCorrectedLogMAR,
    extrapolated: false,
    plateauItemIndices: [0, 1, 2],
    fit: null,
  };
}
