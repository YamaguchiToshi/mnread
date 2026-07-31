/**
 * 生データ書き出し（SPEC §8.2.3）
 *
 * 規則:
 *   - **氏名欄を設けない。** ID・年齢・性別・実施日まで
 *   - **丸めない。** 表示用の丸めを書き出しに持ち込まない（ADR-0003）。
 *     再解析に使える値であることが生データの条件である
 *   - 書き出しは検者の明示操作でのみ発生する。自動保存・自動送信を実装しない
 *   - 各値に算出法 ID を添える（ADR-0006）
 *
 * ここでも算術は書かない。`AnalysisResult` の値をそのまま並べ替えるだけである。
 */

import type { AnalysisResult } from "@mnread/core";

export interface ExportBundle {
  readonly fileBaseName: string;
  readonly json: string;
  readonly csv: string;
}

/**
 * 解析結果一式。`AnalysisResult` をそのまま出す。
 *
 * 表示用に整形した値を混ぜない。読む側が丸め方を選べるようにするためである。
 */
export function buildExportJson(result: AnalysisResult): string {
  return JSON.stringify(
    {
      format: "mnread-j-analysis",
      formatVersion: 1,
      specVersion: result.specVersion,
      algorithmVersion: result.algorithmVersion,
      note:
        "数値はフル精度（倍精度）である。表示用の丸めは行っていない。" +
        "氏名は含まない（SPEC §8.2.3）。",
      result,
    },
    null,
    2,
  );
}

/**
 * 1行 = 1読み材料の表。セッション情報と解析値はヘッダ行群として先に置く。
 *
 * 表計算で開くことを想定しているが、丸めはしない。桁が長いのは仕様である。
 */
export function buildExportCsv(result: AnalysisResult): string {
  const input = result.input;
  const selectedCps = result.cps.find((e) => e.method === result.selection.cpsMethod);
  const plateau = new Set(selectedCps?.plateauItemIndices ?? []);

  const rows: string[] = [];

  rows.push("# MNREAD-J / Jk 生データ書き出し（フル精度・氏名を含まない）");
  rows.push(cells(["key", "value"]));
  for (const [key, value] of headerPairs(result)) {
    rows.push(cells([key, value]));
  }

  rows.push("");
  rows.push(
    cells([
      "itemIndex",
      "chartLogMAR",
      "correctedLogMAR",
      "status",
      "timeSec",
      "errorCount",
      "speedCpm",
      "includedInAcuity",
      "acuityErrorContribution",
      "includedInCurve",
      "inSelectedPlateau",
      "distanceCorrectionLogMAR",
    ]),
  );
  for (const item of result.items) {
    rows.push(
      cells([
        item.index,
        item.chartLogMAR,
        item.correctedLogMAR,
        item.status,
        item.timeSec,
        item.errorCount,
        item.speedCpm,
        item.includedInAcuity,
        item.acuityErrorContribution,
        item.includedInCurve,
        plateau.has(item.index),
        item.distanceCorrectionLogMAR,
      ]),
    );
  }

  rows.push("");
  rows.push(cells(["cpsMethod", "estimable", "cpsChartLogMAR", "cpsCorrectedLogMAR", "extrapolated", "notEstimableReason"]));
  for (const estimate of result.cps) {
    rows.push(
      cells([
        estimate.method,
        estimate.estimable,
        estimate.cpsChartLogMAR,
        estimate.cpsCorrectedLogMAR,
        estimate.extrapolated,
        estimate.notEstimableReason,
      ]),
    );
  }

  rows.push("");
  rows.push(cells(["mrsMethod", "valueCpm", "sdCpm", "n", "notApplicableReason"]));
  for (const mrs of result.mrs) {
    rows.push(
      cells([mrs.method, mrs.valueCpm, mrs.sdCpm, mrs.n, mrs.notApplicableReason]),
    );
  }

  // 末尾の改行はテキストファイルの慣例。行数の数え違いを防ぐ。
  return `${rows.join("\n")}\n`;

  function headerPairs(r: AnalysisResult): readonly (readonly [string, unknown])[] {
    return [
      ["specVersion", r.specVersion],
      ["algorithmVersion", r.algorithmVersion],
      ["variant", input.variant],
      ["chartVersion", input.chartVersion],
      ["subjectId", input.subject?.subjectId ?? ""],
      ["age", input.subject?.age ?? ""],
      ["sex", input.subject?.sex ?? ""],
      ["testDate", input.subject?.testDate ?? ""],
      ["eye", input.eye],
      ["polarity", input.polarity],
      ["sequenceDirection", input.sequenceDirection],
      ["viewingDistanceCm", input.viewingDistanceCm],
      ["distanceCorrectionLogMAR", r.distanceCorrectionLogMAR],
      ["raChartLogMAR", r.readingAcuity?.raChartLogMAR ?? ""],
      ["raCorrectedLogMAR", r.readingAcuity?.raCorrectedLogMAR ?? ""],
      ["raCensored", r.readingAcuity?.censored ?? ""],
      ["attemptedItemCount", r.readingAcuity?.attemptedItemCount ?? ""],
      ["cumulativeErrors", r.readingAcuity?.cumulativeErrors ?? ""],
      ["selectedCpsMethod", r.selection.cpsMethod],
      ["selectedMrsMethod", r.selection.mrsMethod],
      ["overridesAutomatic", r.selection.overridesAutomatic],
      ["overrideReason", r.selection.overrideReason ?? ""],
      ["accessibilityMeanSpeedCpm", r.accessibility.meanSpeedCpm ?? ""],
      ["accessibilityN", r.accessibility.n],
      ["qualityFlags", r.qualityFlags.join(" ")],
      ["requiresReview", r.requiresReview],
    ];
  }
}

/**
 * 書き出しファイル名の基幹部分。
 *
 * 氏名は入れない。ID と実施日だけで、後から突き合わせられれば足りる。
 * 日付を持たないセッションでは日付欄を省く（core は日付を生成しない）。
 */
export function exportFileBaseName(result: AnalysisResult): string {
  const subject = result.input.subject;
  const parts = [
    "mnread",
    subject?.subjectId === undefined || subject.subjectId === ""
      ? null
      : sanitize(subject.subjectId),
    subject?.testDate === undefined || subject.testDate === ""
      ? null
      : sanitize(subject.testDate),
  ];
  return parts.filter((p): p is string => p !== null).join("_");
}

export function buildExportBundle(result: AnalysisResult): ExportBundle {
  return {
    fileBaseName: exportFileBaseName(result),
    json: buildExportJson(result),
    csv: buildExportCsv(result),
  };
}

/* ---------------------------------------------------------- */

function cells(values: readonly unknown[]): string {
  return values.map(cell).join(",");
}

/**
 * CSV の1セル。
 *
 * `null` は空欄にする。0 と欠測を混同しないため（ADR-0002）、数値の 0 は
 * そのまま `0` と書き、欠測だけが空欄になる。
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** ファイル名に使えない文字を落とす。 */
function sanitize(text: string): string {
  return text.replace(/[^\w\-.]/g, "_");
}
