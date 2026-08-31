/**
 * プラトー探索・CPS・MRS（Phase 2）
 *
 * 最重要の検証は、SDev 法が原典 §4 の測定例で検者の目視判定
 * （CPS = 1.1 chart logMAR、プラトー = 1.3/1.2/1.1）を再現することである。
 * 再現しないなら、アルゴリズムか SPEC §5.5.2 の裁定のどちらかが誤っている。
 */

import { describe, expect, it } from "vitest";
import { manualWorkedExample as fx } from "@mnread/fixtures";

import {
  VARIANT_SPECS,
  analyze,
  buildCurve,
  computeMrs,
  estimateExpDecay,
  estimateManual,
  estimateSdev,
  resolveItems,
  plateauBand,
  MIN_RELATIVE_SD,
  solveCps,
  solveCpsClosedForm,
} from "../src/index.js";
import type { CpsMethodId, ItemStatus, SessionInput } from "../src/index.js";

const spec = VARIANT_SPECS["MNREAD-J"];
const exp = fx.expectedFullPrecision;
const stated = fx.statedByManual;

const ALL_METHODS: readonly CpsMethodId[] = [
  "manual_visual_2002",
  "plateau_sdev_v1",
  "expdecay_80",
  "expdecay_90",
  "expdecay_95",
];

