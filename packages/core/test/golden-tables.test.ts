/**
 * 原典の公表表に対するゴールデンテスト。
 *
 * 期待値は `@mnread/fixtures` が保持する一次資料からの転記であり、
 * その転記自体は `pnpm verify:fixtures` が独立に検証している。
 *
 * 許容誤差は SPEC / 報告書2 に従う。本層の計算は四則演算と対数・正接だけであり、
 * 緩い許容誤差は実装の誤りを隠すため、意図的に厳しく取る。
 */

import { describe, expect, it } from "vitest";
import {
  chartPrintedValues,
  manualTableADistance,
  manualTableBDecimalAcuity,
  manualTableCSpeed,
  qaPointSize,
} from "@mnread/fixtures";

import {
  VARIANT_SPECS,
  decimalAcuity,
  distanceCorrectionLogMAR,
  distanceCorrectionMMultiplier,
  mValue,
  pointSizeAt30cm,
  readingSpeedCpm,
} from "../src/index.js";

const J = VARIANT_SPECS["MNREAD-J"];
const JK = VARIANT_SPECS["MNREAD-Jk"];
const D0 = J.standardDistanceCm;

/** 原典の表は四捨五入表示。負値は現れないため half-up で足りる。 */
const roundHalfUp = (v: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

describe("Q&A A4.3 ポイント換算表", () => {
  it.each(qaPointSize.rows)(
    "logMAR $logMAR → $pointSize pt",
    ({ logMAR, pointSize }) => {
      expect(pointSizeAt30cm(logMAR)).toBeCloseTo(pointSize, 6);
      // 原典表は9桁。相対誤差でも確認する。
      expect(Math.abs(pointSizeAt30cm(logMAR) - pointSize) / pointSize).toBeLessThan(1e-7);
    },
  );
});

describe("マニュアル表A 距離補正", () => {
  it.each(manualTableADistance.rows)(
    "$distanceCm cm → logMAR $logMAR / M×$mMultiplier",
    ({ distanceCm, logMAR, mMultiplier }) => {
      expect(roundHalfUp(distanceCorrectionLogMAR(distanceCm, D0), 2)).toBe(logMAR);
      expect(roundHalfUp(distanceCorrectionMMultiplier(distanceCm, D0), 2)).toBe(mMultiplier);
    },
  );

  it("標準距離では厳密に 0", () => {
    expect(distanceCorrectionLogMAR(30, D0)).toBe(0);
  });

  it("15cm と 60cm の補正は符号が反転し絶対値が一致する", () => {
    const near = distanceCorrectionLogMAR(15, D0);
    const far = distanceCorrectionLogMAR(60, D0);
    expect(near).toBeCloseTo(-far, 15);
    expect(near).toBeCloseTo(0.3010299956639812, 15);
  });

  it("M 補正は logMAR 補正と等価", () => {
    for (const d of [5, 12, 15, 22, 40, 75, 100]) {
      expect(10 ** distanceCorrectionLogMAR(d, D0)).toBeCloseTo(
        distanceCorrectionMMultiplier(d, D0),
        12,
      );
    }
  });
});

describe("マニュアル表B 小数視力", () => {
  it.each(manualTableBDecimalAcuity.rows)(
    "logMAR $logMAR → 視力 $decimalAcuity",
    ({ logMAR, decimalAcuity: expected }) => {
      expect(roundHalfUp(decimalAcuity(logMAR), 3)).toBe(expected);
    },
  );
});

describe("マニュアル表C 読書時間→読書速度", () => {
  it.each(manualTableCSpeed.rows)(
    "$timeSec 秒 → J $j cpm / Jk $jk cpm",
    ({ timeSec, j, jk }) => {
      expect(roundHalfUp(readingSpeedCpm(J, timeSec, 0))).toBe(j);
      expect(roundHalfUp(readingSpeedCpm(JK, timeSec, 0))).toBe(jk);
    },
  );
});

describe("チャート印刷 M size", () => {
  const tol = chartPrintedValues.tolerance.mValueRelative;

  it.each(chartPrintedValues.rows)(
    "logMAR $logMAR → 印刷 $mSize M",
    ({ logMAR, mSize }) => {
      // 印刷値は R10 優先数の2桁表記であり式の値そのものではない（最大 3.2% 乖離）。
      // 桁の整合確認にとどまる。厳密な根拠は Q&A A7 の式と §4.3 の 5M。
      expect(Math.abs(mValue(logMAR) - mSize) / mSize).toBeLessThanOrEqual(tol);
    },
  );

  it("マニュアル §4.3 の「1.1 logMAR = 5M」を 0.5% 以内で再現する", () => {
    expect(Math.abs(mValue(1.1) - 5) / 5).toBeLessThan(0.005);
  });

  it("マニュアル §1.2 の「4M ≒ 28 ポイント」を再現する", () => {
    // M = 4 となる logMAR を逆算し、そのポイント値が 28 前後になること。
    const logMARForM4 = Math.log10(4) + 0.4;
    expect(roundHalfUp(pointSizeAt30cm(logMARForM4))).toBe(28);
  });
});

describe("読書速度の基本ケース（SPEC §5.1、報告書のゴールデン）", () => {
  it("J: t=5.0, e=2 → 336 cpm", () => {
    expect(readingSpeedCpm(J, 5.0, 2)).toBeCloseTo(336, 10);
  });

  it("Jk: t=6.0, e=0 → 240 cpm", () => {
    expect(readingSpeedCpm(JK, 6.0, 0)).toBeCloseTo(240, 10);
  });

  it("J: 全文字読み損じ（e=30）は厳密に 0", () => {
    expect(readingSpeedCpm(J, 10.0, 30)).toBe(0);
  });

  it("Jk: 全文字読み損じ（e=24）は厳密に 0", () => {
    expect(readingSpeedCpm(JK, 10.0, 24)).toBe(0);
  });

  it("同じ時間・誤り数でも J と Jk で結果が異なる（定数の取り違え検出）", () => {
    expect(readingSpeedCpm(J, 5.0, 0)).not.toBe(readingSpeedCpm(JK, 5.0, 0));
    expect(readingSpeedCpm(J, 5.0, 0)).toBeCloseTo(360, 10);
    expect(readingSpeedCpm(JK, 5.0, 0)).toBeCloseTo(288, 10);
  });
});
