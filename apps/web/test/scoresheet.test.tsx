/**
 * 入力操作の検証（Phase 3）
 *
 * ここで確かめたいのは「検査をしながらテンキーだけで打てるか」である。
 * cpm 列の値は core の返り値と一致していなければならない（ADR-0010: UI で計算しない）。
 */

import { readingSpeedCpm, VARIANT_SPECS } from "@mnread/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";

const J = VARIANT_SPECS["MNREAD-J"];

function timeCell(logMAR: string): HTMLInputElement {
  return screen.getByLabelText(`${logMAR} logMAR の読書時間（秒）`) as HTMLInputElement;
}

function errorCell(logMAR: string): HTMLInputElement {
  return screen.getByLabelText(`${logMAR} logMAR の読み損じ文字数`) as HTMLInputElement;
}

function row(logMARIndex: number): HTMLElement {
  return screen.getAllByTestId("score-row")[logMARIndex]!;
}

function cpmOf(rowIndex: number): string {
  return within(row(rowIndex)).getByTestId("cpm-cell").textContent ?? "";
}

describe("スコアシートの体裁", () => {
  it("19行を大→小の順に表示する", () => {
    render(<App />);
    const rows = screen.getAllByTestId("score-row");
    expect(rows).toHaveLength(19);
    expect(rows[0]).toHaveAttribute("data-row-index", "0");
    expect(rows[18]).toHaveAttribute("data-row-index", "18");
  });

  it("未提示の行の cpm は「—」であり「0」ではない（ADR-0002）", () => {
    render(<App />);
    expect(cpmOf(0)).toBe("—");
  });
});

describe("テンキーだけの入力", () => {
  it("時間 → Enter で次の行の時間欄に移り、cpm が core の値で埋まる", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}");

    expect(timeCell("1.20")).toHaveFocus();
    expect(cpmOf(0)).toBe(String(Math.round(readingSpeedCpm(J, 6.2, 0))));
  });

  it("誤り数を打たずに Enter だけで進める（既定 0）", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}5.8{Enter}6.0{Enter}");

    expect(timeCell("1.00")).toHaveFocus();
    expect(cpmOf(0)).toBe(String(Math.round(readingSpeedCpm(J, 6.2, 0))));
    expect(cpmOf(1)).toBe(String(Math.round(readingSpeedCpm(J, 5.8, 0))));
    expect(cpmOf(2)).toBe(String(Math.round(readingSpeedCpm(J, 6.0, 0))));
  });

  it("+ で同じ行の誤り数欄に移り、Enter で次の行へ進む", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+3{Enter}");

    expect(timeCell("1.20")).toHaveFocus();
    expect(errorCell("1.30")).toHaveValue("3");
    expect(cpmOf(0)).toBe(String(Math.round(readingSpeedCpm(J, 6.0, 3))));
  });

  it("+ は入力欄に文字として入らない", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+");

    expect(timeCell("1.30")).toHaveValue("6.0");
  });

  it("− で1つ前の欄に戻る", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0+3-");

    expect(timeCell("1.30")).toHaveFocus();
  });

  it("* でその行を「不読」にし、0 cpm として記録して次の行へ進む", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("*");

    expect(row(0)).toHaveAttribute("data-status", "attempted_unread");
    // 0 cpm は測定された事実であり、欠測の「—」とは違う（ADR-0002）
    expect(cpmOf(0)).toBe("0");
    expect(timeCell("1.20")).toHaveFocus();
  });

  it("↑↓ で上下の行の同じ欄に移る", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0{ArrowDown}5.5{ArrowUp}");

    expect(timeCell("1.30")).toHaveFocus();
    expect(timeCell("1.20")).toHaveValue("5.5");
  });

  it("空欄で Backspace を押すと前の行に戻る", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0{Enter}{Backspace}");

    expect(timeCell("1.30")).toHaveFocus();
  });

  it("最終行で Enter を押しても移動先がなく、値は保たれる", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("-0.50"));
    await user.keyboard("20{Enter}");

    expect(timeCell("-0.50")).toHaveValue("20");
  });
});