function session(overrides: Partial<SessionInput> = {}): SessionInput {
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

/** 速度だけを与えて曲線を作る補助（合成曲線用）。 */
function curveFromSpeeds(
  speeds: ReadonlyArray<number | null>,
  distanceCm = 30,
): SessionInput {
  return {
    variant: "MNREAD-J",
    chartVersion: "synthetic",
    viewingDistanceCm: distanceCm,
    polarity: "black_on_white",
    eye: "both",
    sequenceDirection: "large_to_small",
    items: speeds.map((v, i) => {
      const chartLogMAR = Math.round((1.3 - i * 0.1) * 10) / 10;
      if (v === null) {
        return {
          chartLogMAR,
          status: "unpresented_after_stop" as const,
          timeSec: null,
          errorCount: null,
          viewingDistanceCm: null,
        };
      }
      if (v === 0) {
        return {
          chartLogMAR,
          status: "attempted_unread" as const,
          timeSec: null,
          errorCount: null,
          viewingDistanceCm: null,
        };
      }
      // 誤り0として時間を逆算する: v = 1800 / t
      return {
        chartLogMAR,
        status: "read" as const,
        timeSec: 1800 / v,
        errorCount: 0,
        viewingDistanceCm: null,
      };
    }),
  };
}

describe("SDev 法 — 原典 §4 測定例の目視判定を再現する", () => {
  const items = resolveItems(session(), spec);
  const curve = buildCurve(items);
  const result = estimateSdev(curve);

  it("プラトーが 1.3 / 1.2 / 1.1 logMAR の3点になる", () => {
    expect(result.estimate.estimable).toBe(true);
    const sizes = result.plateau.map((p) => p.chartLogMAR).sort((a, b) => b - a);
    expect(sizes).toEqual([1.3, 1.2, 1.1]);
  });

  it("CPS が原典の 1.1 chart logMAR / 1.4 補正後と一致する", () => {
    expect(result.estimate.cpsChartLogMAR).toBe(stated.cpsChartLogMAR);
    expect(result.estimate.cpsCorrectedLogMAR).toBeCloseTo(exp.cpsCorrectedLogMAR, 12);
  });

  it("成立する区間は一意である（同点による恣意的な選択がない）", () => {
    // 1点でも動かせば別の区間が選ばれうる。ここでは選ばれた区間の平均が
    // 原典の MRS と一致することで、意図した区間であることを確かめる。
    const mrs = computeMrs(result.plateau, spec);
    expect(mrs.find((m) => m.method === "arithmetic")!.valueCpm).toBeCloseTo(
      exp.mrsArithmetic,
      9,
    );
  });
});

describe("SDev 法 — 選択規則と閾値の下限（SPEC §5.5.2）", () => {
  /** 速度列から曲線を作って SDev を走らせる。 */
  const cpsOf = (speeds: readonly number[]): number | null => {
    const s = curveFromSpeeds([...speeds, ...Array<null>(19 - speeds.length).fill(null)]);
    const r = estimateSdev(buildCurve(resolveItems(s, spec)));
    return r.estimate.estimable ? r.estimate.cpsChartLogMAR : null;
  };

  it("核から広げた区間が、上位2点だけの短い区間に負けない", () => {
    // 上位2点 [383, 391] は平均 387 で、区間全体の平均 379.9 より高い。
    // 「平均が最大の区間」を採ると CPS = 1.2 となり 0.6 段ぶん過大になる。
    // 実際のプラトーは 1.3〜0.6 の8点であり、CPS は 0.6 が正しい。
    const speeds = [383, 391, 340, 400, 375, 383, 367, 400, 184, 97, 46, 24, 13, 6];
    expect(cpsOf(speeds)).toBe(0.6);
  });

  it("上位2点がわずかに速いだけでは短い区間を選ばない", () => {
    const speeds = [400, 398, 372, 380, 376, 379, 381, 377, 150, 70, 30];
    expect(cpsOf(speeds)).toBe(0.6);
  });

  it("許容幅を外れた点までは伸ばさない", () => {
    // 0.6 の点はプラトー水準の許容幅を大きく下回るため、含めない。
    const speeds = [400, 398, 402, 399, 401, 397, 400, 250, 120, 60];
    expect(cpsOf(speeds)).toBe(0.7);
  });

  it("ばらつきの下限が効き、平均の 2% 未満の許容幅にはならない", () => {
    // 速度がほぼ等しい核では sd がほぼ 0 になる。下限がないと許容幅が消え、
    // わずかな揺らぎで拡張が止まる。
    const s = curveFromSpeeds([380, 380.1, 379.9, 380.05, 200, 100, ...Array<null>(13).fill(null)]);
    const curve = buildCurve(resolveItems(s, spec));
    const band = plateauBand(curve.slice(0, 2));
    expect(band.sd).toBeGreaterThanOrEqual(MIN_RELATIVE_SD * band.level - 1e-12);
    expect(band.lowerBound).toBeLessThanOrEqual(band.level * (1 - MIN_RELATIVE_SD * 1.96) + 1e-9);
    // 下限が効くので、ほぼ等速の4点はすべて同じプラトーに入る。
    const r = estimateSdev(curve);
    expect(r.plateau).toHaveLength(4);
  });

  it("有効速度点が3点以下なら推定不能", () => {
    expect(cpsOf([400, 380, 200])).toBeNull();
  });

  it("なだらかに低下する曲線で、許容幅を広げすぎない", () => {
    // 核 [400,400] のばらつきは下限 5% で 20 cpm。1.96SD なら下限 360.8 で
    // 340 は入らない。係数が 3 だと下限 340 となり、低下の途中まで
    // プラトーに飲み込んでしまう。CPS が 1 段ぶん小さく出る。
    expect(cpsOf([400, 400, 400, 340, 300, 260, 150, 80])).toBe(1.1);
  });

  it("欠測段をまたいでプラトーを作らない", () => {
    // 1.0 logMAR が未提示。上下の点が同速でも、間を飛び越えて
    // ひとつのプラトーとして扱ってはならない。
    const s = curveFromSpeeds([400, 400, 400, null, 400, 400, 200, 100, ...Array<null>(11).fill(null)]);
    const r = estimateSdev(buildCurve(resolveItems(s, spec)));
    expect(r.estimate.estimable).toBe(true);

    const levels = r.plateau.map((p) => p.levelIndex).sort((a, b) => a - b);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]! - levels[i - 1]!).toBe(1);
    }
    // 未提示段（levelIndex 3）を含まない
    expect(levels).not.toContain(3);
  });

  it("長さが同じ区間が2つあるとき、小さい文字側の区間を採る", () => {
    // 外れ値がプラトーを2つに割り、[1.3..1.1] と [0.9..0.7] がどちらも
    // 3点・平均400で成立する。長さでも平均でも決着しないため、
    // 「最大読書速度で読める最小の文字サイズ」という定義に従って
    // 小さい側を採らなければならない。
    const speeds = [400, 400, 400, 150, 400, 400, 400, 170, 90, 45];
    expect(cpsOf(speeds)).toBe(0.7);
  });

  /* ---- 単一の高い外れ値（OPEN-8 の裁定、SPEC §5.5.2） ---- */

  it("単一の高い外れ値が核を乗っ取っても、CPS が過小にならない", () => {
    // 1.0 logMAR だけが 722 cpm。核は「平均が最大の隣接2点」なので必ず
    // 外れ値を含む組になる。除外がないと帯の下限が 77 cpm まで落ち、
    // 190・95 cpm の点まで飲み込んで CPS = 0.4 になっていた（真値 0.6）。
    const speeds = [380, 380, 380, 722, 380, 380, 380, 380, 190, 95, 48, 24, 12, 6, 3, 0];
    expect(cpsOf(speeds)).toBe(0.6);
  });

  it("最速点の除外は帯にだけ効き、MRS はプラトー全点の平均のまま", () => {
    // 外れ値はプラトーの一員として残る。除外は「帯をどこまで下げるか」の
    // 推定にしか及ばない（SPEC §5.5.2・§5.5.3）。
    const s = curveFromSpeeds([380, 380, 380, 722, 380, 380, 380, 380, 190, 95, 48, 24, 12, 6, 3, 0, null, null, null]);
    const r = estimateSdev(buildCurve(resolveItems(s, spec)));
    expect(r.plateau).toHaveLength(8);
    expect(r.plateau.map((p) => p.speedCpm)).toContain(722);

    const speeds = r.plateau.map((p) => p.speedCpm);
    const mrs = computeMrs(r.plateau, spec).find((m) => m.method === "arithmetic")!;
    expect(mrs.valueCpm).toBeCloseTo(
      speeds.reduce((a, b) => a + b, 0) / speeds.length,
      9,
    );
    // 帯の水準は最速点を抜いた側なので、MRS より低い
    expect(plateauBand(r.plateau).level).toBeLessThan(mrs.valueCpm!);
  });

  it("遅い点は落とさない（プラトーのばらつきが実際に大きいことの証拠）", () => {
    // 落とすのは最速側だけ。両側を落とすと、下振れを無視した狭い帯になる。
    const s = curveFromSpeeds([400, 400, 400, 300, 150, 70, ...Array<null>(13).fill(null)]);
    const curve = buildCurve(resolveItems(s, spec));
    const band = plateauBand(curve.slice(0, 4)); // 400/400/400/300
    // 最速の 400 を1つ落とした {400,400,300} の統計になっている
    expect(band.level).toBeCloseTo((400 + 400 + 300) / 3, 9);
    expect(band.sd).toBeGreaterThan(MIN_RELATIVE_SD * band.level);
  });

  it("3点の区間では除外しない — 下限の根拠になっている原典の計算を残す", () => {
    // 原典 §4 測定例のプラトーは3点。sd 22.07 が下限 20.60 を上回って効いている。
    // ここで1点落とすと残り2点の sd は 6.9 になり、下限が常に効くようになる。
    const plateau = estimateSdev(buildCurve(resolveItems(session(), spec))).plateau;
    expect(plateau).toHaveLength(3);
    const band = plateauBand(plateau);
    expect(band.level).toBeCloseTo(exp.mrsArithmetic, 9); // 3点なので水準 = MRS
    expect(band.sd).toBeCloseTo(22.0683, 3);
    expect(band.sd).toBeGreaterThan(MIN_RELATIVE_SD * band.level);
  });

  it("帯の再推定が巡回する曲線では値を出さない（不動点でなければ推定不能）", () => {
    // 低下がまったくない曲線。広い区間と狭い区間が交互に現れて止まらない。
    // 「10回目にたまたま居た区間」を返すと反復回数が定義に混じる。
    const flat = [403, 384, 405, 397, 397, 401, 368, 345, 389, 402, 379, 403, 359, 385, 361, 388, 414, 386, 368];
    const r = estimateSdev(buildCurve(resolveItems(curveFromSpeeds(flat), spec)));
    expect(r.estimate.estimable).toBe(false);
    expect(r.estimate.notEstimableReason).toContain("収束しない");
    expect(r.estimate.cpsCorrectedLogMAR).toBeNull();
  });

  it("選択されたプラトーの外側に隣接する点は許容幅の外にある", () => {
    // 拡張が「許容幅を外れたところで止まる」ことを、選ばれた区間そのもので確認する。
    const cases = [
      [383, 391, 340, 400, 375, 383, 367, 400, 184, 97, 46, 24],
      [400, 398, 402, 399, 401, 397, 400, 250, 120, 60],
      [420, 405, 398, 402, 300, 150, 70, 30],
    ];
    for (const speeds of cases) {
      const s = curveFromSpeeds([...speeds, ...Array<null>(19 - speeds.length).fill(null)]);
      const curve = buildCurve(resolveItems(s, spec));
      const r = estimateSdev(curve);
      expect(r.estimate.estimable).toBe(true);

      const t = plateauBand(r.plateau).lowerBound;
      const inPlateau = new Set(r.plateau.map((p) => p.itemIndex));
      const levels = r.plateau.map((p) => p.levelIndex);
      const lo = Math.min(...levels);
      const hi = Math.max(...levels);

      for (const p of curve) {
        if (inPlateau.has(p.itemIndex)) continue;
        // 区間の直上・直下に隣接する点は、必ず閾値を下回っていること。
        if (p.levelIndex === lo - 1 || p.levelIndex === hi + 1) {
          expect(p.speedCpm, `logMAR ${p.chartLogMAR} が許容下限 ${t} を下回っていない`).toBeLessThan(t);
        }
      }
    }
  });
});

