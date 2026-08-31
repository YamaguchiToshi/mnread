/**
 * MNREAD-J / Jk 解析コア — 型定義
 *
 * 本ファイルは SPEC.md の契約をコードで表現したものである。
 * SPEC.md を改訂した場合、本ファイルと `SPEC_VERSION` を同一コミットで更新する。
 *
 * 設計上の固定制約（ADR-0010）:
 *   - 本パッケージは DOM・日付・乱数・ロケールに依存しない
 *   - 全関数は純粋関数
 *   - 丸めた値・整形済み文字列を返さない（ADR-0003）
 */

/** SPEC.md の版。解析結果に必ず含める。 */
export const SPEC_VERSION = "0.6.3";

/** 算出結果が変わりうる変更で必ず上げる（SPEC §10）。 */
export const ALGORITHM_VERSION = "0.5.0";

/* ============================================================
   チャート種別
   ============================================================ */

export type Variant = "MNREAD-J" | "MNREAD-Jk";

export interface VariantSpec {
  readonly variant: Variant;
  /** 1読み材料あたりの文字数 n0（J:30 / Jk:24） */
  readonly charactersPerItem: number;
  /** チャートの刻み h（0.1 logMAR） */
  readonly stepLogMAR: number;
  /** チャート上端の logMAR（1.3） */
  readonly topLogMAR: number;
  /** 段数（19） */
  readonly levelCount: number;
  /** 標準視距離 D0（cm）。J/Jk とも 30 */
  readonly standardDistanceCm: number;
}

/* ============================================================
   セッション入力
   ============================================================ */

export type Polarity = "black_on_white" | "white_on_black";
export type Eye = "right" | "left" | "both";
export type SequenceDirection = "large_to_small" | "small_to_large";

/**
 * 読み材料の状態（SPEC §4.2、ADR-0002）。
 *
 * 「0 cpm」と「欠測」は別物である。真偽値の組み合わせで再構成しないこと。
 */
export type ItemStatus =
  /** 提示し、読んだ。time と errors が必要 */
  | "read"
  /** 提示し試行したが全く読めなかった。0 cpm、N に算入、E に n0 を寄与 */
  | "attempted_unread"
  /** 提示し読んだが時間が未記録。速度は欠測だが N・E には算入 */
  | "presented_time_missing"
  /** 検査終了後、提示していない。欠測。N に算入しない */
  | "unpresented_after_stop"
  /** 上位を省略（読めるとみなした）。N に算入、誤り 0 */
  | "skipped_large_assumed_readable"
  /** 大文字側が読めない（輪状暗点等）。0 cpm、要目視確認 */
  | "skipped_large_unreadable";

export interface ItemInput {
  /** チャートに印刷された logMAR（距離補正前） */
  readonly chartLogMAR: number;
  readonly status: ItemStatus;
  /** 秒。status が read のときのみ必須。t <= 0 は入力エラー */
  readonly timeSec: number | null;
  /** 文字数。0 <= e <= n0 の整数。範囲外は入力エラー */
  readonly errorCount: number | null;
  /** 行別視距離（cm）。null ならセッション既定値を用いる */
  readonly viewingDistanceCm: number | null;
  readonly note?: string;
}

/** 氏名は保持しない（SPEC §4.1）。 */
export interface SubjectMeta {
  readonly subjectId?: string;
  readonly age?: number;
  readonly sex?: string;
  /** ISO 8601 の日付文字列。core は日付演算を行わない */
  readonly testDate?: string;
}

export interface SessionInput {
  readonly variant: Variant;
  readonly chartVersion: string;
  readonly viewingDistanceCm: number;
  readonly polarity: Polarity;
  readonly eye: Eye;
  readonly sequenceDirection: SequenceDirection;
  readonly subject?: SubjectMeta;
  readonly items: readonly ItemInput[];
}

