/**
 * 判定 UI（Phase 4）
 *
 * 見たいのは「検者の操作が SPEC の定義を崩さずに P へ写るか」である。
 *
 *   - 受け取る入力はプラトー点の集合だけで、CPS・MRS はそこから導かれる（ADR-0012）
 *   - CPS 境界の移動が P の張り直しとして働き、MRS も連動する
 *   - 自動値と異なる判定には理由の記録を要求する（SPEC §8.4）
 *   - 外れ値は削除ではなく除外として記録される
 *
 * ドラッグそのもの（ポインタ操作）は jsdom が要素の実寸を持たないため、
 * 同じ経路をキーボードで動かして検証する。つまみは `role="slider"` であり、
 * キーボードで動かせること自体が要件でもある（WCAG 2.1 / PLAN §5）。
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";
import { enterWorkedExample } from "./support/workedExample.js";

async function openJudgement(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await enterWorkedExample(user);
  await user.click(screen.getByTestId("tab-judge"));
  return user;
}

function cpsEstimate(method: string): HTMLElement {
  return screen
    .getAllByTestId("cps-estimate")
    .find((e) => e.getAttribute("data-method") === method)!;
}

function mrsResult(method: string): HTMLElement {
  return screen
    .getAllByTestId("mrs-result")
    .find((e) => e.getAttribute("data-method") === method)!;
}

function point(rowIndex: number): SVGCircleElement {
  return screen
    .getAllByTestId("curve-point")
    .find((p) => p.getAttribute("data-row-index") === String(rowIndex))! as unknown as SVGCircleElement;
}

/** プラトーに入っている行。描画順（文字サイズ順）ではなく行番号順に揃える。 */
function plateauRows(): readonly string[] {
  return screen
    .getAllByTestId("curve-point")
    .filter((p) => p.getAttribute("data-plateau") === "true")
    .map((p) => p.getAttribute("data-row-index")!)
    .sort((a, b) => Number(a) - Number(b));
}

/* ============================================================
   未判定の状態
   ============================================================ */

describe("判定していない状態", () => {
  it("自動値を主値としていることを明示する（黙って主値にしない）", async () => {
    await openJudgement();

    const state = screen.getByTestId("judgement-state");
    expect(state).toHaveAttribute("data-judged", "false");
    expect(state).toHaveTextContent("まだ検者の判定がありません");
    expect(state).toHaveTextContent("SDev法");

    // 自動値であることはグラフの線にも出る
    expect(screen.getByTestId("cps-line")).toHaveAttribute("data-manual", "false");
  });

  it("上書き理由の欄は、上書きが発生するまで書き込めない", async () => {
    await openJudgement();
    expect(screen.getByTestId("override-reason")).toBeDisabled();
    expect(screen.getByTestId("override-state")).toHaveAttribute("data-overrides", "false");
  });
});

/* ============================================================
   プラトーの選択
   ============================================================ */

