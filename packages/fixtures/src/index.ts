/**
 * @mnread/fixtures — 一次資料から転記したゴールデンデータ
 *
 * すべての値は `references/` の原典（公式マニュアルおよび Q&A）に由来する。
 * 転記の健全性は `verify-transcription.mjs` が独立の参照式で検証する
 * （`pnpm --filter @mnread/fixtures verify`）。
 *
 * 本パッケージはテスト専用であり、アプリケーションから import しない。
 */

import qaPointSize from "../data/qa-point-size.json" with { type: "json" };
import manualTableADistance from "../data/manual-table-a-distance.json" with { type: "json" };
import manualTableBDecimalAcuity from "../data/manual-table-b-decimal-acuity.json" with { type: "json" };
import manualTableCSpeed from "../data/manual-table-c-speed.json" with { type: "json" };
import chartPrintedValues from "../data/chart-printed-values.json" with { type: "json" };
import manualWorkedExample from "../data/manual-worked-example.json" with { type: "json" };

export {
  qaPointSize,
  manualTableADistance,
  manualTableBDecimalAcuity,
  manualTableCSpeed,
  chartPrintedValues,
  manualWorkedExample,
};

/** 各ゴールデンデータの出所の種別。報告書2の `authority` 区分に対応する。 */
export type FixtureAuthority =
  /** 原典が本文中に計算過程と結果を示している例 */
  | "official_worked_example"
  /** 原典が表として公表している値 */
  | "official_published_table"
  /** 原典の式から導出した値 */
  | "formula_derived"
  /** 生成した合成データ */
  | "synthetic";

export const ALL_FIXTURES = [
  qaPointSize,
  manualTableADistance,
  manualTableBDecimalAcuity,
  manualTableCSpeed,
  chartPrintedValues,
  manualWorkedExample,
] as const;

export * from "./synthetic.js";