describe("MRS 3方式 — 原典 §4.4", () => {
  const items = resolveItems(session(), spec);
  const curve = buildCurve(items);
  const plateau = estimateSdev(curve).plateau;
  const mrs = computeMrs(plateau, spec);
  const get = (m: string) => mrs.find((r) => r.method === m)!;

  it("算術平均が標準値として一致する", () => {
    expect(get("arithmetic").valueCpm).toBeCloseTo(exp.mrsArithmetic, 9);
    expect(get("arithmetic").n).toBe(exp.mrsN);
    expect(get("arithmetic").sdCpm).toBeCloseTo(exp.mrsSdCpm, 9);
  });

  it("pooled と平均時間方式が一致する（プラトー内の誤りが 0 のため）", () => {
    expect(get("pooled").valueCpm).toBeCloseTo(exp.mrsPooled, 9);
    expect(get("legacy_mean_time").valueCpm).toBeCloseTo(exp.mrsLegacyMeanTime, 9);
  });

  it("原典の表示値 411 cpm を再現する", () => {
    expect(Math.round(get("legacy_mean_time").valueCpm!)).toBe(stated.mrsCpm);
  });

  it("プラトーに誤りのある点が混ざると平均時間方式は null を返す", () => {
    const withError = session({
      items: session().items.map((it) =>
        it.chartLogMAR === 1.2 ? { ...it, errorCount: 3 } : it,
      ),
    });
    const p = estimateSdev(buildCurve(resolveItems(withError, spec))).plateau;
    const m = computeMrs(p, spec);
    expect(m.find((r) => r.method === "legacy_mean_time")!.valueCpm).toBeNull();
    expect(
      m.find((r) => r.method === "legacy_mean_time")!.notApplicableReason,
    ).toContain("誤り0");
    // 算術平均と pooled は算出できる。
    expect(m.find((r) => r.method === "arithmetic")!.valueCpm).not.toBeNull();
    expect(m.find((r) => r.method === "pooled")!.valueCpm).not.toBeNull();
  });

  it("誤りを含むとき pooled と算術平均は一致しない", () => {
    const withError = session({
      items: session().items.map((it) =>
        it.chartLogMAR === 1.2 ? { ...it, errorCount: 6 } : it,
      ),
    });
    const p = estimateSdev(buildCurve(resolveItems(withError, spec))).plateau;
    const m = computeMrs(p, spec);
    const a = m.find((r) => r.method === "arithmetic")!.valueCpm!;
    const pooled = m.find((r) => r.method === "pooled")!.valueCpm!;
    expect(Math.abs(a - pooled)).toBeGreaterThan(1e-6);
  });
});

