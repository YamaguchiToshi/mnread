/**
 * `plateau_sdev_v1` と Legge (2007) 法の差異レポート（OPEN-3 / Phase 5）
 *
 *   pnpm --filter @mnread/core diff:mnreadr
 *
 * SPEC §5.5.2 が Phase 5 に送った「`mnreadR` 2.1.7 との実際の差異」を測る。
 * **一致を目標にしない。** mnreadR は照合対象であって裁定者ではない
 * （ADR-0014）。ここが出すのは差異の所在と大きさであり、どちらが正しいかは
 * `oda.lab/` に照らして `docs/mnreadr-comparison.md` で裁定する。
 *
 * 両者には `buildCurve()` の同一出力を渡す。入力の差ではなくアルゴリズムの差
 * だけを見るためで、0 cpm の除去のようにオラクル側の前処理に属するものは
 * オラクル内部で行う（`oracle/mansfield.ts` 挙動1）。
 *
 * テストではないので `pnpm test` からは走らない。配信の門（pages.yml）を
 * レポート生成で重くしないため、意図的に分けてある。
 */

import {
  SYNTHETIC_FAMILIES,
  generateFamily,
  manualWorkedExample,
  type SyntheticCurve,
} from "@mnread/fixtures";

import {
  DEFAULT_ENABLED_CPS_METHODS,
  VARIANT_SPECS,
  analyze,
  buildCurve,
  computeMrs,
  estimateSdev,
  resolveItems,
} from "../../src/index.js";
import type { CpsMethodId, ItemStatus, SessionInput } from "../../src/index.js";
import { estimateMansfield } from "./mansfield.js";

const spec = VARIANT_SPECS["MNREAD-J"];
const CURVES_PER_FAMILY = 40;

/**
 * レビュー発火を見るときの有効算出法。
 *
 * `synthetic.test.ts` の受け入れ基準と同じ4手法を用いる。ここを変えると
 * `CPS_METHOD_DISAGREEMENT` が発火できなくなり、レビュー率が下がって
 * silent-wrong が見かけ上増える。**発火率は算出法の集合に依存する** —
 * この依存自体を §5 で別途確認する。
 */
const REVIEW_METHODS: readonly CpsMethodId[] = [
  "plateau_sdev_v1",
  "expdecay_80",
  "expdecay_90",
  "expdecay_95",
];

/** 一致とみなす CPS の差。SPEC の臨床許容と同じ 0.1 logMAR を用いる。 */
const CPS_AGREEMENT_TOLERANCE = 0.1;

function toSession(c: SyntheticCurve): SessionInput {
  return {
    variant: "MNREAD-J",
    chartVersion: `synthetic/${c.family}/${c.seed}`,
    viewingDistanceCm: c.viewingDistanceCm,
    polarity: "black_on_white",
    eye: "both",
    sequenceDirection: "large_to_small",
    items: c.items.map((i) => ({
      chartLogMAR: i.chartLogMAR,
      status: i.status,
      timeSec: i.timeSec,
      errorCount: i.errorCount,
      viewingDistanceCm: null,
    })),
  };
}

type Verdict =
  | "both_agree"
  | "both_differ"
  | "ours_only"
  | "oracle_only"
  | "neither";

interface Comparison {
  readonly seed: number;
  readonly verdict: Verdict;
  readonly oursCps: number | null;
  readonly oracleCps: number | null;
  readonly deltaCps: number | null;
  readonly latentCps: number;
  /** 潜在真値に近いのはどちらか。同着は "tie" */
  readonly closer: "ours" | "oracle" | "tie" | null;
  readonly oursNotEstimableReason: string | null;
  readonly oracleNotEstimableReason: string | null;
  readonly droppedZeroSpeed: number;
  /** オラクルの MRS と本仕様3方式の差（cpm） */
  readonly mrsDelta: { arithmetic: number | null; pooled: number | null; legacy: number | null };
  /**
   * 本仕様の CPS が真値から 0.1 logMAR 超ずれているか、およびそのとき
   * レビューが要求されたか。**D 類と E 類を分ける判定材料。**
   * 「外れているが警告済み」は設計どおりの失敗（over-flagging is safe）、
   * 「外れていて無警告」は silent-wrong で許されない。
   */
  readonly oursOffTruth: boolean;
  readonly requiresReview: boolean;
}

