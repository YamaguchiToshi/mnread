/**
 * 指数減衰フィットによる臨界文字サイズ（`expdecay_80` / `_90` / `_95`）
 *
 * Cheung ら (2008) の negative exponential decay モデル。**参考値であり、
 * 臨床の主値ではない**（ADR-0006）。原典マニュアルにはないアルゴリズムである。
 *
 *   g(x) = φ1 · (1 − exp(−exp(φ2) · (x − φ3)))
 *
 *     g  : log10(読書速度)
 *     x  : 距離補正後 logMAR
 *     φ1 : 漸近的な log10 MRS
 *     φ2 : 変化率の対数（exp(φ2) が速度）
 *     φ3 : 速度が 1 cpm となる文字サイズ
 *
 * CPS_q は「読書速度が MRS の q 倍になる文字サイズ」。**線形速度に対する割合**
 * であって対数尺度上の割合ではない。取り違えを避けるため、実装は閉形式を
 * 展開せず単調区間での二分法で根を求める（閉形式はテスト側の独立な検算に使う）。
 *
 * 0 cpm の点は対数変換できないため回帰から除外し、除外件数を返す。
 * ε で置換してはならない（SPEC §5.5.3）。
 */

import type { CurvePoint } from "../curve.js";
import { levenbergMarquardt } from "../optimize.js";
import type { CpsEstimate, CpsMethodId, FitDiagnostics } from "../types.js";

export const EXPDECAY_METHOD_VERSION = "expdecay/cheung2008 lm-numeric v1";

/** 対応する閾値と算出法 ID。 */
export const EXPDECAY_THRESHOLDS: ReadonlyArray<{
  readonly method: CpsMethodId;
  readonly q: number;
}> = [
  { method: "expdecay_80", q: 0.8 },
  { method: "expdecay_90", q: 0.9 },
  { method: "expdecay_95", q: 0.95 },
];

/** 収束後にこの範囲を外れたパラメータは境界張り付きとして扱う。 */
const SANE_BOUNDS = {
  phi1: { min: 0.05, max: 4 }, // MRS で約 1.1〜10000 cpm
  phi2: { min: -6, max: 6 },
  phi3: { min: -5, max: 5 },
} as const;

const MIN_POSITIVE_POINTS = 4;

/**
 * 対数速度の残差 RMSE がこれを超えたら、適合が悪いとして推定不能にする。
 *
 * 0.1（log10）は典型残差が約1.26倍にあたる。これほど外れたモデルから CPS を
 * 出しても意味がない。指数減衰モデルは、プラトーが長く低下が急な two-limb 型の
 * 曲線には原理的に適合しない（漸近線へ緩やかに近づく形しか取れない）ため、
 * この判定は日常的に働く。Cheung ら (2008) が two-limb と指数減衰を比較した
 * のも両者が別物だからであり、適合しないことは異常ではない。
 */
const POOR_FIT_RMSE_LOG = 0.1;

export interface ExpDecayResult {
  readonly estimates: readonly CpsEstimate[];
  /** 算出法 ID ごとのプラトー点（CPS 以上の実測点）。MRS 算出に用いる */
  readonly plateaus: ReadonlyMap<CpsMethodId, readonly CurvePoint[]>;
}

export function estimateExpDecay(curve: readonly CurvePoint[]): ExpDecayResult {
  const positive = curve.filter((p) => p.speedCpm > 0);
  const zeroExcluded = curve.length - positive.length;

  if (positive.length < MIN_POSITIVE_POINTS) {
    return allNotEstimable(
      `対数回帰に使える正速度の点が ${positive.length} 点しかない（${MIN_POSITIVE_POINTS} 点以上が必要）`,
      positive.length,
      zeroExcluded,
    );
  }

  const xs = positive.map((p) => p.correctedLogMAR);
  const ys = positive.map((p) => Math.log10(p.speedCpm));

  const fit = fitBestOfStarts(xs, ys);
  if (fit === null) {
    return allNotEstimable("フィットが収束しなかった", positive.length, zeroExcluded);
  }

  const [phi1, phi2, phi3] = fit.parameters as [number, number, number];
  const fittedMrs = 10 ** phi1;
  const observedMin = Math.min(...xs);
  const observedMax = Math.max(...xs);

  const atBoundary =
    outside(phi1, SANE_BOUNDS.phi1) ||
    outside(phi2, SANE_BOUNDS.phi2) ||
    outside(phi3, SANE_BOUNDS.phi3);
  const poorFit = !Number.isFinite(fit.rmse) || fit.rmse > POOR_FIT_RMSE_LOG;

  const estimates: CpsEstimate[] = [];
  const plateaus = new Map<CpsMethodId, readonly CurvePoint[]>();

  for (const { method, q } of EXPDECAY_THRESHOLDS) {
    const cps = solveCps(phi1, phi2, phi3, q);

    if (cps === null || !Number.isFinite(cps)) {
      estimates.push(
        base(method, {
          estimable: false,
          notEstimableReason: `MRS の ${Math.round(q * 100)}% に達する文字サイズを解けなかった`,
          fit: diagnostics(fit, positive.length, zeroExcluded, fittedMrs, atBoundary, false, false),
        }),
      );
      plateaus.set(method, []);
      continue;
    }

    const extrapolated = cps < observedMin || cps > observedMax;
    const plateau = curve.filter((p) => p.correctedLogMAR >= cps - 1e-9);
    const belowCount = curve.filter((p) => p.correctedLogMAR < cps).length;

    estimates.push(
      base(method, {
        estimable: !atBoundary && !poorFit && fit.converged,
        notEstimableReason: atBoundary
          ? "パラメータが妥当な範囲の外で収束した"
          : poorFit
            ? `対数速度の残差 RMSE が ${fit.rmse.toFixed(3)} と大きく、モデルが曲線に適合していない`
            : fit.converged
              ? null
              : "フィットが収束しなかった",
        cpsCorrectedLogMAR: cps,
        // フィットは補正後 logMAR 上で行うため、チャート表示値へは戻さない。
        cpsChartLogMAR: null,
        extrapolated,
        plateauItemIndices: plateau.map((p) => p.itemIndex),
        fit: diagnostics(
          fit,
          positive.length,
          zeroExcluded,
          fittedMrs,
          atBoundary,
          plateau.length >= 2,
          belowCount >= 1,
        ),
      }),
    );
    plateaus.set(method, plateau);
  }

  return { estimates, plateaus };
}

