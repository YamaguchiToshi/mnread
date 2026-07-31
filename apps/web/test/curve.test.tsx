/**
 * 読書速度曲線の検証（Phase 3）
 *
 * ピクセル比較はしない（PLAN §4）。描画点数・座標・軸範囲・0 cpm と欠測の
 * 描き分けをアサートする。
 */

import { correctedLogMAR, readingSpeedCpm, VARIANT_SPECS } from "@mnread/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";

const J = VARIANT_SPECS["MNREAD-J"];

function timeCell(logMAR: string): HTMLInputElement {
  return screen.getByLabelText(`${logMAR} logMAR の読書時間（秒）`) as HTMLInputElement;
}

function points(): readonly HTMLElement[] {
  return screen.queryAllByTestId("curve-point");
}

function pointFor(rowIndex: number): HTMLElement | undefined {
  return points().find((p) => p.getAttribute("data-row-index") === String(rowIndex));
}

describe("描画点", () => {
  it("入力前は点がない", () => {
    render(<App />);
    expect(points()).toHaveLength(0);
    expect(screen.getByTestId("speed-curve")).toHaveAttribute("data-point-count", "0");
  });

  it("入力と同時に点が増える", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}");
    expect(points()).toHaveLength(1);

    await user.keyboard("5.8{Enter}6.0{Enter}");
    expect(points()).toHaveLength(3);
  });

  it("点の座標は core の値と一致する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2+3{Enter}");

    const point = pointFor(0)!;
    expect(Number(point.getAttribute("data-cpm"))).toBe(readingSpeedCpm(J, 6.2, 3));
    expect(Number(point.getAttribute("data-logmar"))).toBe(
      correctedLogMAR(1.3, 30, J.standardDistanceCm),
    );
  });

  it("距離補正は横軸に効く（cpm には効かない）", async () => {
    const user = userEvent.setup();
    render(<App />);

    const distance = screen.getByLabelText("視距離（cm）");
    await user.clear(distance);
    await user.type(distance, "20");

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}");

    const point = pointFor(0)!;
    expect(Number(point.getAttribute("data-logmar"))).toBe(
      correctedLogMAR(1.3, 20, J.standardDistanceCm),
    );
    // 速度は距離に依存しない
    expect(Number(point.getAttribute("data-cpm"))).toBe(readingSpeedCpm(J, 6.2, 0));
  });
});

describe("0 cpm と欠測の描き分け（ADR-0002 / ADR-0011）", () => {
  it("不読の行は 0 cpm の点として描く", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}*");

    const point = pointFor(1)!;
    expect(Number(point.getAttribute("data-cpm"))).toBe(0);
    expect(point).toHaveClass("point-zero");
  });

  it("対数目盛でも 0 cpm を捨てず、分断した帯に描く", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}5.8{Enter}*");

    // 原典 図4 は 0 cpm 点を落としているが、本実装は帯に描く
    expect(screen.getByTestId("speed-curve")).toHaveAttribute("data-zero-count", "1");
    expect(screen.getByTestId("zero-band")).toBeInTheDocument();

    const zero = pointFor(2)!;
    expect(zero).toHaveAttribute("data-zero", "true");

    // 帯は対数領域より下にあり、正速度の点と重ならない
    const positive = pointFor(0)!;
    expect(Number(zero.getAttribute("cy"))).toBeGreaterThan(
      Number(positive.getAttribute("cy")),
    );
  });

  it("0 cpm 点を折れ線に含めない（対数領域と帯をまたぐ線は意味を持たない）", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}5.8{Enter}*");

    const path = document.querySelector(".curve-line")!;
    const zeroY = Number(pointFor(2)!.getAttribute("cy"));
    expect(path.getAttribute("d")).not.toContain(String(zeroY));
  });

  it("時間未記録の行は描かない", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}");
    await user.keyboard("/3"); // 1.20 の行を「時間未記録」に

    expect(points()).toHaveLength(1);
    expect(pointFor(1)).toBeUndefined();
  });

  it("上位省略の行は描かない（誤り 0 として RA には算入される）", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("/5"); // 上位省略

    expect(points()).toHaveLength(0);
  });

  it("大文字側が読めない行は 0 cpm の点として描き、目視確認を要求する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("/6"); // 大文字側が読めない

    expect(Number(pointFor(0)!.getAttribute("data-cpm"))).toBe(0);
    // フラグは日本語で説明するが、識別子は data 属性で追える形にしてある。
    expect(
      screen.getByTestId("review-flag").querySelector('[data-flag="LARGE_PRINT_FALLOFF"]'),
    ).not.toBeNull();
  });
});