function compare(c: SyntheticCurve): Comparison {
  const session = toSession(c);
  const curve = buildCurve(resolveItems(session, spec));
  const ours = estimateSdev(curve);
  const oracle = estimateMansfield(curve);

  const analysis = analyze(session, { enabledCpsMethods: REVIEW_METHODS });
  const requiresReview = analysis.ok ? analysis.result.requiresReview : true;

  const oursCps = ours.estimate.estimable ? ours.estimate.cpsCorrectedLogMAR : null;
  const oracleCps = oracle.estimable ? oracle.cpsCorrectedLogMAR : null;
  const latentCps = c.latent.cpsChartLogMAR; // 合成曲線は 30cm なので補正 0

  let verdict: Verdict;
  if (oursCps !== null && oracleCps !== null) {
    verdict =
      Math.abs(oursCps - oracleCps) <= CPS_AGREEMENT_TOLERANCE + 1e-9
        ? "both_agree"
        : "both_differ";
  } else if (oursCps !== null) verdict = "ours_only";
  else if (oracleCps !== null) verdict = "oracle_only";
  else verdict = "neither";

  let closer: Comparison["closer"] = null;
  if (oursCps !== null && oracleCps !== null) {
    const a = Math.abs(oursCps - latentCps);
    const b = Math.abs(oracleCps - latentCps);
    closer = Math.abs(a - b) < 1e-9 ? "tie" : a < b ? "ours" : "oracle";
  }

  const mrsDelta: Comparison["mrsDelta"] = {
    arithmetic: null,
    pooled: null,
    legacy: null,
  };
  if (oracle.estimable && ours.estimate.estimable) {
    const mrs = computeMrs(ours.plateau, spec);
    const pick = (m: string) => mrs.find((r) => r.method === m)?.valueCpm ?? null;
    const o = oracle.mrsCpm!;
    const a = pick("arithmetic");
    const p = pick("pooled");
    const l = pick("legacy_mean_time");
    mrsDelta.arithmetic = a === null ? null : o - a;
    mrsDelta.pooled = p === null ? null : o - p;
    mrsDelta.legacy = l === null ? null : o - l;
  }

  return {
    seed: c.seed,
    verdict,
    oursCps,
    oracleCps,
    deltaCps:
      oursCps !== null && oracleCps !== null ? oracleCps - oursCps : null,
    latentCps,
    closer,
    oursNotEstimableReason: ours.estimate.notEstimableReason,
    oracleNotEstimableReason: oracle.reason,
    droppedZeroSpeed: oracle.droppedZeroSpeedCount,
    mrsDelta,
    oursOffTruth:
      oursCps === null || Math.abs(oursCps - latentCps) > CPS_AGREEMENT_TOLERANCE + 1e-9,
    requiresReview,
  };
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`);
const num = (v: number | null, dp = 3) => (v === null ? "—" : v.toFixed(dp));

function tally<T extends string>(xs: readonly T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/* ============================================================
   1. 原典マニュアル §4 の測定例
   ============================================================ */

console.log("=".repeat(78));
console.log("mnreadR 2.1.7（Legge 2007 法）との差異レポート");
console.log("照合対象であって裁定者ではない — ADR-0014 / docs/mnreadr-comparison.md");
console.log("=".repeat(78));

console.log("\n## 1. 原典マニュアル §4 の測定例（唯一の完全な実測例）\n");
{
  const fx = manualWorkedExample;
  const session: SessionInput = {
    variant: "MNREAD-J",
    chartVersion: fx.session.chartVersion,
    viewingDistanceCm: fx.session.viewingDistanceCm,
    polarity: "black_on_white",
    eye: "both",
    sequenceDirection: "large_to_small",
    items: fx.items.map((it) => ({
      chartLogMAR: it.chartLogMAR,
      status: it.status as ItemStatus,
      timeSec: it.timeSec,
      errorCount: it.errorCount,
      viewingDistanceCm: null,
    })),
  };
  const curve = buildCurve(resolveItems(session, spec));
  const ours = estimateSdev(curve);
  const oracle = estimateMansfield(curve);
  const mrs = computeMrs(ours.plateau, spec);
  const pick = (m: string) => mrs.find((r) => r.method === m)?.valueCpm ?? null;

  console.log(`  原典の記載値      CPS ${fx.statedByManual.cpsCorrectedLogMAR} logMAR / MRS ${fx.statedByManual.mrsCpm} cpm`);
  console.log(`  plateau_sdev_v1   CPS ${num(ours.estimate.cpsCorrectedLogMAR, 4)} / MRS 算術 ${num(pick("arithmetic"), 2)}・プール ${num(pick("pooled"), 2)}・平均時間 ${num(pick("legacy_mean_time"), 2)}`);
  console.log(`  Legge 2007 法     CPS ${num(oracle.cpsCorrectedLogMAR, 4)} / MRS ${num(oracle.mrsCpm, 2)}`);
  console.log(`  0 cpm 点の除去    オラクル側で ${oracle.droppedZeroSpeedCount} 点（本仕様は曲線に載せる — ADR-0002）`);
  console.log(`  条件を満たした窓  ${oracle.acceptedWindows.length} 個`);
}

/* ============================================================
   2. 合成曲線 15族
   ============================================================ */

console.log(`\n## 2. 合成曲線 15族 × ${CURVES_PER_FAMILY}本\n`);
console.log(
  "  族                         一致  相違  当方のみ ｵﾗｸﾙのみ  当方ずれ/警告  真値に近い側",
);
console.log("  " + "-".repeat(80));

const allComparisons: { family: string; c: Comparison }[] = [];

for (const family of SYNTHETIC_FAMILIES) {
  const comparisons = generateFamily(family, CURVES_PER_FAMILY).map(compare);
  for (const c of comparisons) allComparisons.push({ family, c });

  const v = tally(comparisons.map((c) => c.verdict));
  const closer = tally(
    comparisons.map((c) => c.closer).filter((x): x is NonNullable<typeof x> => x !== null),
  );
  const ours = closer.get("ours") ?? 0;
  const oracle = closer.get("oracle") ?? 0;
  const tie = closer.get("tie") ?? 0;
  const decided = ours + oracle;

  const closerLabel =
    decided === 0
      ? `同着 ${tie}`
      : `当方 ${ours} / ｵﾗｸﾙ ${oracle}（同着 ${tie}）`;

  const off = comparisons.filter((c) => c.oursOffTruth);
  const silent = off.filter((c) => !c.requiresReview);
  const offLabel = `${String(off.length).padStart(2)}/${String(off.length - silent.length).padStart(2)}${silent.length > 0 ? ` 無警告${silent.length}` : ""}`;

  console.log(
    `  ${family.padEnd(26)} ${String(v.get("both_agree") ?? 0).padStart(4)}  ${String(v.get("both_differ") ?? 0).padStart(4)}  ${String(v.get("ours_only") ?? 0).padStart(6)}  ${String(v.get("oracle_only") ?? 0).padStart(6)}  ${offLabel.padStart(13)}  ${closerLabel}`,
  );
}

/* ============================================================
   3. 全体集計
   ============================================================ */

const total = allComparisons.length;
const verdicts = tally(allComparisons.map((x) => x.c.verdict));

console.log(`\n## 3. 全体（${total} 本）\n`);
for (const [k, label] of [
  ["both_agree", "CPS が ±0.1 logMAR 以内で一致"],
  ["both_differ", "双方推定できたが 0.1 logMAR 超の相違"],
  ["ours_only", "plateau_sdev_v1 のみ推定できた"],
  ["oracle_only", "Legge 2007 法のみ推定できた"],
  ["neither", "双方推定できず"],
] as const) {
  const n = verdicts.get(k as Verdict) ?? 0;
  console.log(`  ${label.padEnd(38)} ${String(n).padStart(4)} 本  ${pct(n, total)}`);
}

/* 真値への近さ（双方推定できたものだけ） */
const decidable = allComparisons.filter((x) => x.c.closer !== null);
const closerAll = tally(decidable.map((x) => x.c.closer!));
console.log(`\n  潜在真値に近いのはどちらか（双方推定できた ${decidable.length} 本）`);
console.log(`    plateau_sdev_v1 が近い   ${String(closerAll.get("ours") ?? 0).padStart(4)} 本`);
console.log(`    Legge 2007 法が近い      ${String(closerAll.get("oracle") ?? 0).padStart(4)} 本`);
console.log(`    同着                     ${String(closerAll.get("tie") ?? 0).padStart(4)} 本`);

/* D 類と E 類の分かれ目 — 本仕様が真値から外れたとき、警告は出ていたか */
const offTruth = allComparisons.filter((x) => x.c.oursOffTruth);
const silentWrong = offTruth.filter((x) => !x.c.requiresReview);
console.log(`\n  plateau_sdev_v1 が真値から 0.1 logMAR 超ずれた: ${offTruth.length} 本（${pct(offTruth.length, total)}）`);
console.log(`    うちレビュー要求あり（設計どおりの失敗）: ${offTruth.length - silentWrong.length} 本`);
console.log(`    うち無警告（silent-wrong / 許されない）  : ${silentWrong.length} 本`);
if (silentWrong.length > 0) {
  for (const { family, c } of silentWrong.slice(0, 10)) {
    console.log(`      ${family} seed=${c.seed} 当方 ${num(c.oursCps, 2)} / 真値 ${num(c.latentCps, 2)}`);
  }
}

/* 相違の大きさ */
const deltas = allComparisons
  .map((x) => x.c.deltaCps)
  .filter((d): d is number => d !== null)
  .map(Math.abs)
  .sort((a, b) => a - b);
if (deltas.length > 0) {
  const q = (p: number) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))]!;
  console.log(`\n  |ΔCPS| の分布（${deltas.length} 本）`);
  console.log(`    中央値 ${q(0.5).toFixed(3)} / 90%点 ${q(0.9).toFixed(3)} / 最大 ${deltas[deltas.length - 1]!.toFixed(3)} logMAR`);
}

