/**
 * 照合用オラクル — Legge (2007) のプラトー探索アルゴリズム
 *
 * `plateau_sdev_v1`（SPEC §5.5.2）との差異を測るための**比較対象**であり、
 * 本プロジェクトの実装ではない。`src/` には置かず `index.ts` からも出さない。
 * 製品に入らないことを配置で示す（ADR-0014）。
 *
 * ## 出所
 *
 * アルゴリズムは Legge, G.E. (2007) *Psychophysics of Reading in Normal and
 * Low Vision*, 第5章。R パッケージ `mnreadR` 2.1.7（GPL-2, Calabrèse /
 * Mansfield / Legge）の `R/mansfield_algorithm_2021.R` が同章の実装であり、
 * その docstring が散文で次のように記述している:
 *
 * > A plateau is defined as a range of print sizes that supports reading speed
 * > at a significantly faster rate than the print sizes smaller or larger than
 * > the plateau range. Concretely, the plateau is determined as print sizes
 * > which reading speed is at least 1.96 SD faster than the other print sizes.
 * > The Maximum Reading Speed is estimated as the mean reading speed for print
 * > sizes included in the plateau. The Critical Print Size is defined as the
 * > smallest print size on the plateau.
 *
 * **本ファイルはこの記述から起こしたものであり、R コードの逐条移植ではない。**
 * `verify-transcription.mjs` が core を import しないのと同じ理由による —
 * 移植すると mnreadR の実装バグごと取り込むことになり、測っているのが
 * 「アルゴリズムとの差」なのか「バグとの差」なのか区別できなくなる。
 * `NEWS.md` は 1.2.0 / 2.1.1 / 2.1.5→2.1.6 の major bug を自ら記録している。
 *
 * ## 実装挙動の分岐
 *
 * 記述だけでは決まらない点は mnreadR の実挙動に合わせた。各項に出所行と、
 * `docs/mnreadr-comparison.md` の裁定分類を併記する。
 *
 *   1. 0 cpm 点を解析前に落とす  — curve_param.R:131-133 — B類（ADR-0002）
 *   2. MRS は線形速度の平均      — mansfield_algorithm_2021.R:110-113 — B類（ADR-0005）
 *      （プラトーの選択は log 空間で行うのに、報告は linear 空間である）
 *   3. 有効点 3 以下で推定不能    — 同 :75, :120 — D類
 *   4. ばらつきの下限を設けない  — `plateau_sdev_v1` の MIN_RELATIVE_SD に相当物なし — C/D類
 *
 * 窓の外が空（＝窓が全範囲）の場合、R は `max()` に空を渡して -Inf を得て
 * ガード `log(omax) != -Inf` で落とす。ここでも同じく不採用とする。
 */

import type { CurvePoint } from "../../src/curve.js";

/** 正規分布の両側5%点。`plateau_sdev_v1` の SDEV_MULTIPLIER と同値。 */
export const ORACLE_SDEV_MULTIPLIER = 1.96;

/** これ以下の有効点では推定しない（挙動3）。 */
export const ORACLE_MIN_VALID_POINTS = 4;

/** 条件を満たした窓。どれが競合したかを差異解析で見るために残す。 */
export interface AcceptedWindow {
  readonly lowerCorrectedLogMAR: number;
  readonly upperCorrectedLogMAR: number;
  readonly meanLogSpeed: number;
  readonly sdLogSpeed: number;
  readonly logOutsideMax: number;
}

