/**
 * 読書速度曲線の共通表現（Phase 2）
 *
 * プラトー探索・曲線フィットはいずれも「測定値のある点の列」を入力に取る。
 * 欠測と 0 cpm の区別（ADR-0002）を保ったまま各アルゴリズムへ渡すため、
 * 中間表現をここに1つだけ定義する。
 */

import type { ItemResult } from "./types.js";

export interface CurvePoint {
  /** 元の items 配列でのインデックス */
  readonly itemIndex: number;
  /** チャート段の通し番号。連続性の判定に用いる */
  readonly levelIndex: number;
  readonly chartLogMAR: number;
  readonly correctedLogMAR: number;
  /** 0 を含む測定値。欠測はそもそも CurvePoint にならない */
  readonly speedCpm: number;
  readonly timeSec: number | null;
  readonly errorCount: number | null;
}

/**
 * 曲線に載る点を、文字サイズの大きい順に取り出す。
 *
 * `levelIndex` はチャート段の通し番号であり、欠測段を含めて数える。
 * SDev 法が「欠測段をまたがない」連続区間を判定するために必要
 * （SPEC §5.5.2）。
 */
export function buildCurve(items: readonly ItemResult[]): readonly CurvePoint[] {
  const ordered = [...items].sort((a, b) => b.chartLogMAR - a.chartLogMAR);

  const points: CurvePoint[] = [];
  ordered.forEach((item, levelIndex) => {
    if (!item.includedInCurve) return;
    if (item.speedCpm === null || item.correctedLogMAR === null) return;
    points.push({
      itemIndex: item.index,
      levelIndex,
      chartLogMAR: item.chartLogMAR,
      correctedLogMAR: item.correctedLogMAR,
      speedCpm: item.speedCpm,
      timeSec: item.timeSec,
      errorCount: item.errorCount,
    });
  });
  return points;
}

/**
 * 段番号を 0 から詰め直す。
 *
 * leave-one-out のように点を人工的に取り除いたとき、そのまま渡すと
 * `levelIndex` に穴が空き、連続区間の判定が構造的に分断される。
 * それは「その点の測定値が結果を左右した」こととは別の現象なので、
 * 影響度を見たいときは段を詰めて値の効果だけを取り出す。
 *
 * 実際の検査で提示しなかった段（欠測）は詰めてはならない。そちらは
 * 「またげない切れ目」であることに意味がある。
 */
export function compactLevels(points: readonly CurvePoint[]): readonly CurvePoint[] {
  return [...points]
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .map((p, i) => ({ ...p, levelIndex: i }));
}

/** 標本平均。 */
export function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 標本標準偏差（n−1）。1点以下では 0 を返す。 */
export function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const ss = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}