describe("目視判定（manual_visual_2002）", () => {
  const items = resolveItems(session(), spec);
  const curve = buildCurve(items);

  it("検者の選択をそのまま採用する", () => {
    const selection = {
      plateauItemIndices: [0, 1, 2],
      excludedItemIndices: [],
      exclusionReasons: {},
    };
    const r = estimateManual(curve, selection);
    expect(r.estimate.estimable).toBe(true);
    expect(r.estimate.cpsChartLogMAR).toBe(1.1);
    expect(r.plateau.map((p) => p.chartLogMAR)).toEqual([1.3, 1.2, 1.1]);
  });

  it("選択がなければ推定不能（自動値で代替しない）", () => {
    const r = estimateManual(curve, null);
    expect(r.estimate.estimable).toBe(false);
    expect(r.estimate.cpsCorrectedLogMAR).toBeNull();
  });

  it("除外指定した点はプラトーから外れる", () => {
    const r = estimateManual(curve, {
      plateauItemIndices: [0, 1, 2],
      excludedItemIndices: [1],
      exclusionReasons: { 1: "計測やり直し" },
    });
    expect(r.plateau.map((p) => p.chartLogMAR)).toEqual([1.3, 1.1]);
  });

  it("曲線上にない点を選ぶと推定不能として拒否する", () => {
    // インデックス 9 は unpresented_after_stop（欠測）。
    const r = estimateManual(curve, {
      plateauItemIndices: [0, 1, 9],
      excludedItemIndices: [],
      exclusionReasons: {},
    });
    expect(r.estimate.estimable).toBe(false);
    expect(r.estimate.notEstimableReason).toContain("曲線上に存在しない");
  });
});