/* ============================================================
   入力検証（ADR-0004）
   ============================================================ */

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
  | "ERR_TIME_NOT_POSITIVE"
  | "ERR_ERRORS_OUT_OF_RANGE"
  | "ERR_ERRORS_NOT_INTEGER"
  | "ERR_DISTANCE_NOT_POSITIVE"
  | "ERR_DUPLICATE_SIZE"
  | "ERR_STATE_FIELD_MISMATCH"
  | "WARN_SEQUENCE_REVERSED"
  | "WARN_DISTANCE_VARIED"
  | "WARN_IMPLAUSIBLE_SPEED";

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly severity: ValidationSeverity;
  /** 該当する items のインデックス。セッション全体の問題なら null */
  readonly itemIndex: number | null;
  /** 該当フィールド名。UI が入力欄を特定するために用いる */
  readonly field: string | null;
  /** 検者向けの説明。UI 側で翻訳・整形してよい */
  readonly message: string;
}

/* ============================================================
   算出結果 — 読み材料単位
   ============================================================ */

export interface ItemResult {
  readonly index: number;
  readonly chartLogMAR: number;
  /** 距離補正後 logMAR。距離が不明なら null */
  readonly correctedLogMAR: number | null;
  /**
   * 読書速度。
   *   number（0 含む） = 測定された事実
   *   null            = 欠測
   * この2つを混同しないこと（ADR-0002）。
   */
  readonly speedCpm: number | null;
  readonly status: ItemStatus;
  /**
   * 記録された読書時間と読み損じ文字数をそのまま保持する。
   * MRS の pooled / legacy 方式が総文字数と総時間を必要とすること、および
   * 書き出しファイルが生データを含む必要があることによる。
   */
  readonly timeSec: number | null;
  readonly errorCount: number | null;
  /** RA の N に算入されるか */
  readonly includedInAcuity: boolean;
  /** RA の E への寄与文字数 */
  readonly acuityErrorContribution: number;
  /** 読書速度曲線に描画されるか */
  readonly includedInCurve: boolean;
  readonly distanceCorrectionLogMAR: number | null;
}

/* ============================================================
   読書視力 RA
   ============================================================ */

export interface ReadingAcuityResult {
  /** N: 読んだ、または読もうとした読み材料数 */
  readonly attemptedItemCount: number;
  /** E: 累積読み損じ文字数 */
  readonly cumulativeErrors: number;
  /** L_min: 最後に試行した行のチャート表示サイズ */
  readonly lastAttemptedChartLogMAR: number;
  /** 距離補正前。フル精度（ADR-0003） */
  readonly raChartLogMAR: number;
  readonly distanceCorrectionLogMAR: number;
  /** 距離補正後。フル精度 */
  readonly raCorrectedLogMAR: number;
  /**
   * 読めない行まで到達せずに検査を終えた場合 true。
   * このとき RA は下限値であり、「RA = ○○ 以下」と表示する（SPEC §5.3.4）。
   */
  readonly censored: boolean;
  /** 誤り1文字あたりの logMAR 分解能（J: 1/300、Jk: 1/240） */
  readonly errorResolutionLogMAR: number;
}

/* ============================================================
   最大読書速度 MRS（ADR-0005）
   ============================================================ */

export type MrsMethodId =
  /** プラトー内速度の算術平均。標準値 */
  | "arithmetic"
  /** 総正読文字数 / 総時間 */
  | "pooled"
  /** 平均時間から換算。プラトー内全項目が誤り0のときのみ有効 */
  | "legacy_mean_time";

export interface MrsResult {
  readonly method: MrsMethodId;
  /** cpm。算出条件を満たさない場合は null（SPEC §5.4） */
  readonly valueCpm: number | null;
  /** プラトー内速度の標本標準偏差 */
  readonly sdCpm: number | null;
  /** プラトー点数 */
  readonly n: number;
  /** valueCpm が null の場合の理由 */
  readonly notApplicableReason: string | null;
}

/* ============================================================
   臨界文字サイズ CPS（ADR-0006）
   ============================================================ */

export type CpsMethodId =
  /** 検者がグラフ上で選択したプラトー。臨床の主値 */
  | "manual_visual_2002"
  /** 平均 - 1.96SD による反復拡張 */
  | "plateau_sdev_v1"
  /** 指数減衰フィットの MRS 80/90/95% 到達サイズ */
  | "expdecay_80"
  | "expdecay_90"
  | "expdecay_95";

