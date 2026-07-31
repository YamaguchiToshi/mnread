/**
 * 画面と出力に出す日本語ラベル
 *
 * **算出法 ID に対する表示名を1か所に集める。** 同じ ID の呼び名が画面と
 * 電子カルテ文で違うと、検者が別の方法だと誤解する。ADR-0006 が求める
 * 「値には必ず方法を添える」は、添える名前が一貫していて初めて意味を持つ。
 *
 * ここに算術は書かない（ADR-0010）。文字列の対応表だけである。
 */

import type {
  CpsMethodId,
  MrsMethodId,
  QualityFlag,
  ReadingZoneId,
} from "@mnread/core";

export const CPS_METHOD_LABEL: Readonly<Record<CpsMethodId, string>> = {
  manual_visual_2002: "目視判定（2002マニュアル）",
  plateau_sdev_v1: "SDev法 v1（自動）",
  expdecay_80: "指数減衰フィット 80%",
  expdecay_90: "指数減衰フィット 90%",
  expdecay_95: "指数減衰フィット 95%",
};

/** グラフの凡例など、幅の限られる場所で使う短縮形。 */
export const CPS_METHOD_SHORT: Readonly<Record<CpsMethodId, string>> = {
  manual_visual_2002: "目視",
  plateau_sdev_v1: "SDev法",
  expdecay_80: "フィット80%",
  expdecay_90: "フィット90%",
  expdecay_95: "フィット95%",
};

/**
 * MRS の3方式。原典の定義本文（§3.3）は算術平均、計算例（§4.4）は平均時間換算で、
 * 両者は一致しない。実装がどちらかを選ばず3つとも出す（ADR-0005）。
 * 測定例では 412 cpm（算術平均）と 411 cpm（平均時間換算）に分かれる。
 */
export const MRS_METHOD_LABEL: Readonly<Record<MrsMethodId, string>> = {
  arithmetic: "プラトー内の算術平均（標準）",
  pooled: "総正読文字数 ÷ 総時間",
  legacy_mean_time: "平均時間からの換算（原典 §4.4 の計算例）",
};

/** 品質フラグ（SPEC §7）。検者が次に何を見ればよいかが分かる文言にする。 */
export const QUALITY_FLAG_LABEL: Readonly<Record<QualityFlag, string>> = {
  TOO_FEW_POINTS: "有効な測定点が3点以下。曲線の形を判断できない",
  NO_PLATEAU: "隣接2サイズ以上のプラトーがない",
  CPS_AT_BOUNDARY: "CPS が実測範囲の端にある。プラトーが途中で切れている可能性",
  CPS_METHOD_DISAGREEMENT: "算出法によって CPS が 0.2 logMAR を超えて食い違う",
  MRS_METHOD_DISAGREEMENT: "算術平均と平均時間方式の MRS が食い違う（読み間違いの有無を確認）",
  HIGH_INFLUENCE_POINT: "1点を除くと CPS が 0.1 logMAR を超えて動く",
  LARGE_PRINT_FALLOFF: "大きい文字側で速度が落ちている（輪状暗点・視野狭窄など）",
  FIT_NOT_CONVERGED: "曲線フィットが収束しない、またはパラメータが探索境界に達した",
  CPS_EXTRAPOLATED: "CPS が実測範囲の外。通常値として扱わない",
  RA_CENSORED: "全く読めない行まで到達していない。読書視力は下限値",
  ZERO_SPEED_HANDLING_DIVERGES: "0 cpm の扱いで算出法間の結果が変わる",
  PLATEAU_GAP: "CPS より大きい文字サイズの点がプラトーから外れている（外れ値・二重プラトー）",
  IMPLAUSIBLE_VALUE: "読書時間または速度が生理的範囲を外れている",
  RA_ABOVE_CPS: "読書視力が CPS より大きい。判読ゾーンの「努力」が空になる",
  OVERRIDE_REASON_MISSING: "自動値と異なる判定を採っているが、理由が記録されていない",
};

export const ZONE_LABEL: Readonly<Record<ReadingZoneId, string>> = {
  unreadable: "読めない",
  effortful: "読めるが遅くなる",
  comfortable: "最も速く読める",
};

export const ZONE_SHORT: Readonly<Record<ReadingZoneId, string>> = {
  unreadable: "不可",
  effortful: "努力",
  comfortable: "快適",
};

export const POLARITY_LABEL = {
  black_on_white: "白地に黒",
  white_on_black: "黒地に白",
} as const;

export const EYE_LABEL = {
  right: "右眼",
  left: "左眼",
  both: "両眼",
} as const;

export const SEQUENCE_LABEL = {
  large_to_small: "大→小",
  small_to_large: "小→大",
} as const;