describe("縦軸（SPEC §8.3 / ADR-0011）", () => {
  it("対数目盛。原典 図4 と同じく 1〜1000 cpm を覆う", async () => {
    const user = userEvent.setup();
    render(<App />);

    const svg = () => screen.getByTestId("speed-curve");
    expect(svg()).toHaveAttribute("data-y-bottom-exponent", "0");
    expect(svg()).toHaveAttribute("data-y-top-exponent", "3");

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}"); // 約290 cpm。1000 の桁に収まる
    expect(svg()).toHaveAttribute("data-y-top-exponent", "3");
  });

  it("目盛は対数のみで、線形への切り替えを設けない（判定材料を1つに定める）", () => {
    render(<App />);
    expect(screen.queryByLabelText("線形")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "縦軸の目盛" })).toBeNull();
  });

  it("1 cpm 未満の実測があれば下へ桁を延ばす（目盛の外へ丸め込まない）", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 29文字誤り・60秒 → 1 cpm。さらに遅い例として 120 秒で 0.5 cpm
    await user.click(timeCell("1.30"));
    await user.keyboard("120+29{Enter}");

    expect(screen.getByTestId("speed-curve")).toHaveAttribute(
      "data-y-bottom-exponent",
      "-1",
    );
  });

  it("点の縦位置が対数目盛どおりに置かれる", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 10 / 100 / 1000 cpm ちょうどの点を作る（30文字を 180 / 18 / 1.8 秒）
    await user.click(timeCell("1.30"));
    await user.keyboard("180{Enter}18{Enter}1.8{Enter}");

    const y10 = Number(pointFor(0)!.getAttribute("cy"));
    const y100 = Number(pointFor(1)!.getAttribute("cy"));
    const y1000 = Number(pointFor(2)!.getAttribute("cy"));

    // 1桁ぶんの間隔が等しいこと。線形目盛なら 10→100 と 100→1000 の間隔は
    // 10倍違うので、この等式は対数目盛でしか成り立たない。
    expect(y10 - y100).toBeCloseTo(y100 - y1000, 6);
    expect(y10).toBeGreaterThan(y1000);
  });

  it("横軸は全19段を覆い、点の増減で動かない", async () => {
    const user = userEvent.setup();
    render(<App />);

    const svg = () => screen.getByTestId("speed-curve");
    expect(svg()).toHaveAttribute("data-x-min", "-0.5");
    expect(svg()).toHaveAttribute("data-x-max", "1.3");

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}");

    expect(svg()).toHaveAttribute("data-x-min", "-0.5");
    expect(svg()).toHaveAttribute("data-x-max", "1.3");
  });
});

describe("エラー時の扱い", () => {
  it("測定値そのものは描き続けるが、CPS・MRS は出さない", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}5.8{Enter}6.0{Enter}");
    // 4行目に不正な誤り数を入れる
    await user.keyboard("6.1+35");

    // 生の測定点は残る（曲線の形はその場の判断材料であり、解析結果ではない）
    expect(points().length).toBeGreaterThanOrEqual(3);
    // 解析結果は出さない
    expect(screen.getByTestId("live-summary")).toHaveTextContent("表示しません");
  });
});
