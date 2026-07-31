/**
 * MNREAD-J / Jk のチャート定数と換算定数。
 *
 * 本ファイルの値は SPEC.md §3 および §5.7 に対応する。
 * 英語版 MNREAD の定数（10語、40cm、200 wpm）をここに追加しないこと（ADR-0001）。
 */

import type { AnalysisOptions, Variant, VariantSpec } from "./types.js";

export const VARIANT_SPECS: Readonly<Record<Variant, VariantSpec>> = {
  "MNREAD-J": {
    variant: "MNREAD-J",
    charactersPerItem: 30,
    stepLogMAR: 0.1,
    topLogMAR: 1.3,
    levelCount: 19,
    standardDistanceCm: 30,
  },
  "MNREAD-Jk": {
    variant: "MNREAD-Jk",
    charactersPerItem: 24,
    stepLogMAR: 0.1,
    topLogMAR: 1.3,
    levelCount: 19,
    standardDistanceCm: 30,
  },
} as const;

/**
 * RA の誤り項の分母 d = n0 / h。
 * J は 30/0.1 = 300、Jk は 24/0.1 = 240 となり公式式と一致する（SPEC §5.3.2）。
 */
export function raErrorDenominator(spec: VariantSpec): number {
  return spec.charactersPerItem / spec.stepLogMAR;
}

/* ============================================================
   換算定数（ADR-0007）
   ============================================================ */

/**
 * M値換算のオフセット: M = 10^(L - M_REFERENCE_LOG_OFFSET)
 *
 * 一次資料で確認済み（OPEN-1 解決）:
 *   - Q&A A7 が式そのものを明記: 「M値 = 10^(臨界文字サイズのlogMAR - 0.4)」
 *   - マニュアル §4.3: 1.1 logMAR がチャート上で 5M（10^0.7 = 5.01）
 *   - マニュアル §1.2: 4M の印刷文字はほぼ 28 ポイント（pt(1.0) = 27.75）
 *   - チャート印刷の M size 系列は R10（10^(n/10)）で、本式と1%以内で一致
 *
 * M は Magnification の頭字であり、新聞を読むのに必要な倍率を表す（Q&A A7）。
 * 30cm 以外で測定した場合、M への補正は乗算 30/D（マニュアル表A）。
 * これは logMAR 補正 log10(30/D) と等価であり、補正後 logMAR から本式で求めれば足りる。
 */
export const M_REFERENCE_LOG_OFFSET = 0.4;

/**
 * 公式ポイント換算式の係数（Q&A A4.3）: pt = tan(10^L * 5/60 度) * 1908
 *
 * 1908 = 300mm × (72/25.4) × 2.2437 に分解できる。末尾の係数は
 * 「MNREAD-J の文字は英語版 MNREAD の 2.24348 倍」（Q&A A4.2）に対応する。
 */
export const POINT_CONVERSION_COEFFICIENT = 1908;

/**
 * 日本語文字の視角係数: θ = 11.4 × 10^L arcmin（Q&A A4.2）。
 *
 * OPEN-5: Q&A 内に不整合がある。A4.2 は 11.4 を示すが、A4.3 のポイント換算式が
 * 含意する係数は 5 × 2.2437 = 11.22 であり、約1.6% 異なる。
 * 本定数は視角の情報表示にのみ用い、pt・M・臨床値はいずれも本定数に依存しない。
 */
export const JAPANESE_CHARACTER_ANGLE_COEFFICIENT = 11.4;

/** DTP ポイント → mm。 */
export const MM_PER_POINT = 25.4 / 72;

/* ============================================================
   アクセシビリティ指標の対象範囲（ADR-0008）
   ============================================================ */

/** 名目 1.3〜0.4 logMAR の10行。距離補正後の値ではなくチャート表示値で選ぶ。 */
export const ACCESSIBILITY_RANGE_CHART_LOGMAR = {
  max: 1.3,
  min: 0.4,
  expectedCount: 10,
} as const;

/* ============================================================
   既定オプション
   ============================================================ */

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  manualPlateau: null,
  enabledCpsMethods: ["manual_visual_2002", "sdev_1.96"],
  /** OPEN-4: 5% に臨床的根拠はない。Phase 5 で実測により調整する。 */
  mrsDisagreementThreshold: 0.05,
  cpsDisagreementThresholdLogMAR: 0.2,
  supportMarginLogMAR: 0.1,
} as const;

/**
 * 標準チャートの各段のチャート表示 logMAR（1.3 → -0.5、0.1刻み、19段）。
 *
 * 0.1 の累積加算は二進浮動小数点で誤差が出るため、整数演算から生成する。
 */
export function chartLogMARLevels(spec: VariantSpec): readonly number[] {
  const scale = 1 / spec.stepLogMAR;
  const top = Math.round(spec.topLogMAR * scale);
  return Array.from(
    { length: spec.levelCount },
    (_, i) => (top - i) / scale,
  );
}
