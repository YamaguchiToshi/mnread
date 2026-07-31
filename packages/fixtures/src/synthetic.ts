/**
 * 合成読書速度曲線の生成（報告書2「Synthetic curve families」）
 *
 * 潜在的な速度関数から**時間と誤り数を生成し**、アプリと同じ公開式で速度へ
 * 戻す。曲線フィッタだけでなく入力→算出の経路全体を検査するため。
 *
 * 乱数は seed 固定の自前 PRNG を用いる（`Math.random` は再現しないため）。
 * 生成物には潜在パラメータと seed を必ず含める。
 */

export type SyntheticFamily =
  | "clean_two_limb"
  | "noisy_plateau"
  | "gradual_transition"
  | "single_low_outlier"
  | "single_high_outlier"
  | "large_print_falloff"
  | "two_plateaux"
  | "truncated_small_limb"
  | "truncated_large_limb"
  | "high_error_near_threshold"
  | "heteroscedastic"
  | "sparse"
  | "quantised_timing"
  | "implausibly_fast"
  | "flat_no_decline";

/** その族で CPS を復元できることを期待するか、目視レビューを期待するか。 */
export type SyntheticExpectation = "cps_recoverable" | "review_required";

export interface SyntheticItem {
  readonly chartLogMAR: number;
  readonly status:
    | "read"
    | "attempted_unread"
    | "unpresented_after_stop"
    | "skipped_large_unreadable";
  readonly timeSec: number | null;
  readonly errorCount: number | null;
}

export interface SyntheticCurve {
  readonly family: SyntheticFamily;
  readonly seed: number;
  readonly expectation: SyntheticExpectation;
  readonly generatorVersion: string;
  /** 潜在的な真値。曲線から復元できるべき値 */
  readonly latent: {
    readonly cpsChartLogMAR: number;
    readonly mrsCpm: number;
    /** CPS より小さい側の傾き（log10 cpm / logMAR） */
    readonly slope: number;
  };
  readonly viewingDistanceCm: number;
  readonly items: readonly SyntheticItem[];
}

export const GENERATOR_VERSION = "synthetic/v1";

const CHARS_PER_ITEM = 30;

/**
 * 読書時間の上限（秒）。これを超える低速は誤り数の増加として表す。
 * 原典 §4 の測定例で最も遅い行が 19.43 秒であることに合わせている。
 */
const TIME_CAP_SEC = 20;
const LEVELS = Array.from({ length: 19 }, (_, i) => Math.round((1.3 - i * 0.1) * 10) / 10);

/** mulberry32。小さく、seed から完全に再現できる。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller による標準正規乱数。 */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** two-limb の潜在速度（cpm）。CPS 以上で一定、以下は対数線形に低下。 */
function latentSpeed(
  x: number,
  cps: number,
  mrs: number,
  slope: number,
): number {
  if (x >= cps) return mrs;
  return 10 ** (Math.log10(mrs) - slope * (cps - x));
}

interface FamilyConfig {
  readonly cps: number;
  readonly mrs: number;
  readonly slope: number;
  readonly noiseSd: number;
  readonly expectation: SyntheticExpectation;
}

const FAMILY_CONFIG: Readonly<Record<SyntheticFamily, FamilyConfig>> = {
  clean_two_limb: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0, expectation: "cps_recoverable" },
  noisy_plateau: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.04, expectation: "cps_recoverable" },
  gradual_transition: { cps: 0.6, mrs: 380, slope: 0.5, noiseSd: 0.02, expectation: "review_required" },
  single_low_outlier: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0, expectation: "review_required" },
  single_high_outlier: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0, expectation: "review_required" },
  large_print_falloff: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "review_required" },
  two_plateaux: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.01, expectation: "review_required" },
  truncated_small_limb: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "review_required" },
  truncated_large_limb: { cps: 1.2, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "review_required" },
  high_error_near_threshold: { cps: 0.6, mrs: 380, slope: 1.5, noiseSd: 0.02, expectation: "cps_recoverable" },
  heteroscedastic: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "cps_recoverable" },
  sparse: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "review_required" },
  quantised_timing: { cps: 0.6, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "cps_recoverable" },
  implausibly_fast: { cps: 0.6, mrs: 1900, slope: 3.0, noiseSd: 0.01, expectation: "review_required" },
  flat_no_decline: { cps: -0.5, mrs: 380, slope: 3.0, noiseSd: 0.02, expectation: "review_required" },
};

