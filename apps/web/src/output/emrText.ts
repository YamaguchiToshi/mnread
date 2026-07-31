/**
 * 電子カルテ用テキスト（SPEC §8.2.1）
 *
 * 貼り付けて使う定型文。**含める項目を固定する。**
 *
 * 規則:
 *   - CPS は算出法 ID と同じ行に置く。「CPS 0.6 logMAR」だけの行を作らない（ADR-0006）
 *   - MRS は3方式すべてを方式 ID つきで出す（ADR-0005）
 *   - 測定距離と距離補正値を必ず含める（SPEC §8.1）
 *   - 数値はすべて `AnalysisResult` の値。ここで計算しない（ADR-0010）
 *   - 丸めは `format.ts` にのみ委ねる（ADR-0003 / SPEC §9）
 *
 * 判読ゾーン（SPEC §5.8）は**入れない**。あれは患者・支援者向けの目安であり、
 * カルテには測定値と算出法だけを残す（ADR-0013）。
 */

import type { AnalysisResult } from "@mnread/core";

import {
  formatCpm,
  formatFixed,
  formatLogMAR,
  formatSignedLogMAR,
} from "../format.js";
import {
  CPS_METHOD_LABEL,
  EYE_LABEL,
  MRS_METHOD_LABEL,
  POLARITY_LABEL,
  QUALITY_FLAG_LABEL,
  SEQUENCE_LABEL,
} from "../labels.js";

