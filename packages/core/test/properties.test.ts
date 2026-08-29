/**
 * プロパティテスト（報告書2「Formula unit tests」）。
 *
 * 個別の値ではなく、式が満たすべき性質を検査する。
 * 定数の取り違えや符号の反転など、ゴールデン値だけでは
 * 特定の入力でしか露見しない誤りを捕まえるのが目的。
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  VARIANT_SPECS,
  computeReadingAcuity,
  correctedLogMAR,
  decimalAcuity,
  distanceCorrectionLogMAR,
  distanceCorrectionMMultiplier,
  mValue,
  pointSizeAt30cm,
  pointSizeAtDistance,
  readingAcuityClosedForm,
  readingSpeedCpm,
  resolveItems,
  supportRange,
} from "../src/index.js";
import type { ItemInput, SessionInput, Variant, VariantSpec } from "../src/index.js";

const VARIANTS: readonly Variant[] = ["MNREAD-J", "MNREAD-Jk"];

const arbVariant = fc.constantFrom(...VARIANTS);
const arbTime = fc.double({ min: 0.1, max: 600, noNaN: true, noDefaultInfinity: true });
const arbLogMAR = fc.double({ min: -0.5, max: 1.5, noNaN: true, noDefaultInfinity: true });
const arbDistance = fc.double({ min: 3, max: 200, noNaN: true, noDefaultInfinity: true });

const arbErrors = (spec: VariantSpec) =>
  fc.integer({ min: 0, max: spec.charactersPerItem });

const RUNS = { numRuns: 500 } as const;

describe("読書速度", () => {
  it("誤り数が増えれば速度は増えない", () => {
    fc.assert(
      fc.property(arbVariant, arbTime, fc.integer({ min: 0, max: 23 }), (v, t, e) => {
        const spec = VARIANT_SPECS[v];
        expect(readingSpeedCpm(spec, t, e + 1)).toBeLessThanOrEqual(
          readingSpeedCpm(spec, t, e),
        );
      }),
      RUNS,
    );
  });

  it("時間が増えれば速度は増えない", () => {
    fc.assert(
      fc.property(arbVariant, arbTime, arbTime, (v, t1, t2) => {
        const spec = VARIANT_SPECS[v];
        const [a, b] = t1 <= t2 ? [t1, t2] : [t2, t1];
        expect(readingSpeedCpm(spec, b, 0)).toBeLessThanOrEqual(
          readingSpeedCpm(spec, a, 0),
        );
      }),
      RUNS,
    );
  });

  it("速度は常に非負であり、有限である", () => {
    fc.assert(
      fc.property(arbVariant, arbTime, fc.nat(), (v, t, raw) => {
        const spec = VARIANT_SPECS[v];
        const e = raw % (spec.charactersPerItem + 1);
        const s = readingSpeedCpm(spec, t, e);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(s)).toBe(true);
      }),
      RUNS,
    );
  });

  it("定員ぶん読み損じたときだけ厳密に 0 になる", () => {
    fc.assert(
      fc.property(arbVariant, arbTime, (v, t) => {
        const spec = VARIANT_SPECS[v];
        expect(readingSpeedCpm(spec, t, spec.charactersPerItem)).toBe(0);
        expect(readingSpeedCpm(spec, t, spec.charactersPerItem - 1)).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it("時間を k 倍すると速度は 1/k 倍になる", () => {
    fc.assert(
      fc.property(
        arbVariant,
        arbTime,
        fc.double({ min: 0.2, max: 5, noNaN: true, noDefaultInfinity: true }),
        (v, t, k) => {
          const spec = VARIANT_SPECS[v];
          const a = readingSpeedCpm(spec, t, 0);
          const b = readingSpeedCpm(spec, t * k, 0);
          expect(b * k).toBeCloseTo(a, 6);
        },
      ),
      RUNS,
    );
  });
});

describe("距離補正", () => {
  it("標準距離との比が逆数なら符号が反転する", () => {
    fc.assert(
      fc.property(arbDistance, (d) => {
        const near = distanceCorrectionLogMAR(d, 30);
        const far = distanceCorrectionLogMAR((30 * 30) / d, 30);
        expect(near).toBeCloseTo(-far, 12);
      }),
      RUNS,
    );
  });

  it("補正は距離に対して単調減少（遠いほど小さい logMAR）", () => {
    fc.assert(
      fc.property(arbDistance, arbDistance, (d1, d2) => {
        const [a, b] = d1 <= d2 ? [d1, d2] : [d2, d1];
        expect(distanceCorrectionLogMAR(b, 30)).toBeLessThanOrEqual(
          distanceCorrectionLogMAR(a, 30) + 1e-12,
        );
      }),
      RUNS,
    );
  });

  it("logMAR 補正と M 倍率補正は等価", () => {
    fc.assert(
      fc.property(arbDistance, (d) => {
        expect(10 ** distanceCorrectionLogMAR(d, 30)).toBeCloseTo(
          distanceCorrectionMMultiplier(d, 30),
          10,
        );
      }),
      RUNS,
    );
  });

  it("補正後 logMAR は元の値に補正を足したもの", () => {
    fc.assert(
      fc.property(arbLogMAR, arbDistance, (l, d) => {
        expect(correctedLogMAR(l, d, 30)).toBeCloseTo(
          l + distanceCorrectionLogMAR(d, 30),
          12,
        );
      }),
      RUNS,
    );
  });
});

describe("読書視力", () => {
  it("誤りが1文字増えれば RA は悪化する（値が大きくなる）", () => {
    fc.assert(
      fc.property(
        arbVariant,
        fc.integer({ min: 1, max: 19 }),
        fc.integer({ min: 0, max: 400 }),
        (v, n, e) => {
          const spec = VARIANT_SPECS[v];
          expect(readingAcuityClosedForm(spec, n, e + 1)).toBeGreaterThan(
            readingAcuityClosedForm(spec, n, e),
          );
        },
      ),
      RUNS,
    );
  });

  it("読み材料が1つ増えれば（誤り一定なら）RA は改善する", () => {
    fc.assert(
      fc.property(
        arbVariant,
        fc.integer({ min: 1, max: 18 }),
        fc.integer({ min: 0, max: 400 }),
        (v, n, e) => {
          const spec = VARIANT_SPECS[v];
          expect(readingAcuityClosedForm(spec, n + 1, e)).toBeLessThan(
            readingAcuityClosedForm(spec, n, e),
          );
        },
      ),
      RUNS,
    );
  });

  it("全誤りの読み材料を追加しても RA は変わらない（SPEC §5.3.3）", () => {
    fc.assert(
      fc.property(
        arbVariant,
        fc.integer({ min: 1, max: 18 }),
        fc.integer({ min: 0, max: 400 }),
        (v, n, e) => {
          const spec = VARIANT_SPECS[v];
          expect(
            readingAcuityClosedForm(spec, n + 1, e + spec.charactersPerItem),
          ).toBeCloseTo(readingAcuityClosedForm(spec, n, e), 10);
        },
      ),
      RUNS,
    );
  });

  it("一般形と公式形が常に一致する", () => {
    fc.assert(
      fc.property(
        arbVariant,
        fc.integer({ min: 1, max: 19 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 19 }),
        (v, _n, rawErrors) => {
          const spec = VARIANT_SPECS[v];
          const errors = rawErrors.map((e) => Math.min(e, spec.charactersPerItem));
          const items: ItemInput[] = errors.map((e, i) => ({
            chartLogMAR: Math.round((1.3 - i * 0.1) * 10) / 10,
            status: "read" as const,
            timeSec: 5,
            errorCount: e,
            viewingDistanceCm: null,
          }));
          const s: SessionInput = {
            variant: v,
            chartVersion: "prop",
            viewingDistanceCm: 30,
            polarity: "black_on_white",
            eye: "both",
            sequenceDirection: "large_to_small",
            items,
          };
          const ra = computeReadingAcuity(resolveItems(s, spec), spec)!;
          expect(ra.raChartLogMAR).toBeCloseTo(
            readingAcuityClosedForm(spec, ra.attemptedItemCount, ra.cumulativeErrors),
            10,
          );
        },
      ),
      RUNS,
    );
  });
});

describe("単位換算", () => {
  it("小数視力は logMAR に対して単調減少", () => {
    fc.assert(
      fc.property(arbLogMAR, arbLogMAR, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(decimalAcuity(hi)).toBeLessThanOrEqual(decimalAcuity(lo));
      }),
      RUNS,
    );
  });

  it("M 値・ポイントは logMAR に対して単調増加", () => {
    fc.assert(
      fc.property(arbLogMAR, arbLogMAR, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(mValue(hi)).toBeGreaterThanOrEqual(mValue(lo));
        expect(pointSizeAt30cm(hi)).toBeGreaterThanOrEqual(pointSizeAt30cm(lo));
      }),
      RUNS,
    );
  });

  it("logMAR が 0.1 増えると M 値は約 1.259 倍（マニュアル: 約26%）", () => {
    fc.assert(
      fc.property(arbLogMAR, (l) => {
        expect(mValue(l + 0.1) / mValue(l)).toBeCloseTo(10 ** 0.1, 10);
      }),
      RUNS,
    );
  });

  it("M 値と小数視力の積は logMAR に依存しない定数", () => {
    fc.assert(
      fc.property(arbLogMAR, (l) => {
        expect(mValue(l) * decimalAcuity(l)).toBeCloseTo(10 ** -0.4, 12);
      }),
      RUNS,
    );
  });

  it("ポイントは目標距離に比例する", () => {
    fc.assert(
      fc.property(arbLogMAR, arbDistance, (l, d) => {
        expect(pointSizeAtDistance(l, d)).toBeCloseTo(
          pointSizeAt30cm(l) * (d / 30),
          9,
        );
      }),
      RUNS,
    );
  });

  it("支援範囲の上限は常に下限以上で、比は 10^margin", () => {
    fc.assert(
      fc.property(
        arbLogMAR,
        fc.double({ min: 0, max: 0.5, noNaN: true, noDefaultInfinity: true }),
        arbDistance,
        (l, margin, d) => {
          const r = supportRange(l, margin, d, 30);
          expect(r.upperPoint).toBeGreaterThanOrEqual(r.lowerPoint);
          expect(r.upperPointAtStandard).toBeGreaterThanOrEqual(r.lowerPointAtStandard);
          // 測定距離と標準距離の値は D/30 倍だけ違う（§5.7 の pt_D = pt_30 × D/30）
          expect(r.lowerPoint / r.lowerPointAtStandard).toBeCloseTo(d / 30, 10);
          expect(r.marginRatio).toBeCloseTo(10 ** margin, 12);
        },
      ),
      RUNS,
    );
  });
});

describe("状態解決", () => {
  it("曲線に含まれる読み材料は必ず速度を持ち、含まれないものと排他", () => {
    fc.assert(
      fc.property(
        arbVariant,
        fc.array(
          fc.constantFrom(
            "read",
            "attempted_unread",
            "presented_time_missing",
            "unpresented_after_stop",
            "skipped_large_assumed_readable",
            "skipped_large_unreadable",
          ),
          { minLength: 1, maxLength: 19 },
        ),
        (v, statuses) => {
          const spec = VARIANT_SPECS[v];
          const items: ItemInput[] = statuses.map((status, i) => ({
            chartLogMAR: Math.round((1.3 - i * 0.1) * 10) / 10,
            status,
            timeSec: status === "read" ? 5 : null,
            errorCount:
              status === "read" || status === "presented_time_missing" ? 1 : null,
            viewingDistanceCm: null,
          }));
          const s: SessionInput = {
            variant: v,
            chartVersion: "prop",
            viewingDistanceCm: 30,
            polarity: "black_on_white",
            eye: "both",
            sequenceDirection: "large_to_small",
            items,
          };
          for (const r of resolveItems(s, spec)) {
            if (r.includedInCurve) expect(r.speedCpm).not.toBeNull();
            if (r.speedCpm === null) expect(r.includedInCurve).toBe(false);
            if (!r.includedInAcuity) expect(r.acuityErrorContribution).toBe(0);
            expect(r.acuityErrorContribution).toBeLessThanOrEqual(
              spec.charactersPerItem,
            );
          }
        },
      ),
      RUNS,
    );
  });
});
