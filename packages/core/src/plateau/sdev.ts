/**
 * プラトー探索による臨界文字サイズ（`plateau_sdev_v1`）
 *
 * SPEC §5.5.2 の定義を実装する。原典に細則がないため本仕様で裁定したもの
 * （OPEN-3）。核となる隣接2点を選び、そこから許容幅の内側にある点へ連続的に
 * 広げる。核の選び方も拡張も決定的なので、結果は一意に定まる。
 *
 *   核 P0   = 平均が最大の隣接2点（同値なら小さい文字側）
 *   標本 S  = 区間の点。4点以上なら最速の1点を除く（OPEN-8 の裁定）
 *   許容幅  = 1.96 · max( sd(S),  MIN_RELATIVE_SD · mean(S) )
 *   拡張    = 核から両方向へ、mean(S) − 許容幅 以上の点が続くかぎり
 *   CPS     = 得られた区間の最小 logMAR。**不動点に達したときだけ値を出す**
 *
 * 許容幅を**患者自身のばらつき**から決めるのが要点。固定の百分率（試作の
 * 「MRS の85%」のような）にすると、プラトーが安定した人にも不安定な人にも
 * 同じ物差しを当てることになり、前者では過度に緩く、後者では過度に厳しくなる。
 *
 * ここで求める水準は帯の中心であって MRS ではない。MRS はプラトー内の全点の
 * 平均であり（SPEC §5.4）、最速点の除外は**帯の推定にしか及ばない**。
 */

import { mean, sampleSd, type CurvePoint } from "../curve.js";
import type { CpsEstimate } from "../types.js";

const METHOD = "plateau_sdev_v1" as const;

/** 1.96 は正規分布の両側5%点。文献（mnreadR / Legge 系）に由来する。 */
export const SDEV_MULTIPLIER = 1.96;

/**
 * ばらつきの下限（平均に対する比）。
 *
 * 核はわずか2点なので、そこから求めた標本 sd はプラトー全体のばらつきを
 * 過小評価しうる。たまたま近い2点が核になると許容幅が消え、拡張が早すぎる
 * 段階で止まる。
 *
 * 下限は原典の実測に合わせる。マニュアル §4 の測定例のプラトー
 * （404.49 / 436.89 / 394.74 cpm）は sd 22.07・平均 412.04 で、
 * 比にして 5.4% である。5% を「患者内のプラトーが通常示すばらつき」の
 * 下限として採る。読書時間の 0.1 秒量子化に由来する 1〜2% はこれに含まれる。
 */
export const MIN_RELATIVE_SD = 0.05;

/**
 * 最速の1点を帯の推定から外しはじめる区間の大きさ（OPEN-8 の裁定、SPEC §5.5.2）。
 *
 * 単一の高い外れ値は、水準と標本 sd の**両方**を押し上げる。帯は「水準から
 * どれだけ下まで同じプラトーとみなすか」を決めるものなので、外れ値ひとつで
 * 帯が二重に広がり、真の CPS より小さい文字まで飲み込む。合成
 * `single_high_outlier` 族で 40/40 発生していた。
 *
 * 落とすのは最速側だけである。遅い点はプラトーのばらつきが実際に大きいことの
 * 証拠であり、落とすと帯が過小になる（`single_low_outlier` 族は現行でも 40/40）。
 *
 * しきい値が 4 なのは、3点の区間から1点落とすと残り2点になり、その標本 sd は
 * ばらつきの推定として弱く、下限（5%）が常に効いてしまうため。原典 §4 の測定例の
 * プラトーはちょうど3点であり、そこでは sd 22.07 が下限 20.60 を上回って効いている。
 * **下限の根拠になっている当の計算を、除外で骨抜きにしない。**
 */
export const TRIM_MIN_POINTS = 4;

/** これ以下の有効速度点では推定しない（SPEC §5.5.4）。 */
export const MIN_VALID_POINTS = 4;

/** 帯の再推定の上限。通常は2〜3回で収束する。 */
const MAX_REFINEMENTS = 10;

export interface SdevResult {
  readonly estimate: CpsEstimate;
  readonly plateau: readonly CurvePoint[];
}

/** 核から決まるプラトー帯。 */
export interface PlateauBand {
  /** 核の平均速度（プラトー水準） */
  readonly level: number;
  /** 採用するばらつき（下限適用後） */
  readonly sd: number;
  /** この速度以上なら同じプラトーとみなす */
  readonly lowerBound: number;
}

export function plateauBand(interval: readonly CurvePoint[]): PlateauBand {
  const speeds = trimFastest(interval.map((p) => p.speedCpm));
  const level = mean(speeds);
  const sd = Math.max(sampleSd(speeds), MIN_RELATIVE_SD * level);
  return { level, sd, lowerBound: level - SDEV_MULTIPLIER * sd };
}

/** 帯の推定に用いる標本。4点以上なら最速の1点を落とす（OPEN-8）。 */
function trimFastest(speeds: readonly number[]): readonly number[] {
  if (speeds.length < TRIM_MIN_POINTS) return speeds;
  const sorted = [...speeds].sort((a, b) => a - b);
  return sorted.slice(0, -1);
}

