/**
 * 最大読書速度 MRS（SPEC §5.4、ADR-0005）
 *
 * 原典 §3.3 の定義本文は「臨界文字サイズ以上のときの読書速度の平均値」。
 * §4.4 の計算例は平均読書時間から換算しているが、その場で「読み間違いを
 * 1つもしていないので」と条件を明示している。したがって平均時間方式は
 * プラトー内の全項目が誤り0のときにのみ有効であり、条件を外れたら null を返す。
 */

import { mean, sampleSd, type CurvePoint } from "./curve.js";
import type { MrsMethodId, MrsResult, VariantSpec } from "./types.js";

/**
 * プラトー集合から MRS を3方式ぶん算出する。
 * 実装がどれか一つを選ばないこと（ADR-0005）。
 */
export function computeMrs(
  plateau: readonly CurvePoint[],
  spec: VariantSpec,
): readonly MrsResult[] {
  if (plateau.length === 0) {
    return (["arithmetic", "pooled", "legacy_mean_time"] as const).map(
      (method): MrsResult => ({
        method,
        valueCpm: null,
        sdCpm: null,
        n: 0,
        notApplicableReason: "プラトーが確定していない",
      }),
    );
  }

  const speeds = plateau.map((p) => p.speedCpm);
  const arithmetic = mean(speeds);
  const sd = plateau.length >= 2 ? sampleSd(speeds) : null;

  const results: MrsResult[] = [
    {
      method: "arithmetic",
      valueCpm: arithmetic,
      sdCpm: sd,
      n: plateau.length,
      notApplicableReason: null,
    },
    buildPooled(plateau, spec),
    buildLegacyMeanTime(plateau, spec),
  ];
  return results;
}

/** 総正読文字数 ÷ 総読書時間。時間が欠けている点があれば算出しない。 */
function buildPooled(
  plateau: readonly CurvePoint[],
  spec: VariantSpec,
): MrsResult {
  const base: Omit<MrsResult, "valueCpm" | "notApplicableReason"> = {
    method: "pooled" satisfies MrsMethodId,
    sdCpm: null,
    n: plateau.length,
  };

  if (plateau.some((p) => p.timeSec === null || p.errorCount === null)) {
    return {
      ...base,
      valueCpm: null,
      notApplicableReason: "プラトー内に読書時間または誤り数が未記録の点がある",
    };
  }

  const totalTime = plateau.reduce((s, p) => s + (p.timeSec ?? 0), 0);
  if (totalTime <= 0) {
    return { ...base, valueCpm: null, notApplicableReason: "総読書時間が0以下" };
  }

  const totalCorrect = plateau.reduce(
    (s, p) => s + (spec.charactersPerItem - (p.errorCount ?? 0)),
    0,
  );
  return {
    ...base,
    valueCpm: (60 * totalCorrect) / totalTime,
    notApplicableReason: null,
  };
}

/**
 * 平均読書時間から換算する原典の計算例互換値。
 *
 * プラトー内の全項目が誤り0のときのみ有効。誤りを含む場合、
 * 「n0 文字 ÷ 平均時間」という式は意味を持たないため null を返す。
 */
function buildLegacyMeanTime(
  plateau: readonly CurvePoint[],
  spec: VariantSpec,
): MrsResult {
  const base: Omit<MrsResult, "valueCpm" | "notApplicableReason"> = {
    method: "legacy_mean_time" satisfies MrsMethodId,
    sdCpm: null,
    n: plateau.length,
  };

  if (plateau.some((p) => p.timeSec === null || p.errorCount === null)) {
    return {
      ...base,
      valueCpm: null,
      notApplicableReason: "プラトー内に読書時間または誤り数が未記録の点がある",
    };
  }
  if (plateau.some((p) => p.errorCount !== 0)) {
    return {
      ...base,
      valueCpm: null,
      notApplicableReason:
        "プラトー内に読み損じのある点がある（原典 §4.4 は誤り0を条件としている）",
    };
  }

  const meanTime = mean(plateau.map((p) => p.timeSec ?? 0));
  if (meanTime <= 0) {
    return { ...base, valueCpm: null, notApplicableReason: "平均読書時間が0以下" };
  }
  return {
    ...base,
    valueCpm: (60 * spec.charactersPerItem) / meanTime,
    notApplicableReason: null,
  };
}

/** 標準値（算術平均）を取り出す補助。 */
export function primaryMrs(results: readonly MrsResult[]): MrsResult | null {
  return results.find((r) => r.method === "arithmetic") ?? null;
}