export function generateCurve(
  family: SyntheticFamily,
  seed: number,
): SyntheticCurve {
  const cfg = FAMILY_CONFIG[family];
  const rng = makeRng(seed);
  const items: SyntheticItem[] = [];

  let stopped = false;
  LEVELS.forEach((x, index) => {
    if (stopped) {
      items.push({ chartLogMAR: x, status: "unpresented_after_stop", timeSec: null, errorCount: null });
      return;
    }

    // 疎な曲線は1段おきに未提示
    if (family === "sparse" && index % 2 === 1) {
      items.push({ chartLogMAR: x, status: "unpresented_after_stop", timeSec: null, errorCount: null });
      return;
    }
    // 大文字側の低下: 最上段が読めない
    if (family === "large_print_falloff" && index === 0) {
      items.push({ chartLogMAR: x, status: "skipped_large_unreadable", timeSec: null, errorCount: null });
      return;
    }

    let speed = latentSpeed(x, cfg.cps, cfg.mrs, cfg.slope);

    // 族ごとの摂動
    if (family === "two_plateaux" && x >= 1.0) speed = cfg.mrs * 0.72;
    if (family === "single_low_outlier" && index === 3) speed *= 0.45;
    if (family === "single_high_outlier" && index === 3) speed *= 1.9;
    if (family === "truncated_large_limb" && x >= 1.3) speed = cfg.mrs;

    const localNoise =
      family === "heteroscedastic"
        ? cfg.noiseSd * (1 + 4 * Math.max(0, cfg.cps - x))
        : cfg.noiseSd;
    if (localNoise > 0) speed *= 10 ** (normal(rng) * localNoise);

    // 誤り数。閾値近傍で誤りが増える族は、低下を明示的に誤りで表す。
    let errors = 0;
    if (family === "high_error_near_threshold" && x < cfg.cps) {
      const ratio = Math.min(1, (cfg.cps - x) / 0.4);
      errors = Math.min(CHARS_PER_ITEM, Math.round(ratio * CHARS_PER_ITEM));
    }

    if (errors >= CHARS_PER_ITEM || speed < 3) {
      items.push({ chartLogMAR: x, status: "attempted_unread", timeSec: null, errorCount: null });
      stopped = true;
      return;
    }

    // 速度から時間へ戻す（アプリと同じ式の逆算）。
    //
    // 誤り0のまま時間だけを伸ばすと、小さい文字で数百秒という非現実的な
    // 記録になる。実際には低速は**誤りの増加**で生じる。原典 §4 の例でも
    // 0.6 logMAR は 16.18 秒・誤り29文字で 3.7 cpm であり、時間は 20 秒に
    // 満たない。時間が上限を超える場合は、その分を誤り数へ振り替える。
    let timeSec = (60 * (CHARS_PER_ITEM - errors)) / speed;
    if (timeSec > TIME_CAP_SEC) {
      errors = Math.round(CHARS_PER_ITEM - (speed * TIME_CAP_SEC) / 60);
      errors = Math.min(CHARS_PER_ITEM - 1, Math.max(0, errors));
      timeSec = (60 * (CHARS_PER_ITEM - errors)) / speed;
    }
    if (family === "quantised_timing") timeSec = Math.max(0.1, Math.round(timeSec * 10) / 10);
    if (family === "truncated_small_limb" && x <= cfg.cps - 0.1) {
      // 低下が現れる前に検査を打ち切る
      items.push({ chartLogMAR: x, status: "unpresented_after_stop", timeSec: null, errorCount: null });
      stopped = true;
      return;
    }

    items.push({
      chartLogMAR: x,
      status: "read",
      timeSec: Number(timeSec.toFixed(6)),
      errorCount: errors,
    });
  });

  return {
    family,
    seed,
    expectation: cfg.expectation,
    generatorVersion: GENERATOR_VERSION,
    latent: { cpsChartLogMAR: cfg.cps, mrsCpm: cfg.mrs, slope: cfg.slope },
    viewingDistanceCm: 30,
    items,
  };
}

export const SYNTHETIC_FAMILIES = Object.keys(FAMILY_CONFIG) as readonly SyntheticFamily[];

/** 族ごとに `count` 本、seed を決定的にずらして生成する。 */
export function generateFamily(
  family: SyntheticFamily,
  count: number,
  baseSeed = 1000,
): readonly SyntheticCurve[] {
  return Array.from({ length: count }, (_, i) =>
    generateCurve(family, baseSeed + i * 7919),
  );
}
