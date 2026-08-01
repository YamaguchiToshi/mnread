/**
 * 出力3系統（Phase 4、SPEC §8.2）
 *
 * 出力は「後から読んだ人が、その値の出どころを追えるか」で評価する。
 * したがって主眼は体裁ではなく、次が欠けていないことである。
 *
 *   - CPS には必ず算出法 ID が付く。「CPS 0.6 logMAR」だけの行を作らない（ADR-0006）
 *   - MRS は3方式すべて出る（ADR-0005）
 *   - 測定距離と距離補正が必ず入る（SPEC §8.1）
 *   - 生データは丸めない（ADR-0003）。氏名を含まない（SPEC §8.2.3）
 *   - 判読ゾーンは患者向けレポートにだけ出し、EMR と生データには持ち込まない（ADR-0013）
 */

import { analyze, type AnalysisResult } from "@mnread/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";
import { CPS_METHOD_LABEL } from "../src/labels.js";
import { buildEmrText } from "../src/output/emrText.js";
import {
  buildExportCsv,
  buildExportJson,
  exportFileBaseName,
} from "../src/output/exportData.js";
import { enterCleanTwoLimb } from "./support/cleanCurve.js";
import { enterWorkedExample, workedExampleSession } from "./support/workedExample.js";

/** 原典 §4 の測定例を core に通したもの。検者の判定は入れていない。 */
function workedExampleResult(overrides = {}): AnalysisResult {
  const outcome = analyze(workedExampleSession(), overrides);
  if (!outcome.ok) throw new Error("測定例の解析が通らなかった");
  return outcome.result;
}

/* ============================================================
   電子カルテ用テキスト（SPEC §8.2.1）
   ============================================================ */

describe("電子カルテ用テキスト", () => {
  const text = buildEmrText(workedExampleResult());
  const lines = text.split("\n");

  it("測定距離と距離補正を必ず含む", () => {
    expect(text).toContain("測定距離: 15.0 cm");
    expect(text).toContain("距離補正 +0.30 logMAR");
  });

  it("読書視力を原典の値で出す", () => {
    expect(text).toContain("読書視力 RA: 1.10 logMAR");
    expect(text).toContain("小数視力 0.08");
  });

  it("CPS には必ず算出法が付く（値だけの行を作らない）", () => {
    const methodNames = Object.values(CPS_METHOD_LABEL);
    const bare = lines.filter(
      (line) =>
        line.includes("CPS") &&
        line.includes("logMAR") &&
        // 品質フラグの説明文は CPS の値を報告する行ではない
        // （「算出法によって CPS が 0.2 logMAR を超えて食い違う」など）
        !line.startsWith("  - ") &&
        !methodNames.some((name) => line.includes(name)),
    );
    expect(bare).toEqual([]);
    expect(text).toContain("1.40 logMAR ＝ SDev法 v1（自動）");
  });

  it("目視判定がない場合、自動値が暫定の主値であることを明示する", () => {
    expect(text).toContain("検者の目視判定が未実施のため、自動値を暫定の主値としている");
  });

  it("MRS を3方式とも出す（ADR-0005）", () => {
    expect(text).toContain("プラトー内の算術平均（標準）: 412 cpm");
    expect(text).toContain("平均時間からの換算（原典 §4.4 の計算例）: 411 cpm");
    expect(text).toContain("総正読文字数 ÷ 総時間: 411 cpm");
  });

  it("推奨サイズは CPS 相当と支援余裕を分けて書く（SPEC §5.7）", () => {
    expect(text).toContain("下限");
    expect(text).toContain("CPS 相当。最大速度を支える最小サイズ");
    expect(text).toContain("上限");
    expect(text).toContain("支援余裕 +0.10 logMAR");
    // 1つの推奨値に混ぜていない
    expect(text).not.toMatch(/推奨文字サイズ: *[0-9.]+ pt$/m);
  });

  it("判読ゾーンは持ち込まない（患者向けレポート専用・ADR-0013）", () => {
    expect(text).not.toContain("快適");
    expect(text).not.toContain("努力");
  });

  it("仕様版とアルゴリズム版を必ず添える（SPEC §10）", () => {
    expect(text).toContain("仕様 0.6.0 / アルゴリズム 0.5.0");
  });

  it("上書きした判定は理由つきで残る（SPEC §8.4）", () => {
    const auto = workedExampleResult().cps.find((e) => e.method === "plateau_sdev_v1")!;
    const overridden = buildEmrText(
      workedExampleResult({
        manualPlateau: {
          plateauItemIndices: auto.plateauItemIndices.slice(0, 2),
          excludedItemIndices: [],
          exclusionReasons: {},
        },
        overrideReason: "1.1 logMAR は読み直しがあり速度が過大",
      }),
    );
    expect(overridden).toContain("判定の上書き");
    expect(overridden).toContain("理由: 1.1 logMAR は読み直しがあり速度が過大");
  });

  it("理由のない上書きは、未記録であることを隠さない", () => {
    const auto = workedExampleResult().cps.find((e) => e.method === "plateau_sdev_v1")!;
    const overridden = buildEmrText(
      workedExampleResult({
        manualPlateau: {
          plateauItemIndices: auto.plateauItemIndices.slice(0, 2),
          excludedItemIndices: [],
          exclusionReasons: {},
        },
      }),
    );
    expect(overridden).toContain("理由: （未記録）");
    expect(overridden).toContain("OVERRIDE_REASON_MISSING");
  });
});