/* 推定不能の理由 */
console.log("\n  推定不能の理由");
const oracleFails = allComparisons.filter((x) => x.c.oracleCps === null);
const oursFails = allComparisons.filter((x) => x.c.oursCps === null);
console.log(`    Legge 2007 法（${oracleFails.length} 本）`);
for (const [r, n] of tally(oracleFails.map((x) => x.c.oracleNotEstimableReason ?? "(不明)"))) {
  console.log(`      ${String(n).padStart(4)} 本  ${r}`);
}
console.log(`    plateau_sdev_v1（${oursFails.length} 本）`);
for (const [r, n] of tally(oursFails.map((x) => x.c.oursNotEstimableReason ?? "(不明)"))) {
  console.log(`      ${String(n).padStart(4)} 本  ${r}`);
}

/* 0 cpm の除去が起きた本数 */
const dropped = allComparisons.filter((x) => x.c.droppedZeroSpeed > 0);
console.log(
  `\n  オラクル側で 0 cpm 点が落ちた曲線: ${dropped.length} 本（${pct(dropped.length, total)}）`,
);

/* MRS */
const mrsA = allComparisons.map((x) => x.c.mrsDelta.arithmetic).filter((v): v is number => v !== null);
const mrsP = allComparisons.map((x) => x.c.mrsDelta.pooled).filter((v): v is number => v !== null);
const mrsL = allComparisons.map((x) => x.c.mrsDelta.legacy).filter((v): v is number => v !== null);
const maxAbs = (xs: readonly number[]) => (xs.length === 0 ? null : Math.max(...xs.map(Math.abs)));
console.log("\n  MRS: オラクル値と本仕様3方式との差（同一プラトー上での比較ではない点に注意）");
console.log(`    vs 算術平均     最大 |Δ| ${num(maxAbs(mrsA), 2)} cpm（${mrsA.length} 本）`);
console.log(`    vs プール       最大 |Δ| ${num(maxAbs(mrsP), 2)} cpm（${mrsP.length} 本）`);
console.log(`    vs 平均時間     最大 |Δ| ${num(maxAbs(mrsL), 2)} cpm（${mrsL.length} 本）`);