/** 曲線フィットの品質情報（SPEC §5.5.4）。 */
export interface FitDiagnostics {
  readonly converged: boolean;
  /** 対数回帰に用いた正速度データ数 */
  readonly positiveSpeedCount: number;
  /** 対数回帰から除外した 0 cpm の点数。ε で置換しないこと */
  readonly zeroSpeedExcludedCount: number;
  readonly rmseLogSpeed: number | null;
  /**
   * モデルの漸近速度（cpm）。プラトー点の平均である `MrsResult` とは別物であり、
   * 混同しないこと。フィットを行わない算出法では null。
   */
  readonly fittedMrsCpm: number | null;
  /** パラメータが探索境界に張り付いたか */
  readonly parameterAtBoundary: boolean;
  /** CPS より大きい側に十分な実測点があるか */
  readonly plateauObserved: boolean;
  /** 小文字側に傾斜部の実測点があるか */
  readonly slopeObserved: boolean;
  /** モデル・ライブラリ・最適化設定の識別子 */
  readonly methodVersion: string;
}

export interface CpsEstimate {
  readonly method: CpsMethodId;
  /**
   * 推定できたか。false の場合 cps* は null。
   * 数値を出せないことを数値で表現しない（SPEC §5.5.4）。
   */
  readonly estimable: boolean;
  readonly notEstimableReason: string | null;
  readonly cpsChartLogMAR: number | null;
  readonly cpsCorrectedLogMAR: number | null;
  /** CPS が実測 logMAR 範囲の外。通常値として表示しない */
  readonly extrapolated: boolean;
  /** プラトーに含まれる items のインデックス */
  readonly plateauItemIndices: readonly number[];
  readonly fit: FitDiagnostics | null;
}

/**
 * 検者による目視判定（`manual_visual_2002`）の入力。
 * 外れ値は「点を削除」ではなく「除外として記録」する（ADR-0006）。
 */
export interface PlateauSelection {
  readonly plateauItemIndices: readonly number[];
  readonly excludedItemIndices: readonly number[];
  /** 除外理由。キーは items のインデックス */
  readonly exclusionReasons: Readonly<Record<number, string>>;
}

/** 自動値を採用・上書きした操作の記録（SPEC §8.1、§8.4）。 */
export interface SelectionRecord {
  readonly cpsMethod: CpsMethodId;
  readonly mrsMethod: MrsMethodId;
  /** 自動値を上書きした場合の理由。上書きしていなければ null */
  readonly overrideReason: string | null;
  /**
   * 検者の目視判定が、自動値（`plateau_sdev_v1`）と異なるプラトーを指しているか。
   *
   * 目視判定がない場合は false（上書きしていないため）。true でありながら
   * `overrideReason` が空なら `OVERRIDE_REASON_MISSING` が立つ（SPEC §8.4）。
   */
  readonly overridesAutomatic: boolean;
}

/* ============================================================
   アクセシビリティ指標（ADR-0008）
   ============================================================ */

export interface AccessibilityResult {
  /** 1.3〜0.4 logMAR の名目10行の平均 cpm。非正規化 */
  readonly meanSpeedCpm: number | null;
  /** 平均に用いた行数 */
  readonly n: number;
  /**
   * 日本語版の正規化定数は存在しないため常に null（ADR-0008）。
   * 型としても null 以外を取らない。
   */
  readonly normalized: null;
  /** 標準外距離で測定した場合 true。原著 ACC として扱わない */
  readonly nonStandardDistance: boolean;
}

/* ============================================================
   単位換算（ADR-0007）
   ============================================================ */

export interface UnitConversion {
  /** 換算元。距離補正後 logMAR を用いる */
  readonly correctedLogMAR: number;
  /** VA = 10^(-L) */
  readonly decimalAcuity: number;
  /** M = 10^(L - M_REFERENCE_LOG_OFFSET)。OPEN-1 参照 */
  readonly mValue: number;
  /** MNREAD-J 相当ポイント（30cm 基準） */
  readonly pointAt30cm: number;
  /** 指定距離での MNREAD-J 相当ポイント */
  readonly pointAtDistance: number;
  /** 物理ボディ高相当（mm） */
  readonly bodyHeightMm: number;
  /** 日本語文字の視角（arcmin） */
  readonly visualAngleArcmin: number;
}