describe("プラトー点の選択（ADR-0012）", () => {
  it("自動値を採用すると、主値が目視判定になり上書きにはならない", async () => {
    const user = await openJudgement();
    await user.click(screen.getByTestId("adopt-automatic"));

    expect(screen.getByTestId("judgement-state")).toHaveAttribute("data-judged", "true");
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("1.40 logMAR");
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("主値");
    // 自動値と同じプラトーを指しているので上書きではない
    expect(screen.getByTestId("override-state")).toHaveAttribute("data-overrides", "false");
    expect(screen.getByTestId("cps-line")).toHaveAttribute("data-manual", "true");
  });

  it("点をクリックするとプラトーから外れ、CPS と MRS が連動して変わる", async () => {
    const user = await openJudgement();

    // 自動値のプラトーは 1.3 / 1.2 / 1.1（rows 0,1,2）
    expect(plateauRows()).toEqual(["0", "1", "2"]);
    expect(mrsResult("arithmetic")).toHaveTextContent("412 cpm");

    await user.click(point(2)); // 1.1 logMAR を外す

    expect(plateauRows()).toEqual(["0", "1"]);
    // CPS は P の最小 logMAR。1.2 + 0.30 = 1.50
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("1.50 logMAR");
    // MRS は P の平均。(404.49 + 436.89) / 2 = 420.69
    expect(mrsResult("arithmetic")).toHaveTextContent("421 cpm");
    expect(mrsResult("arithmetic")).toHaveTextContent("n=2");
  });

  it("採用した点と採用していない点を、塗りの有無で描き分ける", async () => {
    const user = await openJudgement();

    // 大きさの差だけでは、どれを選んでいるのかがひと目で読めない。
    // 塗りつぶし（採用）と白抜き（不採用）は白黒印刷でも色覚特性があっても残る。
    expect(point(0).getAttribute("class")).toContain("point-plateau");
    expect(point(0).getAttribute("class")).not.toContain("point-outside");
    expect(point(4).getAttribute("class")).toContain("point-outside");
    expect(point(4).getAttribute("class")).not.toContain("point-plateau");

    // 出し入れすると描き分けも入れ替わる
    await user.click(point(2));
    expect(point(2).getAttribute("class")).toContain("point-outside");
    await user.click(point(4));
    expect(point(4).getAttribute("class")).toContain("point-plateau");
  });

  it("凡例で印の意味を示す", async () => {
    await openJudgement();
    const legend = screen.getByTestId("curve-legend");
    expect(legend).toHaveTextContent("プラトーに採用した点");
    expect(legend).toHaveTextContent("採用していない測定点");
    expect(legend).toHaveTextContent("除外として記録した点");
    expect(legend).toHaveTextContent("0 cpm");
  });

  it("入力画面には判定の描き分けも凡例も出さない（まだ判定していない）", () => {
    render(<App />);
    expect(screen.queryByTestId("curve-legend")).toBeNull();
  });

  it("外した点をもう一度押すとプラトーに戻る", async () => {
    const user = await openJudgement();
    await user.click(point(2));
    await user.click(point(2));

    expect(plateauRows()).toEqual(["0", "1", "2"]);
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("1.40 logMAR");
  });

  it("判定を取り消すと未判定に戻り、主値が自動値へ帰る", async () => {
    const user = await openJudgement();
    await user.click(screen.getByTestId("adopt-automatic"));
    await user.click(screen.getByTestId("clear-judgement"));

    expect(screen.getByTestId("judgement-state")).toHaveAttribute("data-judged", "false");
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("推定不能");
  });
});

/* ============================================================
   CPS 境界の移動
   ============================================================ */