describe("指数減衰フィット", () => {
  const items = resolveItems(session(), spec);
  const curve = buildCurve(items);
  const r = estimateExpDecay(curve);

  it("0 cpm の点を対数回帰から除外し、件数を報告する", () => {
    const fit = r.estimates[0]!.fit!;
    expect(fit.zeroSpeedExcludedCount).toBe(1);
    expect(fit.positiveSpeedCount).toBe(8);
  });

  it("収束し、漸近 MRS が実測プラトーと同程度になる", () => {
    const fit = r.estimates.find((e) => e.method === "expdecay_90")!.fit!;
    expect(fit.converged).toBe(true);
    expect(fit.parameterAtBoundary).toBe(false);
    expect(fit.fittedMrsCpm).toBeGreaterThan(300);
    expect(fit.fittedMrsCpm).toBeLessThan(600);
  });

  it("閾値が高いほど CPS は大きい（80% ≤ 90% ≤ 95%）", () => {
    const at = (m: CpsMethodId) =>
      r.estimates.find((e) => e.method === m)!.cpsCorrectedLogMAR!;
    expect(at("expdecay_80")).toBeLessThanOrEqual(at("expdecay_90"));
    expect(at("expdecay_90")).toBeLessThanOrEqual(at("expdecay_95"));
  });

  it("二分法の解が閉形式と一致する", () => {
    // 実装は二分法。閉形式は独立な検算用（対数尺度と線形尺度の取り違え検出）。
    for (const q of [0.8, 0.9, 0.95]) {
      for (const [p1, p2, p3] of [
        [2.6, 1.2, 0.3],
        [2.0, 0.5, -0.1],
        [2.9, 2.0, 0.8],
      ]) {
        expect(solveCps(p1!, p2!, p3!, q)).toBeCloseTo(
          solveCpsClosedForm(p1!, p2!, p3!, q),
          8,
        );
      }
    }
  });

  it("正速度の点が少なすぎると推定不能", () => {
    const sparse = curveFromSpeeds([400, 380, 0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]);
    const c = buildCurve(resolveItems(sparse, spec));
    const out = estimateExpDecay(c);
    expect(out.estimates.every((e) => !e.estimable)).toBe(true);
    expect(out.estimates[0]!.notEstimableReason).toContain("正速度");
  });
});