/* ============================================================
   4. 相違例の抜粋（裁定の入口）
   ============================================================ */

const differing = allComparisons.filter((x) => x.c.verdict === "both_differ");
if (differing.length > 0) {
  console.log(`\n## 4. 0.1 logMAR 超の相違（先頭 20 件 / 全 ${differing.length} 件）\n`);
  console.log("  族                         seed    当方    ｵﾗｸﾙ    真値   近い側");
  console.log("  " + "-".repeat(66));
  for (const { family, c } of differing.slice(0, 20)) {
    console.log(
      `  ${family.padEnd(26)} ${String(c.seed).padStart(5)}  ${num(c.oursCps, 2).padStart(5)}  ${num(c.oracleCps, 2).padStart(6)}  ${num(c.latentCps, 2).padStart(5)}  ${c.closer ?? "—"}`,
    );
  }
}

/* ============================================================
   5. レビュー発火が算出法の集合に依存するか
   ============================================================

   §3 の silent-wrong は「4手法が有効」という前提での数である。
   CPS_METHOD_DISAGREEMENT は算出法どうしの食い違いで発火するため、集合が
   小さいと発火できない。**実際に画面へ出る構成で silent-wrong が増えるなら、
   それは mnreadR とは無関係の独立した欠陥である。**

   これが F-1 であり、2026-08-01 に対処した（ADR-0015 / OPEN-9 解決）。既定は
   目視 + sdev + expdecay_90 になり、合成テストも出荷構成で走る。旧既定の列は
   **依存そのものが消えていないこと**を示すために残す — 既定を縮めれば
   silent-wrong は戻る。 */