export interface MansfieldResult {
  readonly estimable: boolean;
  readonly reason: string | null;
  readonly cpsCorrectedLogMAR: number | null;
  readonly cpsChartLogMAR: number | null;
  readonly plateauUpperCorrectedLogMAR: number | null;
  readonly mrsCpm: number | null;
  readonly plateau: readonly CurvePoint[];
  readonly acceptedWindows: readonly AcceptedWindow[];
  /** 挙動1 で落とした 0 cpm 点の数。差異の原因切り分けに使う。 */
  readonly droppedZeroSpeedCount: number;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** R の `sd()` と同じ標本標準偏差（分母 n−1）。 */
function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function notEstimable(reason: string, dropped: number): MansfieldResult {
  return {
    estimable: false,
    reason,
    cpsCorrectedLogMAR: null,
    cpsChartLogMAR: null,
    plateauUpperCorrectedLogMAR: null,
    mrsCpm: null,
    plateau: [],
    acceptedWindows: [],
    droppedZeroSpeedCount: dropped,
  };
}

/**
 * Legge (2007) 第5章のプラトー探索。
 *
 * 全区間 `[l, u]` を総当たりし、
 *
 *   log(窓外の最大速度) < mean(log 窓内速度) − 1.96 · sd(log 窓内速度)
 *
 * を満たす窓のうち `mean(log 窓内速度)` が最大のものを採る。CPS は窓の最小
 * logMAR、MRS は窓内の**線形**速度の平均。
 *
 * `buildCurve()` の出力（大→小の順、0 cpm を含む）をそのまま渡してよい。
 * 並べ替えと 0 cpm の除去は本関数内で行う。
 */
export function estimateMansfield(
  curve: readonly CurvePoint[],
): MansfieldResult {
  // 挙動1: 0 cpm は log を取れないため解析前に落ちる（mnreadR は log_rs が
  // -Inf の行を filter で除去する）。本プロジェクトは 0 cpm を測定事実として
  // 曲線に載せるので（ADR-0002）、ここが差異の発生源になる。数を記録する。
  const positive = curve.filter((p) => p.speedCpm > 0);
  const dropped = curve.length - positive.length;

  if (positive.length < ORACLE_MIN_VALID_POINTS) {
    return notEstimable(
      `有効速度点が ${positive.length} 点しかない（${ORACLE_MIN_VALID_POINTS} 点以上が必要）`,
      dropped,
    );
  }

  // 文字サイズの小さい順。CPS を「プラトーの最小 logMAR」として取るため、
  // 昇順であることが前提になる。
  const points = [...positive].sort(
    (a, b) => a.correctedLogMAR - b.correctedLogMAR,
  );
  const n = points.length;
  const logSpeeds = points.map((p) => Math.log(p.speedCpm));

  const accepted: AcceptedWindow[] = [];
  let bestMean = -Infinity;
  let bestLo: number | null = null;
  let bestHi: number | null = null;

  for (let l = 0; l < n - 1; l++) {
    for (let u = l + 1; u < n; u++) {
      // 窓の外の最大速度。窓が全範囲なら外は空で、この窓は採らない。
      let outsideMax = -Infinity;
      for (let i = 0; i < n; i++) {
        if (i >= l && i <= u) continue;
        if (points[i]!.speedCpm > outsideMax) outsideMax = points[i]!.speedCpm;
      }
      if (!(outsideMax > 0)) continue; // 外が空、または外が全て 0 cpm

      const win = logSpeeds.slice(l, u + 1);
      const winMean = mean(win);
      const winSd = sampleSd(win);
      if (Number.isNaN(winSd)) continue;

      const logOutsideMax = Math.log(outsideMax);
      if (logOutsideMax >= winMean - ORACLE_SDEV_MULTIPLIER * winSd) continue;

      accepted.push({
        lowerCorrectedLogMAR: points[l]!.correctedLogMAR,
        upperCorrectedLogMAR: points[u]!.correctedLogMAR,
        meanLogSpeed: winMean,
        sdLogSpeed: winSd,
        logOutsideMax,
      });

      if (winMean > bestMean) {
        bestMean = winMean;
        bestLo = l;
        bestHi = u;
      }
    }
  }

  if (bestLo === null || bestHi === null) {
    return {
      ...notEstimable("条件を満たす区間が存在しない", dropped),
      acceptedWindows: accepted,
    };
  }

  const plateau = points.slice(bestLo, bestHi + 1);
  // 挙動2: プラトーの選択は log 空間だが、MRS は線形速度の平均で返す。
  const mrsCpm = mean(plateau.map((p) => p.speedCpm));

  return {
    estimable: true,
    reason: null,
    cpsCorrectedLogMAR: points[bestLo]!.correctedLogMAR,
    cpsChartLogMAR: points[bestLo]!.chartLogMAR,
    plateauUpperCorrectedLogMAR: points[bestHi]!.correctedLogMAR,
    mrsCpm,
    plateau,
    acceptedWindows: accepted,
    droppedZeroSpeedCount: dropped,
  };
}