export function buildEmrText(result: AnalysisResult): string {
  const input = result.input;
  const lines: string[] = [];

  lines.push(`■ ${input.variant} 読書評価`);
  lines.push(headerLine(result));
  lines.push(
    `測定距離: ${formatFixed(input.viewingDistanceCm, 1)} cm` +
      `（距離補正 ${formatSignedLogMAR(result.distanceCorrectionLogMAR)} logMAR）`,
  );
  lines.push("");

  /* --- 読書視力 --- */
  const ra = result.readingAcuity;
  if (ra === null) {
    lines.push("読書視力 RA: 算出せず（試行した読み材料がない）");
  } else {
    lines.push(
      `読書視力 RA: ${ra.censored ? "≦ " : ""}${formatLogMAR(ra.raCorrectedLogMAR)} logMAR` +
        `（小数視力 ${formatFixed(result.raConversion?.decimalAcuity ?? null, 2)}、` +
        `補正前 ${formatLogMAR(ra.raChartLogMAR)}、N=${ra.attemptedItemCount}、E=${ra.cumulativeErrors}）`,
    );
    if (ra.censored) {
      lines.push("  ※ 全く読めない行まで到達していないため、RA は下限値である");
    }
  }

  /* --- CPS：主値と参考値。値だけの行を作らない --- */
  lines.push("");
  lines.push(...cpsLines(result));

  /* --- MRS：3方式すべて --- */
  lines.push("");
  lines.push("最大読書速度 MRS（原典の定義本文と計算例が一致しないため3方式を併記）:");
  for (const mrs of result.mrs) {
    const label = MRS_METHOD_LABEL[mrs.method];
    if (mrs.valueCpm === null) {
      lines.push(`  ${label}: 算出せず（${mrs.notApplicableReason ?? "理由不明"}）`);
    } else {
      const sd = mrs.sdCpm === null ? "" : `、SD=${formatCpm(mrs.sdCpm)}`;
      lines.push(`  ${label}: ${formatCpm(mrs.valueCpm)} cpm（n=${mrs.n}${sd}）`);
    }
  }

  /* --- アクセシビリティ指標（非正規化。ACC と単独表示しない） --- */
  const acc = result.accessibility;
  lines.push("");
  lines.push(
    `読書アクセシビリティ対象範囲平均速度: ${formatCpm(acc.meanSpeedCpm)} cpm` +
      `（1.3〜0.4 logMAR の名目10行、非正規化、n=${acc.n}` +
      `${acc.nonStandardDistance ? "、標準外距離のため原著 ACC としては扱わない" : ""}）`,
  );

  /* --- 推奨文字サイズ：CPS 相当と支援余裕を分ける --- */
  if (result.supportRange !== null) {
    const support = result.supportRange;
    lines.push("");
    lines.push(
      `推奨文字サイズ（参考値・MNREAD-J相当・${formatFixed(input.viewingDistanceCm, 1)} cm）:`,
    );
    lines.push(
      `  下限 ${formatFixed(support.lowerPoint, 1)} pt（CPS 相当。最大速度を支える最小サイズ）`,
    );
    lines.push(
      `  上限 ${formatFixed(support.upperPoint, 1)} pt` +
        `（支援余裕 +${formatFixed(support.marginLogMAR, 2)} logMAR ≒ ${formatFixed(support.marginRatio, 2)}倍）`,
    );
    lines.push("  ※ ポイント値は MNREAD-J の文字設計に対応した相当値であり、フォントにより実寸は異なる");
  }

  /* --- 判定の由来（監査） --- */
  if (result.selection.overridesAutomatic) {
    lines.push("");
    lines.push(
      `判定の上書き: 検者の目視判定は自動値（${CPS_METHOD_LABEL.plateau_sdev_v1}）と` +
        "異なるプラトーを指している",
    );
    lines.push(`  理由: ${result.selection.overrideReason ?? "（未記録）"}`);
  }

  /* --- 品質フラグ --- */
  if (result.qualityFlags.length > 0) {
    lines.push("");
    lines.push("目視確認を要する点:");
    for (const flag of result.qualityFlags) {
      lines.push(`  - ${QUALITY_FLAG_LABEL[flag]}（${flag}）`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("入力上の注意:");
    for (const warning of result.warnings) {
      lines.push(`  - ${warning.message}`);
    }
  }

  lines.push("");
  lines.push(
    `算出: 仕様 ${result.specVersion} / アルゴリズム ${result.algorithmVersion}` +
      "（実測検証は未完了。院内ツールとしての参考値）",
  );

  return lines.join("\n");
}

/* ---------------------------------------------------------- */

function headerLine(result: AnalysisResult): string {
  const input = result.input;
  const parts = [
    input.subject?.testDate === undefined ? null : `実施日 ${input.subject.testDate}`,
    input.subject?.subjectId === undefined ? null : `ID ${input.subject.subjectId}`,
    input.subject?.age === undefined ? null : `${String(input.subject.age)}歳`,
    EYE_LABEL[input.eye],
    POLARITY_LABEL[input.polarity],
    input.chartVersion === "" ? null : `チャート ${input.chartVersion}`,
    `実施順 ${SEQUENCE_LABEL[input.sequenceDirection]}`,
  ];
  return parts.filter((p): p is string => p !== null).join(" / ");
}

/**
 * CPS の行。
 *
 * 主値が目視判定でない場合、**その事実を文中に明示する**（SPEC §8.2.1）。
 * 「CPS = ○○」だけを読んだ人が、検者の判定だと誤解しないようにするため。
 */
function cpsLines(result: AnalysisResult): readonly string[] {
  const lines: string[] = [];
  const selectedMethod = result.selection.cpsMethod;
  const selected = result.cps.find((e) => e.method === selectedMethod);

  if (selected === undefined || !selected.estimable) {
    lines.push("臨界文字サイズ CPS: 推定不能");
    for (const estimate of result.cps) {
      lines.push(
        `  ${CPS_METHOD_LABEL[estimate.method]}: ${estimate.notEstimableReason ?? "理由不明"}`,
      );
    }
    return lines;
  }

  const provisional =
    selectedMethod === "manual_visual_2002"
      ? ""
      : "（検者の目視判定が未実施のため、自動値を暫定の主値としている）";
  lines.push(
    `臨界文字サイズ CPS: ${formatLogMAR(selected.cpsCorrectedLogMAR)} logMAR` +
      ` ＝ ${CPS_METHOD_LABEL[selectedMethod]}${provisional}`,
  );
  if (selected.extrapolated) {
    lines.push("  ※ 実測範囲外の外挿推定。通常値として扱わない");
  }

  const conversion = result.cpsConversion;
  if (conversion !== null) {
    lines.push(
      `  CPS 相当: ${formatFixed(conversion.mValue, 1)}M / ` +
        `${formatFixed(conversion.pointAtDistance, 1)} pt（MNREAD-J相当、` +
        `${formatFixed(result.input.viewingDistanceCm, 1)} cm）/ ` +
        `小数視力 ${formatFixed(conversion.decimalAcuity, 2)}`,
    );
  }

  const others = result.cps.filter((e) => e.method !== selectedMethod);
  if (others.length > 0) {
    lines.push("  参考値（併記であり主値の置き換えではない）:");
    for (const estimate of others) {
      lines.push(
        `    ${CPS_METHOD_LABEL[estimate.method]}: ` +
          (estimate.estimable
            ? `${formatLogMAR(estimate.cpsCorrectedLogMAR)} logMAR`
            : `推定不能（${estimate.notEstimableReason ?? "理由不明"}）`),
      );
    }
  }
  return lines;
}
