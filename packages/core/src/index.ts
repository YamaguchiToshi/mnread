/**
 * @mnread/core — MNREAD-J / Jk 解析コア
 *
 * Phase 1 時点では、読み材料単位の算出（速度・距離補正・状態解決）、
 * 読書視力、単位換算、入力検証までを公開する。
 * プラトー探索・CPS 推定・MRS・アクセシビリティ指標は Phase 2 で追加する。
 */

export * from "./types.js";
export * from "./variants.js";
export * from "./speed.js";
export * from "./distance.js";
export * from "./items.js";
export * from "./acuity.js";
export * from "./convert.js";
export * from "./validation.js";