describe("状態メニュー", () => {
  it("/ で開き、数字キーで状態を選び、時間欄に戻る", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("/");
    expect(screen.getByRole("listbox", { name: "読み材料の状態" })).toBeTruthy();

    // 3 =「時間未記録」。この状態では時間欄が閉じるため、焦点は誤り数欄に移る
    await user.keyboard("3");
    expect(row(0)).toHaveAttribute("data-status", "presented_time_missing");
    expect(errorCell("1.30")).toHaveFocus();
  });

  it("時間欄が使える状態を選んだときは時間欄に戻る", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("/2"); // 不読
    expect(row(0)).toHaveAttribute("data-status", "attempted_unread");
    // 不読の行はどちらの欄も使えないので、次の行へ送る
    expect(timeCell("1.20")).toHaveFocus();
  });

  it("Esc で状態を変えずに閉じる", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0/");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(row(0)).toHaveAttribute("data-status", "read");
  });

  it("別の欄をクリックしたら閉じる（焦点は奪い返さない）", async () => {
    // 値を直している最中や、誤って開いてしまったときに、表に覆いかぶさったまま
    // 残らないこと。閉じるだけで、触った先から焦点を取り上げない。
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.0{Enter}5.8"); // 打ち終えた行を後から触る場面
    await user.keyboard("/");
    expect(screen.getByRole("listbox", { name: "読み材料の状態" })).toBeTruthy();

    await user.click(timeCell("1.30"));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(timeCell("1.30")).toHaveFocus();
    // 開いただけでは状態を変えない
    expect(row(1)).toHaveAttribute("data-status", "read");
  });

  it("メニューの外を押したら閉じる", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("/");
    await user.click(screen.getByTestId("score-sheet").querySelector("caption")!);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("同じ行の状態ボタンで開閉できる（外側判定に巻き込まれない）", async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = within(row(0)).getByRole("button", { name: /の状態：/ });
    await user.click(button);
    expect(screen.getByRole("listbox", { name: "読み材料の状態" })).toBeTruthy();

    await user.click(button);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("クリックで選んだ状態が反映される", async () => {
    // 選択肢を押すと、閉じる処理に先回りされて click が届かない、という壊れ方を防ぐ。
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(row(0)).getByRole("button", { name: /の状態：/ }));
    await user.click(screen.getByRole("option", { name: /不読/ }));

    expect(row(0)).toHaveAttribute("data-status", "attempted_unread");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("「時間未記録」の行は時間欄が使えず、誤り数だけを記録する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("/3");

    expect(timeCell("1.30")).toBeDisabled();
    expect(errorCell("1.30")).toBeEnabled();
    // 速度は欠測。0 cpm ではない
    expect(cpmOf(0)).toBe("—");
  });
});

describe("Undo", () => {
  it("Ctrl+Z で直前の行の入力を取り消す", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}5.8{Enter}");
    await user.keyboard("{Control>}z{/Control}");

    expect(timeCell("1.20")).toHaveValue("");
    expect(timeCell("1.30")).toHaveValue("6.2");
  });

  it("Ctrl+Shift+Z でやり直す", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(timeCell("1.30"));
    await user.keyboard("6.2{Enter}");
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");

    expect(timeCell("1.30")).toHaveValue("6.2");
  });
});

describe("小→大の実施順", () => {
  it("実施順で並べ替えて表示し、注意を出す", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText("実施順"), "small_to_large");

    const rows = screen.getAllByTestId("score-row");
    expect(rows[0]).toHaveAttribute("data-row-index", "18");
    expect(rows[18]).toHaveAttribute("data-row-index", "0");
    expect(screen.getByTestId("reverse-order-notice")).toBeTruthy();
  });

  it("Enter は実施順の次の行（1段大きい文字）へ進む", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText("実施順"), "small_to_large");
    await user.click(timeCell("-0.50"));
    await user.keyboard("20{Enter}");

    expect(timeCell("-0.40")).toHaveFocus();
  });
});