/* ============================================================
   判読ゾーン（SPEC §5.8、ADR-0013）
   ============================================================ */

export type ReadingZoneId =
  /** RA 未満。読めない */
  | "unreadable"
  /** RA 以上 CPS 未満。読めるが最大読書速度に達しない */
  | "effortful"
  /** CPS 以上。最大読書速度で読める */
  | "comfortable";

/**
 * 1つの帯。範囲は距離補正後 logMAR の半開区間 [min, max) で表す。
 * `null` はその側に開いていることを意味する（0 ではない）。
 */
export interface ReadingZone {
  readonly id: ReadingZoneId;
  readonly minCorrectedLogMAR: number | null;
  readonly maxCorrectedLogMAR: number | null;
  /** 境界に対応する MNREAD-J 相当ポイント（測定距離基準）。開いている側は null */
  readonly minPoint: number | null;
  readonly maxPoint: number | null;
  /**
   * 同じ境界を**標準距離**（§5.2、30cm）で読む場合のポイント。開いている側は null。
   *
   * 測定距離基準の値と併記するためにある。測定距離が標準距離と異なるとき、
   * この2つは D/30 倍だけ違う——どちらの距離での大きさなのかが分からない紙は、
   * 患者にとっても支援者にとっても使えない（視能訓練士レビュー 2026-08）。
   */
  readonly minPointAtStandard: number | null;
  readonly maxPointAtStandard: number | null;
  /** min >= max。RA > CPS の退化で「努力」が空になる場合に true（SPEC §5.8） */
  readonly empty: boolean;
}

export interface ReadingZoneSet {
  /** unreadable → effortful → comfortable の順 */
  readonly zones: readonly ReadingZone[];
  /** 境界に用いた CPS の算出法。値と方法IDを分離しない（ADR-0006） */
  readonly cpsMethod: CpsMethodId;
  readonly cpsCorrectedLogMAR: number;
  readonly raCorrectedLogMAR: number;
  /** RA が打ち切りで下限値である場合 true。不可ゾーンの境界も下限値になる */
  readonly raCensored: boolean;
  /** RA > CPS の退化。値は入れ替えず、事実として返す */
  readonly raAboveCps: boolean;
  /** ポイント換算に用いた距離（cm） */
  readonly targetDistanceCm: number;
  /** `*PointAtStandard` の換算に用いた標準距離（cm） */
  readonly standardDistanceCm: number;
  /** 測定距離が標準距離と異なる。true のとき2組のポイント値は一致しない */
  readonly nonStandardDistance: boolean;
}

/** CPS 相当と支援余裕を分離して保持する（SPEC §5.7）。 */
export interface SupportRange {
  /** CPS そのものに相当するポイント（測定距離基準） */
  readonly lowerPoint: number;
  /** CPS + margin に相当するポイント（測定距離基準） */
  readonly upperPoint: number;
  /** 同じ2値を標準距離（§5.2、30cm）で読む場合のポイント */
  readonly lowerPointAtStandard: number;
  readonly upperPointAtStandard: number;
  /** `lowerPoint` / `upperPoint` の換算に用いた距離（cm） */
  readonly targetDistanceCm: number;
  /** `*PointAtStandard` の換算に用いた標準距離（cm） */
  readonly standardDistanceCm: number;
  /** 測定距離が標準距離と異なる。true のとき2組のポイント値は一致しない */
  readonly nonStandardDistance: boolean;
  /** 加えた余裕（logMAR）。既定 0.1（≒1.26倍） */
  readonly marginLogMAR: number;
  /** 余裕に対応する倍率 10^margin */
  readonly marginRatio: number;
}

/* ============================================================
   品質フラグ（SPEC §7）
   ============================================================ */