console.log("\n## 5. レビュー発火の算出法集合への依存\n");
{
  const sets: { label: string; methods: readonly CpsMethodId[] }[] = [
    { label: "合成テストの4手法", methods: REVIEW_METHODS },
    { label: "出荷既定（現行）", methods: DEFAULT_ENABLED_CPS_METHODS },
    { label: "旧既定（sdev のみ）", methods: ["manual_visual_2002", "plateau_sdev_v1"] },
  ];
  for (const { label, methods } of sets) {
    let off = 0;
    let reviewed = 0;
    const silentSeeds: string[] = [];
    for (const family of SYNTHETIC_FAMILIES) {
      for (const c of generateFamily(family, CURVES_PER_FAMILY)) {
        const out = analyze(toSession(c), { enabledCpsMethods: methods });
        const review = out.ok ? out.result.requiresReview : true;
        if (review) reviewed++;
        const est = out.ok
          ? out.result.cps.find((e) => e.method === "plateau_sdev_v1")
          : undefined;
        const cps =
          est?.estimable === true ? est.cpsCorrectedLogMAR : null;
        const isOff =
          cps === null ||
          Math.abs(cps - c.latent.cpsChartLogMAR) > CPS_AGREEMENT_TOLERANCE + 1e-9;
        if (isOff) off++;
        if (isOff && !review) {
          silentSeeds.push(
            `${family} seed=${c.seed} 当方 ${num(cps, 2)} / 真値 ${c.latent.cpsChartLogMAR.toFixed(2)}`,
          );
        }
      }
    }
    console.log(
      `  ${label.padEnd(20)} レビュー ${String(reviewed).padStart(3)}/${total}  真値からずれ ${String(off).padStart(3)}  無警告 ${String(silentSeeds.length).padStart(3)}`,
    );
    for (const s of silentSeeds) console.log(`      ${s}`);
  }
  console.log(
    "\n  出荷既定の無警告が 0 でなければ、画面に出る構成が合成テストより弱い\n" +
      "  保護になっている（F-1 の再発）。mnreadR とは独立した所見として扱うこと。",
  );
}

console.log("\n" + "=".repeat(78));
console.log("差異の裁定は docs/mnreadr-comparison.md へ。A〜E に 100% 分類すること。");
console.log("=".repeat(78));
