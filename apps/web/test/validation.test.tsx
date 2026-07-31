/**
 * 入力エラーの扱い（ADR-0004）
 *
 * 「拒否する。黙って丸めない。補完しない。」が守られていることを確かめる。
 * 試作は誤り数が n0 を超えたとき Math.max(0, cpm) で 0 に丸めていた。
 * そこがまさにここで潰したい挙動である。
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";

function timeCell(logMAR: string): HTMLInputElement {
  return screen.getByLabelText(`${logMAR} logMAR の読書時間（秒）`) as HTMLInputElement;
}

function displayRow(position: number): HTMLElement {
  return screen.getAllByTestId("score-row")[position]!;
}

describe("誤り数が n0 を超える場合", () => {
  it("エラーとして拒否し、cpm を 0 に丸めない", async () => {
    const user = userEvent.setup();
    render(<App />);

    // MNREAD-J の n0 は 30。35 は入力エラーである
    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+35");

    expect(within(displayRow(0)).getByTestId("cpm-cell")).toHaveTextContent("—");
    // エラー文は列幅を動かさないよう、行の直下に別行として出す
    expect(screen.getByTestId("row-errors")).toHaveTextContent("0〜30");
    expect(screen.getByTestId("error-list")).toBeInTheDocument();
  });

  it("n0 ちょうど（全文字読み損じ）は正当な入力で、0 cpm になる", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+30");

    expect(within(displayRow(0)).getByTestId("cpm-cell")).toHaveTextContent("0");
    expect(screen.queryByTestId("error-list")).toBeNull();
  });
});

describe("読書時間が正でない場合", () => {
  it("0 秒はエラーになる", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("0");

    expect(screen.getByTestId("error-list")).toHaveTextContent("正の数");
    expect(within(displayRow(0)).getByTestId("cpm-cell")).toHaveTextContent("—");
  });

  it("負の秒数はエラーになる", async () => {
    const user = userEvent.setup();
    render(<App />);

    // − はキー操作に割り当てているため、値としては貼り付けで入る経路を模す
    await user.click(timeCell("1.30"));
    await user.paste("-3");

    expect(screen.getByTestId("error-list")).toHaveTextContent("正の数");
  });
});

describe("エラーがある間の表示", () => {
  it("解析結果を一切出さない（部分的な結果を返さない）", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0{Enter}5.8{Enter}6.1{Enter}6.0{Enter}5.9{Enter}");
    expect(screen.getByTestId("live-summary")).not.toHaveTextContent("表示しません");

    // 1行だけ壊す
    await user.click(timeCell("1.00"));
    await user.keyboard("{Control>}a{/Control}0");

    expect(screen.getByTestId("live-summary")).toHaveTextContent(
      "入力エラーがあるため、解析結果を表示しません",
    );
    expect(screen.queryByTestId("summary-ra")).toBeNull();
  });

  it("全行のエラーを同時に出す（最初の1件で打ち切らない）", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+35{Enter}");
    await user.click(timeCell("1.20"));
    await user.keyboard("0");

    const errors = within(screen.getByTestId("error-list")).getAllByRole("listitem");
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("error-list")).toHaveTextContent("1.30 logMAR の行");
    expect(screen.getByTestId("error-list")).toHaveTextContent("1.20 logMAR の行");
  });

  it("エラーを直せば結果が戻る", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+35");
    expect(screen.getByTestId("error-list")).toBeInTheDocument();

    await user.keyboard("{Control>}a{/Control}3");
    expect(screen.queryByTestId("error-list")).toBeNull();
  });
});

describe("入力途中のエラー表示", () => {
  it("エラーが出た瞬間も焦点を失わず、続きを打てる", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 「0.5」秒は最初の1打鍵の時点では「時間が 0」というエラーになる。
    // ここでエラー行の出現が行を作り直すと焦点が飛び、続きが打てなくなる。
    await user.click(timeCell("1.30"));
    await user.keyboard("0");
    expect(screen.getByTestId("error-list")).toBeInTheDocument();
    expect(timeCell("1.30")).toHaveFocus();

    await user.keyboard(".5");
    expect(timeCell("1.30")).toHaveValue("0.5");
    expect(screen.queryByTestId("error-list")).toBeNull();
  });

  it("エラー行を出しても入力欄の列幅が変わらない", async () => {
    const user = userEvent.setup();
    render(<App />);

    const width = () => timeCell("1.20").getBoundingClientRect().width;
    const before = width();

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+35");

    expect(screen.getByTestId("row-errors")).toBeInTheDocument();
    expect(width()).toBe(before);
  });
});

describe("視距離", () => {
  it("0 cm はセッション全体のエラーになる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const distance = screen.getByLabelText("視距離（cm）");
    await user.clear(distance);
    await user.type(distance, "0");

    expect(screen.getByTestId("error-list")).toHaveTextContent("測定距離は正の数");
  });

  it("標準外の距離では補正後 logMAR が core の値どおりに動く", async () => {
    const user = userEvent.setup();
    render(<App />);

    const distance = screen.getByLabelText("視距離（cm）");
    await user.clear(distance);
    await user.type(distance, "15");

    // log10(30/15) = 0.3010… → 1.3 + 0.30 = 1.60
    expect(displayRow(0)).toHaveTextContent("1.60");
  });
});

describe("生理的にありえない値", () => {
  it("警告は出すが、記録は拒否も削除もしない", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("0.5");

    expect(screen.getByTestId("warning-list")).toHaveTextContent("速すぎます");
    // 値は残り、cpm も算出される（error ではないため）
    expect(timeCell("1.30")).toHaveValue("0.5");
    expect(within(displayRow(0)).getByTestId("cpm-cell")).toHaveTextContent("3600");
  });
});
