/**
 * `plateau_sdev_v1` と Legge (2007) 法（オラクル）の照合（OPEN-3 / Phase 5）
 *
 * **一致を要求するテストではない。** mnreadR は照合対象であって裁定者ではなく
 * （ADR-0014）、両者の一致は目的ではない。ここで固定するのは次の2種類だけ:
 *
 *   1. オラクルが正しく実装できているか（原典測定例での既知の値）
 *   2. 裁定済みの差異が、裁定どおりの形で現れているか
 *
 * 差異の網羅的な測定は `pnpm --filter @mnread/core diff:mnreadr`、
 * 一件ずつの裁定は `docs/mnreadr-comparison.md` にある。
 */

import { describe, expect, it } from "vitest";
import { manualWorkedExample as fx } from "@mnread/fixtures";

import { buildCurve, estimateSdev, resolveItems, VARIANT_SPECS } from "../src/index.js";
import type { ItemStatus, SessionInput } from "../src/index.js";
import { estimateMansfield } from "./oracle/mansfield.js";

const spec = VARIANT_SPECS["MNREAD-J"];
const exp = fx.expectedFullPrecision;

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

const curve = buildCurve(resolveItems(session, spec));
const oracle = estimateMansfield(curve);
const ours = estimateSdev(curve);

describe("オラクルの妥当性（原典測定例の既知の値を返すか）", () => {
  it("推定できる", () => {
    expect(oracle.estimable).toBe(true);
  });

  it("CPS がチャート表示で 1.1 logMAR", () => {
    expect(oracle.cpsChartLogMAR).toBeCloseTo(1.1, 10);
  });

  it("CPS が距離補正後 1.4010… logMAR", () => {
    expect(oracle.cpsCorrectedLogMAR).toBeCloseTo(exp.cpsCorrectedLogMAR, 10);
  });

  it("プラトーが 1.3 / 1.2 / 1.1 の3点", () => {
    expect(oracle.plateau.map((p) => p.chartLogMAR).sort((a, b) => b - a)).toEqual(
      [1.3, 1.2, 1.1],
    );
  });

  it("MRS が線形平均 412.04… cpm（＝本仕様の mrsArithmetic と同値）", () => {
    expect(oracle.mrsCpm).toBeCloseTo(exp.mrsArithmetic, 10);
  });

  it("0 cpm の 0.5 logMAR を1点落としている", () => {
    // 本プロジェクトは 0 cpm を曲線に載せる（ADR-0002）。オラクルは
    // mnreadR と同じく解析前に落とす。この差が記録されること自体を固定する。
    expect(oracle.droppedZeroSpeedCount).toBe(1);
  });
});

describe("裁定済みの差異が裁定どおり現れる", () => {
  it("CPS は一致する — 原典の目視判定 1.1 logMAR に両者とも合致", () => {
    expect(ours.estimate.estimable).toBe(true);
    expect(ours.estimate.cpsCorrectedLogMAR).toBeCloseTo(
      oracle.cpsCorrectedLogMAR!,
      10,
    );
  });

  it("プラトーの点集合が一致する", () => {
    const a = ours.plateau.map((p) => p.chartLogMAR).sort((x, y) => x - y);
    const b = oracle.plateau.map((p) => p.chartLogMAR).sort((x, y) => x - y);
    expect(a).toEqual(b);
  });

  it("MRS はオラクルが原典の記載値と食い違う（ADR-0005 の分岐）", () => {
    // オラクル（＝mnreadR）は算術平均側に立つ。原典マニュアルが本文に
    // 書いた値は 411 であり、算術平均の 412 ではない。本仕様が3方式を
    // 併記して片側に寄せないのは、まさにこの食い違いのためである。
    expect(Math.round(oracle.mrsCpm!)).toBe(412);
    expect(fx.statedByManual.mrsCpm).toBe(411);
    expect(Math.round(exp.mrsPooled)).toBe(411);
  });
});
