/**
 * 転記検証スクリプト
 *
 * `data/` の各ゴールデンデータは PDF の図表から人手で転記したものであり、
 * 転記誤りが混入しうる。本スクリプトは、`@mnread/core` の実装とは独立に
 * ここで再定義した参照式を用いて、転記値が原典の式と整合するかを検査する。
 *
 * 目的は core の検証ではなく、**ゴールデンデータ自体の健全性の確認**である。
 * したがって、ここでは core を import しない（import すると相互に誤りを
 * 隠蔽しうる）。報告書2の「第2の開発者による期待値の再計算」に相当する。
 *
 *   node verify-transcription.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) =>
  JSON.parse(readFileSync(join(here, "data", name), "utf8"));

/* 参照式（原典から独立に再実装） */
const refPoint = (L) => Math.tan(Math.pow(10, L) * (5 / 60) * (Math.PI / 180)) * 1908;
const refM = (L) => Math.pow(10, L - 0.4);
const refDistanceLogMAR = (D) => Math.log10(30 / D);
const refDistanceM = (D) => 30 / D;
const refDecimalAcuity = (L) => Math.pow(10, -L);
const refSpeed = (n0, e, t) => (60 * (n0 - e)) / t;
/** 原典の表は四捨五入（half-up）。JS の Math.round は負値で挙動が異なるが、ここは常に正値。 */
const roundHalfUp = (v, dp = 0) => {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
};

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (title, fn) => {
  console.log(`\n${title}`);
  const before = failures;
  fn();
  if (failures === before) console.log("  ✓ 全件一致");
};

/* ---------------------------------------------------------- */

section("Q&A A4.3 ポイント換算表（21件、相対誤差 1e-7）", () => {
  for (const { logMAR, pointSize } of load("qa-point-size.json").rows) {
    const got = refPoint(logMAR);
    const rel = Math.abs(got - pointSize) / pointSize;
    check(`logMAR ${logMAR}`, rel <= 1e-7, `期待 ${pointSize} / 算出 ${got.toFixed(7)} (rel ${rel.toExponential(2)})`);
  }
});

section("マニュアル表A 距離補正（33件）", () => {
  for (const { distanceCm, logMAR, mMultiplier } of load("manual-table-a-distance.json").rows) {
    check(`${distanceCm}cm logMAR`, Math.abs(roundHalfUp(refDistanceLogMAR(distanceCm), 2) - logMAR) < 1e-9,
      `期待 ${logMAR} / 算出 ${refDistanceLogMAR(distanceCm).toFixed(4)}`);
    // 原典は小数第2位。0.625 / 0.375 のような境界値があるため、絶対誤差ではなく
    // 四捨五入後の一致で判定する。
    check(`${distanceCm}cm M倍率`, Math.abs(roundHalfUp(refDistanceM(distanceCm), 2) - mMultiplier) < 1e-9,
      `期待 ${mMultiplier} / 算出 ${refDistanceM(distanceCm).toFixed(4)}`);
  }
});

section("マニュアル表B 小数視力（40件）", () => {
  for (const { logMAR, decimalAcuity } of load("manual-table-b-decimal-acuity.json").rows) {
    const got = refDecimalAcuity(logMAR);
    check(`logMAR ${logMAR}`, Math.abs(roundHalfUp(got, 3) - decimalAcuity) < 1e-9,
      `期待 ${decimalAcuity} / 算出 ${got.toFixed(5)}`);
  }
});

section("マニュアル表C 読書速度（54件 × J/Jk）", () => {
  for (const { timeSec, j, jk } of load("manual-table-c-speed.json").rows) {
    check(`t=${timeSec} J`, roundHalfUp(refSpeed(30, 0, timeSec)) === j,
      `期待 ${j} / 算出 ${refSpeed(30, 0, timeSec).toFixed(3)}`);
    check(`t=${timeSec} Jk`, roundHalfUp(refSpeed(24, 0, timeSec)) === jk,
      `期待 ${jk} / 算出 ${refSpeed(24, 0, timeSec).toFixed(3)}`);
  }
});

section("チャート印刷 M size（19件、R10優先数のため許容 3.5%）", () => {
  const fx = load("chart-printed-values.json");
  const tol = fx.tolerance.mValueRelative;
  for (const { logMAR, mSize } of fx.rows) {
    const gotM = refM(logMAR);
    check(`logMAR ${logMAR} M`, Math.abs(gotM - mSize) / mSize <= tol,
      `印刷 ${mSize} / 算出 ${gotM.toFixed(4)}`);
  }
});

