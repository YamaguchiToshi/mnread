/**
 * 生データの読み込み（SPEC §8.2.3）
 *
 * 読み込みの価値は「後から再解析できること」にある。したがって最重要の検証は
 * **往復して同じ解析結果に戻るか**である。値の表示だけが戻っても、判定をやり直せ
 * なければ目的を果たさない。
 *
 * 壊れたファイルを拒否することも同じだけ重要である。読める部分だけ入れると、
 * 半分だけの検査が入力途中の検査と見分けがつかなくなる。
 */

import { analyze, type AnalysisResult } from "@mnread/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";
import { buildExportJson } from "../src/output/exportData.js";
import { parseExportedSession } from "../src/output/importData.js";
import { deriveSessionView } from "../src/session/derive.js";
import { toPlateauSelection, toSessionInput } from "../src/session/state.js";
import { workedExampleSession } from "./support/workedExample.js";

function analysed(overrides = {}): AnalysisResult {
  const outcome = analyze(workedExampleSession(), overrides);
  if (!outcome.ok) throw new Error("測定例の解析が通らなかった");
  return outcome.result;
}

/** 検者が 1.1 logMAR を外し、理由を残した判定。 */
function judgedResult(): AnalysisResult {
  const auto = analysed().cps.find((e) => e.method === "plateau_sdev_v1")!;
  return analysed({
    manualPlateau: {
      plateauItemIndices: auto.plateauItemIndices.slice(0, 2),
      excludedItemIndices: [3],
      exclusionReasons: { 3: "読み直しがあり時間が過大" },
    },
    overrideReason: "1.1 logMAR は読み直しがあり速度が過大",
  });
}

/* ============================================================
   往復
   ============================================================ */

describe("書き出し → 読み込みの往復", () => {
  it("測定値がそのまま戻る", () => {
    const outcome = parseExportedSession(buildExportJson(analysed()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const restored = toSessionInput(outcome.draft);
    expect(restored).toEqual(analysed().input);
  });

  it("検者の判定（プラトー・除外・理由）も戻る", () => {
    const outcome = parseExportedSession(buildExportJson(judgedResult()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(toPlateauSelection(outcome.draft)).toEqual(judgedResult().manualPlateau);
    expect(outcome.draft.judgement.overrideReason).toBe(
      "1.1 logMAR は読み直しがあり速度が過大",
    );
  });

  it("読み込んだ状態を書き出すと同じ JSON になる（解析をやり直せる）", () => {
    const original = buildExportJson(judgedResult());
    const outcome = parseExportedSession(original);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const view = deriveSessionView(outcome.draft);
    expect(view.outcome.ok).toBe(true);
    if (!view.outcome.ok) return;

    expect(buildExportJson(view.outcome.result)).toBe(original);
  });

  it("小→大で実施した記録も同じ行に着地する（添字ではなく文字サイズで照合）", () => {
    const reversed = analyze({
      ...workedExampleSession(),
      sequenceDirection: "small_to_large",
      items: [...workedExampleSession().items].reverse(),
    });
    if (!reversed.ok) throw new Error("解析が通らなかった");

    const outcome = parseExportedSession(buildExportJson(reversed.result));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // rows は常にチャート順（大→小）。1.3 logMAR の行に 4.45 秒が入る
    expect(outcome.draft.rows[0]!.chartLogMAR).toBeCloseTo(1.3, 10);
    expect(outcome.draft.rows[0]!.timeText).toBe("4.45");
    expect(outcome.draft.sequenceDirection).toBe("small_to_large");
    expect(toSessionInput(outcome.draft)).toEqual(reversed.result.input);
  });

  it("氏名を持ち込む余地がない（ID までしか戻らない）", () => {
    const outcome = parseExportedSession(buildExportJson(analysed()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.draft.subjectId).toBe("HK");
    expect(Object.keys(outcome.draft)).not.toContain("name");
  });
});

/* ============================================================
   壊れたファイル
   ============================================================ */

describe("読み込みの拒否", () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ["JSON でない", "これは JSON ではない", "JSON として読み取れない"],
    [
      "別形式",
      JSON.stringify({ format: "something-else", result: {} }),
      "本アプリが書き出したファイルではありません",
    ],
    [
      "新しすぎる版",
      JSON.stringify({ format: "mnread-j-analysis", formatVersion: 99, result: {} }),
      "対応していないファイル版",
    ],
    [
      "解析結果がない",
      JSON.stringify({ format: "mnread-j-analysis", formatVersion: 1 }),
      "解析結果（result.input）が入っていません",
    ],
  ];

  for (const [name, text, expected] of cases) {
    it(`${name} → 読める部分だけ入れずに拒否する`, () => {
      const outcome = parseExportedSession(text);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toContain(expected);
    });
  }

  it("チャートにない文字サイズは拒否する", () => {
    const result = analysed();
    const broken = JSON.parse(buildExportJson(result)) as {
      result: { input: { items: { chartLogMAR: number }[] } };
    };
    broken.result.input.items[0]!.chartLogMAR = 2.7;

    const outcome = parseExportedSession(JSON.stringify(broken));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("チャートにない文字サイズ");
  });
});

/* ============================================================
   版の違い
   ============================================================ */

describe("版が異なるファイル", () => {
  it("読むが、値が変わりうることを警告する", () => {
    const old = JSON.parse(buildExportJson(analysed())) as Record<string, unknown>;
    old.specVersion = "0.3.0";
    old.algorithmVersion = "0.2.0";

    const outcome = parseExportedSession(JSON.stringify(old));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.join(" ")).toContain("仕様版が異なります");
    expect(outcome.warnings.join(" ")).toContain("アルゴリズム版が異なります");
  });

  it("判定が入っていないファイルは、その旨を伝える", () => {
    const outcome = parseExportedSession(buildExportJson(analysed()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.join(" ")).toContain("目視判定が記録されていません");
  });
});

/* ============================================================
   画面から
   ============================================================ */

describe("画面からの読み込み", () => {
  it("ファイルを選ぶと検査が復元され、Undo で元に戻せる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const json = buildExportJson(judgedResult());
    const file = new File([json], "mnread_HK_2002-05-18.json", {
      type: "application/json",
    });
    await user.upload(screen.getByTestId("import-file"), file);

    // 読んだ8行 + 不読1行 = 9点
    expect(await screen.findAllByTestId("curve-point")).toHaveLength(9);
    expect(screen.getByTestId("summary-ra")).toHaveTextContent("1.10 logMAR");

    // 判定も戻っている
    await user.click(screen.getByTestId("tab-judge"));
    expect(screen.getByTestId("judgement-state")).toHaveAttribute("data-judged", "true");
    expect(screen.getByTestId("override-reason")).toHaveValue(
      "1.1 logMAR は読み直しがあり速度が過大",
    );

    // 誤って読み込んでも戻せる
    await user.keyboard("{Control>}z{/Control}");
    expect(screen.queryAllByTestId("curve-point")).toHaveLength(0);
  });

  it("壊れたファイルは読み込まず、理由を出す", async () => {
    const user = userEvent.setup();
    render(<App />);

    const file = new File(["{ broken"], "broken.json", { type: "application/json" });
    await user.upload(screen.getByTestId("import-file"), file);

    expect(await screen.findByTestId("import-message")).toHaveTextContent(
      "JSON として読み取れない",
    );
    expect(screen.queryAllByTestId("curve-point")).toHaveLength(0);
  });
});