describe("analyze() 全体", () => {
  it("原典の測定例で主要値がすべて再現される", () => {
    const out = analyze(session(), { enabledCpsMethods: ALL_METHODS });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;

    expect(r.readingAcuity!.raCorrectedLogMAR).toBeCloseTo(exp.raCorrectedLogMAR, 12);
    // 検者の判定がないので暫定的に SDev が選ばれる。
    expect(r.selection.cpsMethod).toBe("plateau_sdev_v1");
    expect(r.cpsConversion!.correctedLogMAR).toBeCloseTo(exp.cpsCorrectedLogMAR, 12);
    expect(r.cpsConversion!.mValue).toBeCloseTo(exp.cpsCorrectedMValue, 9);
    expect(r.mrs.find((m) => m.method === "arithmetic")!.valueCpm).toBeCloseTo(
      exp.mrsArithmetic,
      9,
    );
    expect(r.specVersion).toBe("0.6.3");
    expect(r.algorithmVersion).toBe("0.5.0");
  });

  it("検者の目視判定があればそちらが主値になる", () => {
    const out = analyze(session(), {
      enabledCpsMethods: ALL_METHODS,
      manualPlateau: {
        plateauItemIndices: [0, 1, 2],
        excludedItemIndices: [],
        exclusionReasons: {},
      },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.selection.cpsMethod).toBe("manual_visual_2002");
  });

  it("入力エラーがあれば部分的な結果を返さない", () => {
    const bad = session({
      items: session().items.map((it) =>
        it.chartLogMAR === 1.3 ? { ...it, errorCount: 99 } : it,
      ),
    });
    const out = analyze(bad);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.some((i) => i.code === "ERR_ERRORS_OUT_OF_RANGE")).toBe(true);
  });

  it("支援範囲は CPS 相当と余裕を分けて返す", () => {
    const out = analyze(session(), { enabledCpsMethods: ALL_METHODS });
    if (!out.ok) return;
    const s = out.result.supportRange!;
    expect(s.upperPoint).toBeGreaterThan(s.lowerPoint);
    expect(s.marginLogMAR).toBe(0.1);
    expect(s.marginRatio).toBeCloseTo(10 ** 0.1, 12);
  });
});

describe("アクセシビリティ指標", () => {
  it("非正規化のまま返し、normalized は常に null", () => {
    const out = analyze(session());
    if (!out.ok) return;
    expect(out.result.accessibility.normalized).toBeNull();
    expect(out.result.accessibility.meanSpeedCpm).not.toBeNull();
    expect(out.result.accessibility.nonStandardDistance).toBe(true);
  });

  it("対象は 1.3〜0.4 の名目10行で、未提示は 0 として扱う", () => {
    const out = analyze(session());
    if (!out.ok) return;
    const acc = out.result.accessibility;
    expect(acc.n).toBe(10);
    // 実測8行 + 0.5(0 cpm) + 0.4(未提示→0)
    const measured = exp.itemSpeedsCpm
      .filter((s) => s.chartLogMAR >= 0.6)
      .reduce((s, v) => s + v.speedCpm, 0);
    expect(acc.meanSpeedCpm).toBeCloseTo(measured / 10, 8);
  });

  it("便宜上省略した大きい文字は次の実測速度で補完する", () => {
    const s = curveFromSpeeds([300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 0, ...Array<null>(8).fill(null)]);
    const skipped: SessionInput = {
      ...s,
      items: s.items.map((it, i) =>
        i < 2
          ? {
              ...it,
              status: "skipped_large_assumed_readable" as const,
              timeSec: null,
              errorCount: null,
            }
          : it,
      ),
    };
    const out = analyze(skipped);
    if (!out.ok) return;
    expect(out.result.accessibility.n).toBe(10);
    expect(out.result.accessibility.meanSpeedCpm).toBeCloseTo(300, 8);
  });
});