export function estimateSdev(curve: readonly CurvePoint[]): SdevResult {
  if (curve.length <= MIN_VALID_POINTS - 1) {
    return notEstimable(
      `有効速度点が ${curve.length} 点しかない（${MIN_VALID_POINTS} 点以上が必要）`,
    );
  }

  // 大→小に整列。levelIndex はチャート段の通し番号なので、
  // 差が1でなければ間に欠測段がある。
  const points = [...curve].sort((a, b) => a.levelIndex - b.levelIndex);

  const core = selectCore(points);
  if (core === null) {
    return notEstimable("連続する2点の組が存在しない（欠測段で分断されている）");
  }

  // 帯は核から求めるが、核は2点しかなくばらつきの推定が不安定なので、
  // 得られた区間から帯を求め直して収束させる。毎回かならず核から張り直す
  // ので、区間は広がるだけでなく狭まることもある（単調増加ではない）。
  //
  // **プラトーは、この再推定の不動点として定義する。** 単調でない以上、
  // 巡回しうる（合成 `flat_no_decline` に1本ある — 低下がまったくない曲線で、
  // 広い区間と狭い区間が交互に現れる）。巡回や打ち切りのときに「10回目に
  // たまたま居た区間」を返すのは、反復回数が定義に混じるということであり、
  // 値として出してよいものではない。推定不能として目視判定に回す。
  const visited = new Set<string>([`${core.start},${core.end}`]);
  let lo = core.start;
  let hi = core.end;
  let converged = false;
  for (let iteration = 0; iteration < MAX_REFINEMENTS; iteration += 1) {
    const band = plateauBand(points.slice(lo, hi + 1));
    const next = expandFromCore(points, core, band.lowerBound);
    if (next.lo === lo && next.hi === hi) {
      converged = true;
      break;
    }
    const key = `${next.lo},${next.hi}`;
    if (visited.has(key)) break; // 巡回した
    visited.add(key);
    lo = next.lo;
    hi = next.hi;
  }
  if (!converged) {
    return notEstimable("プラトーの帯が収束しない（区間の再推定が巡回する）");
  }

  const plateau = points.slice(lo, hi + 1);
  const smallest = plateau[plateau.length - 1]!;

  return {
    estimate: {
      method: METHOD,
      estimable: true,
      notEstimableReason: null,
      cpsChartLogMAR: smallest.chartLogMAR,
      cpsCorrectedLogMAR: smallest.correctedLogMAR,
      extrapolated: false,
      plateauItemIndices: plateau.map((p) => p.itemIndex),
      fit: null,
    },
    plateau,
  };
}

/** 核から両方向へ、連続性を保ったまま許容下限の内側に広げる。 */
function expandFromCore(
  points: readonly CurvePoint[],
  core: { readonly start: number; readonly end: number },
  lowerBound: number,
): { readonly lo: number; readonly hi: number } {
  const admissible = (p: CurvePoint): boolean => p.speedCpm >= lowerBound - 1e-12;

  let lo = core.start;
  let hi = core.end;
  while (lo > 0) {
    const next = points[lo - 1]!;
    if (points[lo]!.levelIndex - next.levelIndex !== 1) break; // 欠測段はまたがない
    if (!admissible(next)) break;
    lo -= 1;
  }
  while (hi < points.length - 1) {
    const next = points[hi + 1]!;
    if (next.levelIndex - points[hi]!.levelIndex !== 1) break;
    if (!admissible(next)) break;
    hi += 1;
  }
  return { lo, hi };
}

/**
 * 核となる隣接2点を選ぶ。
 *
 * 平均が最大の組。同値なら小さい文字側を採る。臨界文字サイズは
 * 「最大読書速度で読める**最小**の文字サイズ」（原典 §3.2）であり、
 * 平坦なプラトーでは小さい側を核にしたほうが定義に沿う。
 */
function selectCore(
  points: readonly CurvePoint[],
): { readonly start: number; readonly end: number } | null {
  let best: { start: number; end: number; value: number } | null = null;

  for (let i = 0; i + 1 < points.length; i += 1) {
    if (points[i + 1]!.levelIndex - points[i]!.levelIndex !== 1) continue;
    const value = (points[i]!.speedCpm + points[i + 1]!.speedCpm) / 2;
    // 同値のときも更新する（配列は大→小なので、後方＝小さい文字側が残る）
    if (best === null) {
      best = { start: i, end: i + 1, value };
    } else if (value >= best.value - 1e-12) {
      best = { start: i, end: i + 1, value: Math.max(value, best.value) };
    }
  }

  return best === null ? null : { start: best.start, end: best.end };
}

function notEstimable(reason: string): SdevResult {
  return {
    estimate: {
      method: METHOD,
      estimable: false,
      notEstimableReason: reason,
      cpsChartLogMAR: null,
      cpsCorrectedLogMAR: null,
      extrapolated: false,
      plateauItemIndices: [],
      fit: null,
    },
    plateau: [],
  };
}
