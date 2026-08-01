/**
 * 19行スコアシート（Phase 3）
 *
 * 検者は検査をしながら打つ。検査後にまとめて転記する運用を前提にしない（PLAN Phase 3）。
 * したがって操作はテンキーだけで完結する必要がある:
 *
 *   Enter … 確定して次の行の時間へ（誤り数は既定 0 のまま飛ばせる）
 *   +     … 同じ行の誤り数欄へ
 *   *     … この行を「不読（0 cpm）」に
 *   /     … 状態メニューを開く（1〜6 で選択、Esc で戻る。他所を触れば閉じる）
 *   ↑↓   … 上下の行の同じ欄へ
 *
 * 表示する cpm・補正後 logMAR はすべて core の返り値である（ADR-0010）。
 * 入力エラーは黙って丸めず、その場で赤く出す（ADR-0004）。
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
} from "react";

import type { ItemStatus } from "@mnread/core";

import { formatCpm, formatLogMAR } from "../format.js";
import type { RowView } from "../session/derive.js";
import type { Action } from "../session/reducer.js";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_SHORT,
  isCellEnabled,
  type CellField,
  type SessionDraft,
} from "../session/state.js";

export interface ScoreSheetProps {
  readonly draft: SessionDraft;
  readonly rows: readonly RowView[];
  /** 検査実施順に並べた rows の添字 */
  readonly displayOrder: readonly number[];
  readonly dispatch: (action: Action) => void;
  readonly openStatusMenuFor: number | null;
  readonly setOpenStatusMenuFor: (rowIndex: number | null) => void;
  readonly focusedRowIndex: number | null;
  readonly setFocusedRowIndex: (rowIndex: number | null) => void;
}

function cellId(rowIndex: number, field: CellField): string {
  return `${rowIndex}:${field}`;
}