/**
 * g(x) = φ1 (1 − exp(−exp(φ2)(x − φ3)))
 */
export function expDecayLogSpeed(
  x: number,
  params: readonly number[],
): number {
  const [phi1, phi2, phi3] = params as [number, number, number];
  return phi1 * (1 - Math.exp(-Math.exp(phi2) * (x - phi3)));
}

/**
 * 読書速度が漸近値の q 倍となる x を二分法で求める。
 *
 * g は x について単調増加なので、括る区間さえ取れれば一意に決まる。
 */
export function solveCps(
  phi1: number,
  phi2: number,
  phi3: number,
  q: number,
): number | null {
  if (!(q > 0 && q < 1)) return null;
  if (!Number.isFinite(phi1) || phi1 <= 0) return null;

  const target = phi1 + Math.log10(q);
  const f = (x: number): number => expDecayLogSpeed(x, [phi1, phi2, phi3]) - target;

  let lo = phi3;
  let hi = phi3 + 1;
  let guard = 0;
  while (f(hi) < 0 && guard < 200) {
    hi += 1;
    guard += 1;
  }
  if (f(hi) < 0) return null;
  if (f(lo) > 0) {
    // φ3 の時点で既に目標を超えている（q が極端に小さい場合）。下方へ広げる。
    let g2 = 0;
    while (f(lo) > 0 && g2 < 200) {
      lo -= 1;
      g2 += 1;
    }
    if (f(lo) > 0) return null;
  }

  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

/**
 * 閉形式の解。実装には用いず、テストで二分法の結果を独立に検算するために公開する。
 *
 *   x = φ3 − ln( −log10(q) / φ1 ) / exp(φ2)
 */
export function solveCpsClosedForm(
  phi1: number,
  phi2: number,
  phi3: number,
  q: number,
): number {
  return phi3 - Math.log(-Math.log10(q) / phi1) / Math.exp(phi2);
}

/* ---------------------------------------------------------- */

function fitBestOfStarts(
  xs: readonly number[],
  ys: readonly number[],
): ReturnType<typeof levenbergMarquardt> | null {
  const maxY = Math.max(...ys);
  const minX = Math.min(...xs);

  // 初期値を変えて複数回走らせ、SSE が最小のものを採る。
  // 単一初期値だと曲線の形によって局所解に落ちるため。
  const starts: number[][] = [];
  for (const phi1 of [maxY, maxY + 0.1]) {
    for (const phi2 of [0.5, 1.2, 2.0]) {
      for (const phi3 of [minX - 0.2, minX - 0.05]) {
        starts.push([phi1, phi2, phi3]);
      }
    }
  }

  let best: ReturnType<typeof levenbergMarquardt> | null = null;
  for (const start of starts) {
    const result = levenbergMarquardt(xs, ys, start, expDecayLogSpeed);
    if (!Number.isFinite(result.sse)) continue;
    if (best === null || result.sse < best.sse) best = result;
  }
  return best;
}

function outside(v: number, range: { min: number; max: number }): boolean {
  return !Number.isFinite(v) || v < range.min || v > range.max;
}

function diagnostics(
  fit: ReturnType<typeof levenbergMarquardt>,
  positiveCount: number,
  zeroExcluded: number,
  fittedMrs: number,
  atBoundary: boolean,
  plateauObserved: boolean,
  slopeObserved: boolean,
): FitDiagnostics {
  return {
    converged: fit.converged,
    positiveSpeedCount: positiveCount,
    zeroSpeedExcludedCount: zeroExcluded,
    rmseLogSpeed: fit.rmse,
    fittedMrsCpm: Number.isFinite(fittedMrs) ? fittedMrs : null,
    parameterAtBoundary: atBoundary,
    plateauObserved,
    slopeObserved,
    methodVersion: EXPDECAY_METHOD_VERSION,
  };
}

function base(
  method: CpsMethodId,
  over: Partial<CpsEstimate> & Pick<CpsEstimate, "estimable" | "notEstimableReason">,
): CpsEstimate {
  return {
    method,
    cpsChartLogMAR: null,
    cpsCorrectedLogMAR: null,
    extrapolated: false,
    plateauItemIndices: [],
    fit: null,
    ...over,
  };
}

function allNotEstimable(
  reason: string,
  positiveCount: number,
  zeroExcluded: number,
): ExpDecayResult {
  const fit: FitDiagnostics = {
    converged: false,
    positiveSpeedCount: positiveCount,
    zeroSpeedExcludedCount: zeroExcluded,
    rmseLogSpeed: null,
    fittedMrsCpm: null,
    parameterAtBoundary: false,
    plateauObserved: false,
    slopeObserved: false,
    methodVersion: EXPDECAY_METHOD_VERSION,
  };
  const plateaus = new Map<CpsMethodId, readonly CurvePoint[]>();
  const estimates = EXPDECAY_THRESHOLDS.map(({ method }) => {
    plateaus.set(method, []);
    return base(method, { estimable: false, notEstimableReason: reason, fit });
  });
  return { estimates, plateaus };
}