/* ============================================================
   生データ書き出し（SPEC §8.2.3）
   ============================================================ */

describe("生データ書き出し", () => {
  const result = workedExampleResult();

  it("CSV は1行 = 1読み材料で、丸めずに書く", () => {
    const csv = buildExportCsv(result);
    // 1.3 logMAR の速度は 404.4943820224719。表示用の 404 に丸めない
    expect(csv).toContain("404.4943820224719");
    expect(csv).not.toMatch(/^0,1\.3,[^,]*,read,4\.45,0,404,/m);
  });

  it("CSV に距離補正と算出法 ID が入る", () => {
    const csv = buildExportCsv(result);
    expect(csv).toContain("viewingDistanceCm,15");
    expect(csv).toContain("distanceCorrectionLogMAR,0.3010299956639812");
    expect(csv).toContain("selectedCpsMethod,plateau_sdev_v1");
    expect(csv).toContain("plateau_sdev_v1,true,1.1,1.4010299956639813");
  });

  it("0 cpm は 0 と書き、欠測は空欄にする（ADR-0002）", () => {
    const csv = buildExportCsv(result);
    const rows = csv.split("\n");
    // 0.5 logMAR は不読 = 測定された 0 cpm。時間と誤り数は持たない
    const unread = rows.find((r) => r.startsWith("8,0.5,"))!;
    expect(unread).toContain("attempted_unread,,,0,");
    // 未提示の行は速度そのものが欠測
    const unpresented = rows.find((r) => r.startsWith("9,0.4,"))!;
    expect(unpresented).toContain("unpresented_after_stop,,,,");
  });

  it("氏名欄を持たない", () => {
    const csv = buildExportCsv(result);
    const json = buildExportJson(result);
    expect(csv).not.toMatch(/\bname\b/i);
    expect(json).not.toMatch(/"(name|patientName|fullName)"/i);
    // ID は残す
    expect(csv).toContain("subjectId,HK");
  });

  it("JSON はフル精度の解析結果をそのまま含む", () => {
    const parsed = JSON.parse(buildExportJson(result)) as {
      specVersion: string;
      result: AnalysisResult;
    };
    expect(parsed.specVersion).toBe("0.6.0");
    // 表示は 1.10 だが、書き出しは倍精度のまま出る（ADR-0003）
    expect(parsed.result.readingAcuity!.raCorrectedLogMAR).toBeCloseTo(
      1.0976966623306477,
      12,
    );
    expect(String(parsed.result.readingAcuity!.raCorrectedLogMAR).length).toBeGreaterThan(
      "1.10".length,
    );
    expect(parsed.result.selection.cpsMethod).toBe("plateau_sdev_v1");
    expect(parsed.result.zones!.cpsMethod).toBe("plateau_sdev_v1");
  });

  it("ファイル名は ID と実施日まで。氏名を使わない", () => {
    expect(exportFileBaseName(result)).toBe("mnread_HK_2002-05-18");
  });

  it("ID も日付もなければ既定名になる", () => {
    const { subject: _omitted, ...anonymous } = workedExampleSession();
    const outcome = analyze(anonymous);
    if (!outcome.ok) throw new Error("解析が通らなかった");
    expect(exportFileBaseName(outcome.result)).toBe("mnread");
  });
});

/* ============================================================
   A4 レポート（SPEC §8.2.2）— 画面を通して確認する
   ============================================================ */

async function openOutput(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await enterWorkedExample(user);
  await user.click(screen.getByTestId("tab-output"));
  return user;
}

