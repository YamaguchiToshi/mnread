/**
 * 品質フラグ（SPEC §7）
 *
 * いずれかが立ったら目視レビューを要求する。自動推定を無条件に受け入れないための層。
 * 原典 §5 の「プログラムの推定した値が一致しないときには、自ら手書きで推定した値を
 * 利用してください」という指示を、機械的に検出可能な条件へ落としたもの。
 */

import { compactLevels, type CurvePoint } from "./curve.js";
import { estimateSdev } from "./plateau/sdev.js";
import type {
  AnalysisOptions,
  CpsEstimate,
  MrsResult,
  QualityFlag,
  ReadingAcuityResult,
  ReadingZoneSet,
  SelectionRecord,
} from "./types.js";

/** 1点の除外で CPS がこれ以上動いたら影響が大きいとみなす（logMAR）。 */
const HIGH_INFLUENCE_LOGMAR = 0.1;

/** 最大サイズの速度が最大速度のこの割合を下回ったら大文字側低下とみなす。 */
const LARGE_PRINT_FALLOFF_RATIO = 0.8;

export interface QualityInput {
  readonly curve: readonly CurvePoint[];
  readonly estimates: readonly CpsEstimate[];
  readonly selected: CpsEstimate | null;
  readonly mrs: readonly MrsResult[];
  readonly readingAcuity: ReadingAcuityResult | null;
  /** 判読ゾーン（SPEC §5.8）。CPS が推定不能なら null */
  readonly zones: ReadingZoneSet | null;
  /** 判定の由来（SPEC §8.4） */
  readonly selection: SelectionRecord;
  readonly hasLargeUnreadable: boolean;
  /** `WARN_IMPLAUSIBLE_SPEED` が1件でも出ているか */
  readonly hasImplausibleValue: boolean;
  readonly options: AnalysisOptions;
}

export function computeQualityFlags(input: QualityInput): readonly QualityFlag[] {
  const flags = new Set<QualityFlag>();
  const { curve, estimates, selected, mrs, readingAcuity, options } = input;

  if (curve.length <= 3) flags.add("TOO_FEW_POINTS");

  if (selected === null || !selected.estimable) {
    flags.add("NO_PLATEAU");
  } else if (selected.plateauItemIndices.length < 2) {
    flags.add("NO_PLATEAU");
  }

  if (selected?.estimable === true && selected.cpsCorrectedLogMAR !== null && curve.length > 0) {
    const sizes = curve.map((p) => p.correctedLogMAR);
    const smallest = Math.min(...sizes);
    const largest = Math.max(...sizes);
    const cps = selected.cpsCorrectedLogMAR;
    if (Math.abs(cps - smallest) < 1e-9 || Math.abs(cps - largest) < 1e-9) {
      flags.add("CPS_AT_BOUNDARY");
    }
  }

  if (selected?.extrapolated === true) flags.add("CPS_EXTRAPOLATED");

  // 算出法間の乖離。
  //
  // 比較対象は目視・SDev・指数フィット90% の3つに限る。指数フィットの
  // 80/90/95% は設計上ずれる値であり（閾値が違うのだから当然）、これらを
  // 同列に並べて分散を見ると必ず乖離と判定されてフラグが無意味になる。
  // 90% を代表に採るのは、評定者との一致がこの閾値で最も高いとする
  // 報告（Baskaran 2019）による。
  const comparable = new Set<CpsEstimate["method"]>([
    "manual_visual_2002",
    "plateau_sdev_v1",
    "expdecay_90",
  ]);
  const cpsValues = estimates
    .filter(
      (e) => comparable.has(e.method) && e.estimable && e.cpsCorrectedLogMAR !== null,
    )
    .map((e) => e.cpsCorrectedLogMAR!);
  if (cpsValues.length >= 2) {
    const spread = Math.max(...cpsValues) - Math.min(...cpsValues);
    if (spread > options.cpsDisagreementThresholdLogMAR) {
      flags.add("CPS_METHOD_DISAGREEMENT");
    }
  }

  // MRS の方式間乖離（定義本文 対 原典計算例）
  const arithmetic = valueOf(mrs, "arithmetic");
  const legacy = valueOf(mrs, "legacy_mean_time");
  if (arithmetic !== null && legacy !== null && arithmetic > 0) {
    if (Math.abs(arithmetic - legacy) / arithmetic > options.mrsDisagreementThreshold) {
      flags.add("MRS_METHOD_DISAGREEMENT");
    }
  }

  // フィットの健全性
  for (const e of estimates) {
    if (e.fit === null) continue;
    if (!e.fit.converged || e.fit.parameterAtBoundary) {
      flags.add("FIT_NOT_CONVERGED");
    }
  }

  if (readingAcuity?.censored === true) flags.add("RA_CENSORED");

  if (hasLargePrintFalloff(curve, input.hasLargeUnreadable)) {
    flags.add("LARGE_PRINT_FALLOFF");
  }

  if (hasHighInfluencePoint(curve)) flags.add("HIGH_INFLUENCE_POINT");

  if (zeroSpeedHandlingDiverges(curve)) flags.add("ZERO_SPEED_HANDLING_DIVERGES");

  if (hasPlateauGap(curve, selected)) flags.add("PLATEAU_GAP");

  if (input.hasImplausibleValue) flags.add("IMPLAUSIBLE_VALUE");

  // RA > CPS の退化（SPEC §5.8）。判読ゾーンの「努力」が空になる。
  // 値は入れ替えないので、事実として検者に見せるほかない。
  if (input.zones?.raAboveCps === true) flags.add("RA_ABOVE_CPS");

  // 監査の穴（SPEC §8.4）。理由なしの上書きは、後から妥当性を検討できない。
  if (
    input.selection.overridesAutomatic &&
    (input.selection.overrideReason === null ||
      input.selection.overrideReason.trim() === "")
  ) {
    flags.add("OVERRIDE_REASON_MISSING");
  }

  return [...flags];
}