export function ScoreSheet({
  draft,
  rows,
  displayOrder,
  dispatch,
  openStatusMenuFor,
  setOpenStatusMenuFor,
  focusedRowIndex,
  setFocusedRowIndex,
}: ScoreSheetProps): JSX.Element {
  const cells = useRef(new Map<string, HTMLInputElement>());

  const registerCell = useCallback(
    (rowIndex: number, field: CellField) => (el: HTMLInputElement | null) => {
      const key = cellId(rowIndex, field);
      if (el === null) cells.current.delete(key);
      else cells.current.set(key, el);
    },
    [],
  );

  const focusCell = useCallback((rowIndex: number, field: CellField): boolean => {
    const el = cells.current.get(cellId(rowIndex, field));
    if (el === undefined || el.disabled) return false;
    el.focus();
    el.select();
    return true;
  }, []);

  /** 表示順で `step` 行ずれた位置の同じ欄へ。端では動かない。 */
  const moveRow = useCallback(
    (rowIndex: number, step: number, field: CellField): void => {
      const position = displayOrder.indexOf(rowIndex);
      const target = displayOrder[position + step];
      if (target === undefined) return;
      // 移動先の欄が編集不可なら時間欄に落とす（未提示の行など）。
      if (!focusCell(target, field)) focusCell(target, "time");
      setFocusedRowIndex(target);
    },
    [displayOrder, focusCell, setFocusedRowIndex],
  );

  /**
   * 再描画のあとで移す焦点。
   *
   * 状態を変えると、その行のどの欄が使えるかが変わる（「時間未記録」なら時間欄は
   * 閉じ、誤り数欄が開く）。描画前の DOM を見て焦点を決めると閉じた欄を掴むため、
   * 確定後に決める。メニューを消しながら焦点を動かす React の警告も同時に消える。
   */
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);

  useEffect(() => {
    if (pendingFocus === null) return;
    // 時間 → 誤り数 → 次の行、の順に、その行で操作を続けられる欄を探す。
    if (!focusCell(pendingFocus, "time") && !focusCell(pendingFocus, "errors")) {
      moveRow(pendingFocus, 1, "time");
    }
    setPendingFocus(null);
  }, [focusCell, moveRow, pendingFocus]);

  const closeStatusMenu = useCallback(
    (rowIndex: number): void => {
      setOpenStatusMenuFor(null);
      setPendingFocus(rowIndex);
    },
    [setOpenStatusMenuFor],
  );

  /**
   * メニューを閉じるだけ。焦点は動かさない。
   *
   * 検者が別の欄を触ったときに使う。ここで `closeStatusMenu` と同じように
   * 焦点を引き戻すと、触った先から焦点を奪い返すことになる。
   */
  const dismissStatusMenu = useCallback((): void => {
    setOpenStatusMenuFor(null);
  }, [setOpenStatusMenuFor]);

  const handleKeyDown = useCallback(
    (rowIndex: number, field: CellField) =>
      (event: KeyboardEvent<HTMLInputElement>): void => {
        // Undo/Redo はアプリ全体で受けるため、ここでは触らない。
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        switch (event.key) {
          case "Enter":
            event.preventDefault();
            moveRow(rowIndex, 1, "time");
            return;

          case "+":
            event.preventDefault();
            if (field === "time") {
              // 誤り数欄が使えない状態（不読など）では移動先がないので次行へ。
              if (!focusCell(rowIndex, "errors")) moveRow(rowIndex, 1, "time");
            } else {
              moveRow(rowIndex, 1, "time");
            }
            return;

          case "-":
            event.preventDefault();
            if (field === "errors") focusCell(rowIndex, "time");
            else moveRow(rowIndex, -1, "time");
            return;

          case "*":
            event.preventDefault();
            dispatch({ type: "setStatus", row: rowIndex, status: "attempted_unread" });
            moveRow(rowIndex, 1, "time");
            return;

          case "/":
            event.preventDefault();
            setOpenStatusMenuFor(rowIndex);
            return;

          case "ArrowDown":
            event.preventDefault();
            moveRow(rowIndex, 1, field);
            return;

          case "ArrowUp":
            event.preventDefault();
            moveRow(rowIndex, -1, field);
            return;

          case "Backspace": {
            // 空欄でさらに消そうとしたら、前の行に戻る。打ち間違いの訂正動線。
            const target = event.currentTarget;
            if (target.value === "") {
              event.preventDefault();
              moveRow(rowIndex, -1, "time");
            }
            return;
          }

          default:
            return;
        }
      },
    [dispatch, focusCell, moveRow, setOpenStatusMenuFor],
  );

  const handleStatusMenuKey = useCallback(
    (rowIndex: number) =>
      (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeStatusMenu(rowIndex);
          return;
        }
        const choice = Number(event.key);
        if (!Number.isInteger(choice) || choice < 1 || choice > STATUS_ORDER.length) return;
        event.preventDefault();
        dispatch({
          type: "setStatus",
          row: rowIndex,
          status: STATUS_ORDER[choice - 1]!,
        });
        closeStatusMenu(rowIndex);
      },
    [closeStatusMenu, dispatch],
  );

  return (
    <table className="score-sheet" data-testid="score-sheet">
      <caption>
        スコアシート（{draft.variant}・
        {draft.sequenceDirection === "large_to_small" ? "大→小" : "小→大"}の順）
      </caption>
      <thead>
        {/*
          列を由来でまとめる。3列はチャートが決めた値、続く列は検者が記録した値、
          最後の1列は算出された値である。どれを直せばどれが動くのかが、
          見出しを見ただけで分かるようにしておく。
        */}
        <tr className="group-head">
          <th scope="colgroup" colSpan={3}>
            チャート
          </th>
          <th
            scope="colgroup"
            colSpan={draft.perRowDistance ? 4 : 3}
            className="group-rule"
            data-group="entry"
          >
            記録
          </th>
          <th scope="colgroup" className="group-rule num" data-group="derived">
            算出
          </th>
        </tr>
        <tr className="col-head">
          <th scope="col" className="num">
            #
          </th>
          <th scope="col" className="num">
            logMAR
          </th>
          <th scope="col" className="num">
            補正後
          </th>
          <th scope="col" className="group-rule">
            時間（秒）
          </th>
          <th scope="col">誤り</th>
          {draft.perRowDistance && <th scope="col">距離（cm）</th>}
          <th scope="col">状態</th>
          <th scope="col" className="group-rule num">
            cpm
          </th>
        </tr>
      </thead>
      <tbody>
        {displayOrder.map((rowIndex, position) => {
          const row = rows[rowIndex]!;
          const timeEnabled = isCellEnabled(row.status, "time");
          const errorsEnabled = isCellEnabled(row.status, "errors");
          const errorMessages = row.issues
            .filter((i) => i.severity === "error")
            .map((i) => i.message);

          const valueRow = (
            <tr
              key={row.chartLogMAR}
              className={[
                "row",
                row.hasError ? "row-error" : "",
                row.touched ? "row-touched" : "row-idle",
                rowIndex === focusedRowIndex ? "row-focused" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid="score-row"
              data-row-index={rowIndex}
              data-status={row.status}
            >
              <td className="num col-index">{position + 1}</td>
              <td className="num col-logmar">{formatLogMAR(row.chartLogMAR)}</td>
              <td className="num muted">{formatLogMAR(row.correctedLogMAR)}</td>

              <td className="group-rule cell-td">
                <input
                  ref={registerCell(rowIndex, "time")}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="cell"
                  aria-label={`${formatLogMAR(row.chartLogMAR)} logMAR の読書時間（秒）`}
                  aria-invalid={errorMessages.length > 0}
                  disabled={!timeEnabled}
                  value={row.draft.timeText}
                  onFocus={() => setFocusedRowIndex(rowIndex)}
                  onChange={(e) =>
                    dispatch({
                      type: "setCell",
                      row: rowIndex,
                      field: "time",
                      text: e.target.value,
                    })
                  }
                  onKeyDown={handleKeyDown(rowIndex, "time")}
                />
              </td>

              <td className="cell-td">
                <input
                  ref={registerCell(rowIndex, "errors")}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="cell cell-narrow"
                  aria-label={`${formatLogMAR(row.chartLogMAR)} logMAR の読み損じ文字数`}
                  aria-invalid={errorMessages.length > 0}
                  disabled={!errorsEnabled}
                  value={row.draft.errorText}
                  onFocus={() => setFocusedRowIndex(rowIndex)}
                  onChange={(e) =>
                    dispatch({
                      type: "setCell",
                      row: rowIndex,
                      field: "errors",
                      text: e.target.value,
                    })
                  }
                  onKeyDown={handleKeyDown(rowIndex, "errors")}
                />
              </td>

              {draft.perRowDistance && (
                <td className="cell-td">
                  <input
                    ref={registerCell(rowIndex, "distance")}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="cell cell-narrow"
                    aria-label={`${formatLogMAR(row.chartLogMAR)} logMAR の視距離（cm）`}
                    placeholder={draft.distanceText}
                    value={row.draft.distanceText}
                    onFocus={() => setFocusedRowIndex(rowIndex)}
                    onChange={(e) =>
                      dispatch({
                        type: "setCell",
                        row: rowIndex,
                        field: "distance",
                        text: e.target.value,
                      })
                    }
                    onKeyDown={handleKeyDown(rowIndex, "distance")}
                  />
                </td>
              )}

              <td className="status-cell">
                <button
                  type="button"
                  className="status-button"
                  data-status={row.status}
                  aria-haspopup="listbox"
                  aria-expanded={openStatusMenuFor === rowIndex}
                  aria-label={`${formatLogMAR(row.chartLogMAR)} logMAR の状態：${STATUS_LABEL[row.status]}`}
                  onClick={() =>
                    setOpenStatusMenuFor(openStatusMenuFor === rowIndex ? null : rowIndex)
                  }
                >
                  {STATUS_SHORT[row.status]}
                </button>

                {openStatusMenuFor === rowIndex && (
                  <StatusMenu
                    currentStatus={row.status}
                    onKeyDown={handleStatusMenuKey(rowIndex)}
                    onSelect={(status) => {
                      dispatch({ type: "setStatus", row: rowIndex, status });
                      closeStatusMenu(rowIndex);
                    }}
                    onDismiss={dismissStatusMenu}
                  />
                )}
              </td>

              <td className="num cpm group-rule" data-testid="cpm-cell">
                {formatCpm(row.speedCpm)}
              </td>
            </tr>
          );

          // エラー文は行内ではなく直下の行に置く。セル内に入れると文字数で
          // 列幅が動き、入力中に表がずれて打ちにくくなる。
          //
          // エラーの有無にかかわらず Fragment で包む。包みを付け外しすると
          // その位置の要素型が変わり、React が行ごと作り直して入力欄の焦点が
          // 飛ぶ。打っている最中にエラーが出た瞬間に起きるため実害が大きい。
          return (
            <Fragment key={row.chartLogMAR}>
              {valueRow}
              {errorMessages.length > 0 && (
                <tr className="row-error">
                  <td colSpan={draft.perRowDistance ? 8 : 7}>
                    <ul className="row-errors" data-testid="row-errors">
                      {errorMessages.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * 状態メニュー。開いた直後に自分へ焦点を移し、数字キーを受けられるようにする。
 *
 * 焦点の移動を描画中ではなく副作用で行うのは、React が描画途中の焦点移動を
 * 警告するためであり、動作上も確定後のほうが素直である。
 *
 * **他所を触ったら閉じる。** 選択を促すために開きっぱなしにすると、値を直して
 * いる最中や誤って開いてしまったときに、メニューが表に覆いかぶさったまま残る。
 * 閉じ方は2つあり、片方だけでは足りない。
 *
 *   - 焦点が外へ出た（`focusout`）… 別の欄をクリックした / Tab で抜けた場合。
 *     `relatedTarget` が null のときは閉じない。Safari はボタンを押しても焦点を
 *     移さないため、選択肢の click が届く前に消えてしまう
 *   - メニューの外を押した（`pointerdown`）… 焦点を持たない場所を押した場合。
 *     判定は状態セル全体で行う。トグルのボタンを含めておかないと、閉じた直後に
 *     ボタンの click が開き直して閉じられなくなる
 */
function StatusMenu({
  currentStatus,
  onKeyDown,
  onSelect,
  onDismiss,
}: {
  readonly currentStatus: ItemStatus;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onSelect: (status: ItemStatus) => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      const menu = ref.current;
      if (menu === null) return;
      const scope = menu.closest(".status-cell") ?? menu;
      if (!(event.target instanceof Node) || !scope.contains(event.target)) onDismiss();
    };
    // pointerdown が来ない環境のために mousedown も見る。二重に呼ばれても
    // 閉じるだけなので害はない。
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onDismiss]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next === null) return;
    const scope = event.currentTarget.closest(".status-cell") ?? event.currentTarget;
    if (!scope.contains(next)) onDismiss();
  };

  return (
    <div
      ref={ref}
      className="status-menu"
      role="listbox"
      aria-label="読み材料の状態"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={handleBlur}
    >
      {STATUS_ORDER.map((status, i) => (
        <button
          key={status}
          type="button"
          role="option"
          aria-selected={currentStatus === status}
          className="status-option"
          onClick={() => onSelect(status)}
        >
          <span className="key-hint">{i + 1}</span>
          {STATUS_LABEL[status]}
        </button>
      ))}
    </div>
  );
}