section("マニュアル §4 測定例", () => {
  const fx = load("manual-worked-example.json");
  const exp = fx.expectedFullPrecision;
  const stated = fx.statedByManual;
  const D = fx.session.viewingDistanceCm;
  const n0 = 30;

  // 各行速度（logMAR をキーにした連想配列は 1.0 → "1" になり脆いので配列で持つ）
  const speedOf = (L) => exp.itemSpeedsCpm.find((r) => r.chartLogMAR === L);
  for (const it of fx.items) {
    if (it.status !== "read") continue;
    const got = refSpeed(n0, it.errorCount, it.timeSec);
    const want = speedOf(it.chartLogMAR);
    check(`速度 logMAR ${it.chartLogMAR}`, want !== undefined && Math.abs(got - want.speedCpm) < 1e-10,
      `期待 ${want?.speedCpm} / 算出 ${got}`);
  }
  check("attempted_unread は 0 cpm", speedOf(0.5)?.speedCpm === 0);

  // N と E
  const read = fx.items.filter((i) => i.status === "read");
  check("N", read.length === stated.attemptedItemCount);
  check("E", read.reduce((s, i) => s + i.errorCount, 0) === stated.cumulativeErrors);

  // RA
  const raChart = 1.4 - 0.1 * stated.attemptedItemCount + stated.cumulativeErrors / 300;
  const dC = refDistanceLogMAR(D);
  check("RA chart フル精度", Math.abs(raChart - exp.raChartLogMAR) < 1e-12);
  check("距離補正 フル精度", Math.abs(dC - exp.distanceCorrectionLogMAR) < 1e-15);
  check("RA 補正後 フル精度", Math.abs(raChart + dC - exp.raCorrectedLogMAR) < 1e-12);
  check("RA 表示丸め → 原典 0.8", roundHalfUp(raChart, 1) === stated.raChartLogMAR);
  check("RA 補正後 表示丸め → 原典 1.1", roundHalfUp(raChart + dC, 1) === stated.raCorrectedLogMAR);
  check("RA 小数視力 → 原典 0.08", roundHalfUp(refDecimalAcuity(raChart + dC), 2) === stated.raDecimalAcuity);

  // RA の不変性（SPEC §5.3.3）: 全誤り項目を算入しても不変
  const raWithUnread = 1.4 - 0.1 * (stated.attemptedItemCount + 1) + (stated.cumulativeErrors + 30) / 300;
  check("RA 不変性（全誤り項目の算入で変化しない）", Math.abs(raWithUnread - raChart) < 1e-12,
    `算入せず ${raChart} / 算入 ${raWithUnread}`);

  // CPS
  const cpsCorr = stated.cpsChartLogMAR + dC;
  check("CPS 補正後 フル精度", Math.abs(cpsCorr - exp.cpsCorrectedLogMAR) < 1e-12);
  check("CPS 補正後 表示丸め → 原典 1.4", roundHalfUp(cpsCorr, 1) === stated.cpsCorrectedLogMAR);
  check("CPS chart M → 原典 5M", Math.abs(refM(stated.cpsChartLogMAR) - stated.cpsChartMValue) / 5 <= 0.01);
  check("CPS 補正後 M → 原典 10M", Math.abs(refM(cpsCorr) - stated.cpsCorrectedMValue) / 10 <= 0.01,
    `算出 ${refM(cpsCorr).toFixed(4)}`);
  check("CPS 補正後 小数視力 → 原典 0.04", roundHalfUp(refDecimalAcuity(cpsCorr), 2) === stated.cpsCorrectedDecimalAcuity);

  // MRS
  const P = fx.items.filter((i) => i.status === "read" && i.chartLogMAR >= stated.cpsChartLogMAR);
  check("プラトー点数", P.length === exp.mrsN);
  const speeds = P.map((i) => refSpeed(n0, i.errorCount, i.timeSec));
  const arith = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const meanT = P.reduce((s, i) => s + i.timeSec, 0) / P.length;
  const pooled = (60 * P.reduce((s, i) => s + (n0 - i.errorCount), 0)) / P.reduce((s, i) => s + i.timeSec, 0);
  check("MRS 算術平均", Math.abs(arith - exp.mrsArithmetic) < 1e-9, `算出 ${arith}`);
  check("MRS 平均時間方式", Math.abs(60 * n0 / meanT - exp.mrsLegacyMeanTime) < 1e-9);
  check("MRS pooled", Math.abs(pooled - exp.mrsPooled) < 1e-9);
  check("MRS 平均時間 → 原典 411", roundHalfUp(60 * n0 / meanT) === stated.mrsCpm);
  check("MRS 平均読書時間 → 原典 4.38秒", roundHalfUp(meanT, 2) === stated.mrsMeanTimeSec);
  check("誤り0のときのみ pooled == 平均時間方式", Math.abs(pooled - 60 * n0 / meanT) < 1e-9);
  const sd = Math.sqrt(speeds.reduce((s, v) => s + (v - arith) ** 2, 0) / (speeds.length - 1));
  check("MRS 標本SD", Math.abs(sd - exp.mrsSdCpm) < 1e-9);
});

console.log(
  failures === 0
    ? "\n転記検証: すべて一致した。"
    : `\n転記検証: ${failures} 件の不一致。data/ の転記または参照式を確認すること。`,
);
process.exit(failures === 0 ? 0 : 1);
