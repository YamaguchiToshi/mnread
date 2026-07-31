/**
 * 表示のための丸め（SPEC §9）
 *
 * 丸めるのはここだけである。core は倍精度のまま値を返し（ADR-0003）、
 * 画面に出す直前に本ファイルが桁を落とす。丸めた値を計算に戻さないこと。
 */

/** logMAR 各種。小数第2位。 */
export function formatLogMAR(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

/** 距離補正値。符号付きで小数第2位。 */
export function formatSignedLogMAR(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const text = value.toFixed(2);
  return value > 0 ? `+${text}` : text;
}

/** 読書速度。整数 cpm。0 cpm は「0」と出す（欠測の「—」と区別する）。 */
export function formatCpm(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : String(Math.round(value));
}

/** 読書時間。入力の桁をそのまま見せたいので、丸めずに整形だけする。 */
export function formatSeconds(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : String(value);
}

/** M 値・ポイントなどの参考値。有効数字を揃えるより桁を固定するほうが読みやすい。 */
export function formatFixed(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}