describe("CPS 境界の移動", () => {
  it("小文字側へ動かすと、そこまでの連続区間がプラトーになる", async () => {
    const user = await openJudgement();
    const handle = screen.getByTestId("cps-handle");
    handle.focus();
    await user.keyboard("{ArrowLeft}");

    // 1.1 → 1.0 へ。連続区間は 1.3 / 1.2 / 1.1 / 1.0（rows 0..3）
    expect(plateauRows()).toEqual(["0", "1", "2", "3"]);
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("1.30 logMAR");
    // MRS もプラトーの変化に連動する。CPS だけが動くことはない
    expect(mrsResult("arithmetic")).toHaveTextContent("n=4");
  });

  it("大文字側へ動かすとプラトーが縮む", async () => {
    const user = await openJudgement();
    const handle = screen.getByTestId("cps-handle");
    handle.focus();
    await user.keyboard("{ArrowRight}");

    expect(plateauRows()).toEqual(["0", "1"]);
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("1.50 logMAR");
  });

  it("境界上の点はつまみに覆われず、クリックできる", async () => {
    const user = await openJudgement();

    // SVG の当たり判定は描画順で決まる。つまみが点より後に描かれていると、
    // CPS 境界の点（＝いちばん触りたい点）が掴めなくなる。
    const svg = screen.getByTestId("speed-curve");
    const nodes = [...svg.querySelectorAll("[data-testid]")];
    const handleAt = nodes.findIndex((n) => n.getAttribute("data-testid") === "cps-handle");
    const firstPointAt = nodes.findIndex(
      (n) => n.getAttribute("data-testid") === "curve-point",
    );
    expect(handleAt).toBeGreaterThanOrEqual(0);
    expect(handleAt).toBeLessThan(firstPointAt);

    // 実際に境界の点（1.1 logMAR = rows[2]）を押せる
    await user.click(point(2));
    expect(plateauRows()).toEqual(["0", "1"]);
  });

  it("MRS の線にはつまみがない（P の平均であり独立に動かせない）", async () => {
    await openJudgement();
    expect(screen.getByTestId("mrs-line")).toBeInTheDocument();
    expect(screen.queryByTestId("mrs-handle")).toBeNull();
    // つまみは CPS のものだけ
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("MRS の線はプラトーの範囲にだけ引く（全域に延ばさない）", async () => {
    await openJudgement();
    const line = screen.getByTestId("mrs-line").querySelector("line")!;
    const x1 = Number(line.getAttribute("x1"));
    const x2 = Number(line.getAttribute("x2"));

    // 描画領域は x=56〜624。プラトーは 1.3〜1.1 logMAR で、実測は 1.3〜0.5 まである。
    // 大文字側の端（624）に届くのはプラトーが最大サイズを含むためで正しいが、
    // 小文字側は実測の端まで延びてはならない。
    const plotLeft = 56;
    const plotWidth = 624 - plotLeft;
    expect(x1).toBeGreaterThan(plotLeft);
    expect(x2 - x1).toBeLessThan(plotWidth / 2);
  });
});

/* ============================================================
   上書きの記録（SPEC §8.4）
   ============================================================ */

describe("上書きの記録", () => {
  it("自動値と異なる判定に理由がなければ、監査の穴として警告する", async () => {
    const user = await openJudgement();
    await user.click(point(2));

    expect(screen.getByTestId("override-state")).toHaveAttribute("data-overrides", "true");
    const flags = screen.getByTestId("judgement-flags");
    expect(within(flags).getAllByTestId("quality-flag").length).toBeGreaterThan(0);
    expect(flags.querySelector('[data-flag="OVERRIDE_REASON_MISSING"]')).not.toBeNull();
  });

  it("理由を書けば警告が消える", async () => {
    const user = await openJudgement();
    await user.click(point(2));
    await user.type(
      screen.getByTestId("override-reason"),
      "1.1 logMAR は読み直しがあり速度が過大",
    );

    // この判定では他の品質フラグも立たないため、警告の区画ごと消える。
    const flags = screen.queryByTestId("judgement-flags");
    expect(
      flags === null
        ? null
        : flags.querySelector('[data-flag="OVERRIDE_REASON_MISSING"]'),
    ).toBeNull();
    // 上書き自体は成立したままで、理由が状態に残っている
    expect(screen.getByTestId("override-state")).toHaveAttribute("data-overrides", "true");
    expect(screen.getByTestId("override-reason")).toHaveValue(
      "1.1 logMAR は読み直しがあり速度が過大",
    );
  });
});

/* ============================================================
   外れ値の除外
   ============================================================ */

describe("外れ値の除外", () => {
  it("点は消さず、除外として記録する", async () => {
    const user = await openJudgement();
    await user.click(screen.getByTestId("adopt-automatic"));

    const row = screen
      .getAllByTestId("exclusion-row")
      .find((r) => r.getAttribute("data-row-index") === "2")!;
    await user.click(within(row).getByRole("checkbox"));
    await user.type(within(row).getByTestId("exclusion-reason"), "読み直しあり");

    // 点そのものは曲線に残る
    expect(point(2)).toBeInTheDocument();
    expect(point(2)).toHaveAttribute("data-excluded", "true");
    // 除外した点はプラトーから外れ、CPS が動く
    expect(plateauRows()).toEqual(["0", "1"]);
    expect(point(2)).toHaveAttribute("data-plateau", "false");
    expect(cpsEstimate("manual_visual_2002")).toHaveTextContent("1.50 logMAR");
  });
});

/* ============================================================
   読書時間の副グラフ（SPEC §8.3.1、原典 図3）
   ============================================================ */

describe("読書時間の副グラフ", () => {
  it("記録した時間を対数目盛で描き、判定線は引かない", async () => {
    await openJudgement();

    const svg = screen.getByTestId("time-curve");
    // 読んだ8行ぶん。0 cpm の行は読書時間の測定値を持たないので現れない
    expect(svg).toHaveAttribute("data-point-count", "8");
    expect(within(svg).queryByTestId("cps-line")).toBeNull();
    expect(within(svg).queryByTestId("mrs-line")).toBeNull();

    const first = screen
      .getAllByTestId("time-point")
      .find((p) => p.getAttribute("data-row-index") === "0")!;
    expect(first.getAttribute("data-seconds")).toBe("4.45");
  });
});