describe("A4 患者・支援者向けレポート", () => {
  it("判読ゾーンを3帯で示し、境界を logMAR と pt の両方で書く", async () => {
    await openOutput();

    const rows = screen.getAllByTestId("zone-row");
    expect(rows.map((r) => r.getAttribute("data-zone"))).toEqual([
      "unreadable",
      "effortful",
      "comfortable",
    ]);

    // 快適の下端は CPS そのもの（1.40 logMAR）。CPS + 0.1 ではない（ADR-0013）
    const comfortable = rows.find((r) => r.getAttribute("data-zone") === "comfortable")!;
    expect(comfortable).toHaveTextContent("≧ 1.40");
    expect(comfortable).not.toHaveTextContent("1.50");
    expect(comfortable).toHaveTextContent("pt 以上");

    // 努力ゾーンは RA〜CPS
    const effortful = rows.find((r) => r.getAttribute("data-zone") === "effortful")!;
    expect(effortful).toHaveTextContent("1.10 〜 1.40");
  });

  it("推奨サイズはゾーンとは別枠に出し、下限と余裕を分ける", async () => {
    await openOutput();

    const support = screen.getByTestId("support-range");
    expect(support).toHaveTextContent("下限");
    expect(support).toHaveTextContent("ゆとりを見る場合");
    expect(support).toHaveTextContent("1.26 倍");
    // ゾーンの表とは別の区画である
    expect(within(support).queryByTestId("zone-table")).toBeNull();
  });

  it("CPS の算出法をレポート本文に残す", async () => {
    await openOutput();
    expect(screen.getByTestId("patient-report")).toHaveTextContent("SDev法 v1（自動）");
  });

  it("氏名欄を持たず、その旨を明記する", async () => {
    await openOutput();
    const report = screen.getByTestId("patient-report");
    expect(report).toHaveTextContent("氏名は記載していません");
    expect(within(report).queryByLabelText(/氏名/)).toBeNull();
  });

  it("参考値であり診断ではない旨と、pt がフォント依存である旨を載せる", async () => {
    await openOutput();
    const report = screen.getByTestId("patient-report");
    expect(report).toHaveTextContent("参考値");
    expect(report).toHaveTextContent("診断ではありません");
    expect(report).toHaveTextContent("書体（フォント）によって");
    expect(report).toHaveTextContent("アルゴリズム 0.5.0");
  });

  it("曲線をレポートに含める（印刷でベクタのまま出す）", async () => {
    await openOutput();
    const report = screen.getByTestId("patient-report");
    expect(within(report).getByTestId("speed-curve")).toBeInTheDocument();
    expect(within(report).getByTestId("cps-line")).toBeInTheDocument();
  });
});

/* ============================================================
   出力画面そのもの
   ============================================================ */

describe("出力画面", () => {
  it("入力エラーがある間は出力を作らない（ADR-0004）", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText("1.30 logMAR の読書時間（秒）"));
    await user.keyboard("0"); // t <= 0 は入力エラー
    await user.click(screen.getByTestId("tab-output"));

    expect(screen.getByTestId("output-panel")).toHaveTextContent(
      "入力エラーがあるため出力を作成しません",
    );
    expect(screen.queryByTestId("emr-text")).toBeNull();
    expect(screen.queryByTestId("patient-report")).toBeNull();
  });

  it("品質フラグがなければ警告を出さない", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterCleanTwoLimb(user);
    await user.click(screen.getByTestId("tab-output"));

    expect(screen.queryByTestId("output-review-warning")).toBeNull();
  });

  it("測定例は指数フィットとの食い違いで目視確認を求める（出荷既定・SPEC §5.5.1）", async () => {
    // 出荷既定に `expdecay_90` が入ったことで、原典 §4 の測定例にも
    // CPS_METHOD_DISAGREEMENT が立つ。指数減衰モデルが二肢曲線に適合せず、
    // 90% 到達サイズを実測範囲の外（1.61 logMAR、SDev は 1.40）へ押し出すため。
    // 過剰警告側であり、主値（1.40 logMAR / SDev法）は変わらない。
    // 閾値 0.2 logMAR の較正は実測20〜30例で行う（OPEN-6）。
    await openOutput();

    expect(screen.getByTestId("output-review-warning")).toBeInTheDocument();
    expect(screen.getByTestId("emr-text")).toHaveTextContent(
      "CPS_METHOD_DISAGREEMENT",
    );
    expect(screen.getByTestId("emr-text")).toHaveTextContent(
      "1.40 logMAR ＝ SDev法 v1（自動）",
    );
  });

  it("目視確認が必要な場合、出力前に警告する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterWorkedExample(user);

    // 自動値と異なる判定を、理由を書かずに採る（監査の穴）
    await user.click(screen.getByTestId("tab-judge"));
    await user.click(
      screen
        .getAllByTestId("curve-point")
        .find((p) => p.getAttribute("data-row-index") === "2")!,
    );
    await user.click(screen.getByTestId("tab-output"));

    expect(screen.getByTestId("output-review-warning")).toBeInTheDocument();
    // 出力そのものは止めない。値は正しく、欠けているのは理由の記録である
    expect(screen.getByTestId("emr-text")).toBeInTheDocument();
  });

  it("電子カルテ文をそのまま画面から取れる", async () => {
    await openOutput();
    const textarea = screen.getByTestId("emr-text") as HTMLTextAreaElement;
    expect(textarea.value).toContain("■ MNREAD-J 読書評価");
    expect(textarea.value).toContain("1.40 logMAR ＝ SDev法 v1（自動）");
    expect(textarea).toHaveAttribute("readonly");
  });
});
