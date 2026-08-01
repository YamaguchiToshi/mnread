/**
 * 品質フラグが1つも立たない素直な二肢曲線を、検者と同じ打鍵で入力する。
 *
 * 原典 §4 の測定例は、出荷既定（目視・SDev・`expdecay_90`、SPEC §5.5.1）では
 * `CPS_METHOD_DISAGREEMENT` が立つ。指数減衰モデルが原典の曲線に適合せず、
 * 90% 到達サイズを実測範囲の外（1.61 logMAR）へ押し出すためである。
 * したがって「フラグがなければ警告を出さない」という逆側の性質は、
 * 測定例では確かめられない。そのための曲線をここで用意する。
 *
 * 30cm、誤り 0、プラトー 400 cpm（1.3〜0.6）、以降 200 / 100 / 40 cpm と落ち、
 * 0.2 logMAR で不読。小さい側で 0 cpm に達するので RA は打ち切りにならず、
 * 指数フィットも実測範囲内に収まる。
 */

import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/** 速度 400 cpm は 30 字 ÷ (1800/400) 秒。誤り 0 なので時間だけで決まる。 */
const KEYSTROKES = [
  "4.5{Enter}", // 1.3
  "4.5{Enter}", // 1.2
  "4.5{Enter}", // 1.1
  "4.5{Enter}", // 1.0
  "4.5{Enter}", // 0.9
  "4.5{Enter}", // 0.8
  "4.5{Enter}", // 0.7
  "4.5{Enter}", // 0.6
  "9{Enter}", // 0.5 = 200 cpm
  "18{Enter}", // 0.4 = 100 cpm
  "45{Enter}", // 0.3 = 40 cpm
  "*", // 0.2 は1文字も読めなかった（0 cpm）
].join("");

export async function enterCleanTwoLimb(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  // 視距離は既定の 30cm のまま使う。
  await user.click(screen.getByLabelText("1.30 logMAR の読書時間（秒）"));
  await user.keyboard(KEYSTROKES);
}