function valueOf(mrs: readonly MrsResult[], method: MrsResult["method"]): number | null {
  return mrs.find((m) => m.method === method)?.valueCpm ?? null;
}

/**
 * 大文字側での速度低下（輪状暗点・網膜色素変性症等）。
 * Q&A Q8 はこの型の曲線が実在することを認めている。
 */
function hasLargePrintFalloff(
  curve: readonly CurvePoint[],
  hasLargeUnreadable: boolean,
): boolean {
  if (hasLargeUnreadable) return true;
  if (curve.length < 3) return false;

  const ordered = [...curve].sort((a, b) => b.correctedLogMAR - a.correctedLogMAR);
  const largest = ordered[0]!.speedCpm;
  const maxSpeed = Math.max(...curve.map((p) => p.speedCpm));
  if (maxSpeed <= 0) return false;

  return largest < LARGE_PRINT_FALLOFF_RATIO * maxSpeed;
}

/**
 * 1点を除いたときに SDev 法の CPS が大きく動くか（leave-one-out）。
 *
 * 除去後は段番号を詰める。詰めないと、プラトー中央の点を除いたときに
 * 連続性が切れて区間が分断され、その点の測定値とは無関係に CPS が動いて
 * しまい、ほぼ全ての曲線で誤発火する。
 */
function hasHighInfluencePoint(curve: readonly CurvePoint[]): boolean {
  const full = estimateSdev(curve);
  if (!full.estimate.estimable || full.estimate.cpsCorrectedLogMAR === null) return false;

  for (let i = 0; i < curve.length; i += 1) {
    const reduced = compactLevels(curve.filter((_, j) => j !== i));
    const alt = estimateSdev(reduced);
    if (!alt.estimate.estimable || alt.estimate.cpsCorrectedLogMAR === null) continue;
    const delta = Math.abs(
      alt.estimate.cpsCorrectedLogMAR - full.estimate.cpsCorrectedLogMAR,
    );
    if (delta > HIGH_INFLUENCE_LOGMAR + 1e-9) return true;
  }
  return false;
}

/**
 * CPS より大きい文字サイズの実測点が、プラトーから外れていないか。
 *
 * 選択規則は外れ値を迂回して妥当な CPS を返すことがある。値としては堅牢だが、
 * 「プラトーに入るはずのサイズなのに入らなかった点」がある事実は検者に
 * 伝えなければならない（外れ値、二重プラトー、大文字側の低下のいずれか）。
 * 報告書2 が単一外れ値の族に求めるのも、堅牢な CPS **と** 警告の両方である。
 */
function hasPlateauGap(
  curve: readonly CurvePoint[],
  selected: CpsEstimate | null,
): boolean {
  if (selected?.estimable !== true || selected.cpsCorrectedLogMAR === null) return false;

  const inPlateau = new Set(selected.plateauItemIndices);
  return curve.some(
    (p) =>
      p.correctedLogMAR > selected.cpsCorrectedLogMAR! + 1e-9 &&
      !inPlateau.has(p.itemIndex),
  );
}

/**
 * 0 cpm の点の扱いで結果が変わるか。
 *
 * 指数減衰フィットは 0 cpm を対数回帰から除外する（SPEC §5.5.3）一方、
 * SDev 法は 0 cpm を通常の点として扱う。両者の前提差が CPS を動かすなら、
 * 検者が曲線を見て判断すべき状況である。
 */
function zeroSpeedHandlingDiverges(curve: readonly CurvePoint[]): boolean {
  const withZero = curve.filter((p) => p.speedCpm === 0);
  if (withZero.length === 0) return false;

  const full = estimateSdev(curve);
  const withoutZero = estimateSdev(compactLevels(curve.filter((p) => p.speedCpm > 0)));

  if (!full.estimate.estimable || !withoutZero.estimate.estimable) return false;
  if (
    full.estimate.cpsCorrectedLogMAR === null ||
    withoutZero.estimate.cpsCorrectedLogMAR === null
  ) {
    return false;
  }
  return (
    Math.abs(
      full.estimate.cpsCorrectedLogMAR - withoutZero.estimate.cpsCorrectedLogMAR,
    ) > 1e-9
  );
}