export type QualityFlag =
  | "TOO_FEW_POINTS"
  | "NO_PLATEAU"
  | "CPS_AT_BOUNDARY"
  | "CPS_METHOD_DISAGREEMENT"
  | "MRS_METHOD_DISAGREEMENT"
  | "HIGH_INFLUENCE_POINT"
  | "LARGE_PRINT_FALLOFF"
  | "FIT_NOT_CONVERGED"
  | "CPS_EXTRAPOLATED"
  | "RA_CENSORED"
  | "ZERO_SPEED_HANDLING_DIVERGES"
  /** CPS より大きい文字サイズの実測点がプラトーから外れている（外れ値・二重プラトー） */
  | "PLATEAU_GAP"
  /** 読書時間・速度が生理的範囲を外れている */
  | "IMPLAUSIBLE_VALUE"
  /** RA > CPS。判読ゾーンの「努力」が空になる退化（SPEC §5.8） */
  | "RA_ABOVE_CPS"
  /** 目視判定が自動値と異なるのに上書き理由が記録されていない（SPEC §8.4） */
  | "OVERRIDE_REASON_MISSING";

/* ============================================================
   解析の入出力
   ============================================================ */

export interface AnalysisOptions {
  /** 検者の目視判定。null なら manual_visual_2002 は推定不能を返す */
  readonly manualPlateau: PlateauSelection | null;
  /** 実行する CPS 算出法。既定は manual と sdev */
  readonly enabledCpsMethods: readonly CpsMethodId[];
  /** MRS 方式間の乖離を警告する閾値（比率）。既定 0.05 */
  readonly mrsDisagreementThreshold: number;
  /** CPS 算出法間の乖離を警告する閾値（logMAR）。既定 0.2 */
  readonly cpsDisagreementThresholdLogMAR: number;
  /** 支援余裕（logMAR）。既定 0.1 */
  readonly supportMarginLogMAR: number;
  /**
   * 検者が自動値と異なる判定を採った理由（SPEC §8.4）。
   * 目視判定が自動値と一致していれば無視される。
   */
  readonly overrideReason: string | null;
}

export interface AnalysisResult {
  readonly specVersion: string;
  readonly algorithmVersion: string;
  readonly variantSpec: VariantSpec;
  readonly input: SessionInput;

  /**
   * 検者の目視判定。`input` と同じく、結果を決めた入力をそのまま返す。
   *
   * CPS と MRS はこの集合の関数である（ADR-0012）。値だけを書き出すと、
   * 後から「なぜその CPS になったか」を再現できない。書き出したファイルから
   * 解析をやり直せることが、生データ書き出しの条件である（SPEC §8.2.3）。
   */
  readonly manualPlateau: PlateauSelection | null;

  readonly items: readonly ItemResult[];
  readonly readingAcuity: ReadingAcuityResult | null;
  /** 3方式すべてを返す。実装が一方を選ばない（ADR-0005） */
  readonly mrs: readonly MrsResult[];
  /** 有効化された算出法すべてを返す。主値は selection が指す（ADR-0006） */
  readonly cps: readonly CpsEstimate[];
  readonly selection: SelectionRecord;
  readonly accessibility: AccessibilityResult;

  /**
   * セッション既定距離に対する距離補正値。全出力に含める（SPEC §8.1）。
   * 行別距離を指定した行は `items[i].distanceCorrectionLogMAR` が優先する。
   */
  readonly distanceCorrectionLogMAR: number;
  /** 主値 CPS の換算。CPS が推定不能なら null */
  readonly cpsConversion: UnitConversion | null;
  /** RA の換算。RA が算出できなければ null */
  readonly raConversion: UnitConversion | null;
  readonly supportRange: SupportRange | null;
  /** 判読3ゾーン（SPEC §5.8）。CPS か RA が欠ければ null */
  readonly zones: ReadingZoneSet | null;

  readonly qualityFlags: readonly QualityFlag[];
  /** qualityFlags が空でなければ true */
  readonly requiresReview: boolean;
  /** error を含まない warning のみの検証結果 */
  readonly warnings: readonly ValidationIssue[];
}

/**
 * 解析の返り値。
 *
 * 例外を投げず判別可能な返り値を用いるのは、UI が全エラーを行単位で
 * 同時表示する必要があるため（ADR-0004）。error が1件でもある場合、
 * 部分的な結果を返さない。
 */
export type AnalysisOutcome =
  | { readonly ok: true; readonly result: AnalysisResult }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
