/**
 * 入力画面の組み立て（Phase 3）
 *
 * 判定 UI と出力（電子カルテ文・A4レポート・生データ書き出し）は Phase 4。
 * 本画面は「検査をしながら打つ」ことに専念する。
 */

import { useCallback, useEffect, useMemo, useReducer, useState, type JSX } from "react";

import { IssueList } from "./components/IssueList.js";
import { KeyboardLegend } from "./components/KeyboardLegend.js";
import { LiveSummary } from "./components/LiveSummary.js";
import { ScoreSheet } from "./components/ScoreSheet.js";
import { SessionHeader } from "./components/SessionHeader.js";
import { SpeedCurve } from "./components/SpeedCurve.js";
import { deriveSessionView } from "./session/derive.js";
import { createHistory, reduce } from "./session/reducer.js";
import { entryOrder, hasEnteredData } from "./session/state.js";

export function App(): JSX.Element {
  const [history, dispatch] = useReducer(reduce, undefined, () => createHistory());
  const [openStatusMenuFor, setOpenStatusMenuFor] = useState<number | null>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const draft = history.present;
  const view = useMemo(() => deriveSessionView(draft), [draft]);
  const displayOrder = useMemo(() => entryOrder(draft), [draft]);
  const dirty = hasEnteredData(draft);

  // Undo / Redo は入力欄の中でも効く必要があるため、window で受ける。
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "undo" });
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // データは端末に保存しない設計のため、再読み込みは即座に測定値を失う。
  // 保存で守れない以上、離脱を確認するしかない。
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const resetSession = useCallback(() => {
    if (dirty && !window.confirm("入力内容を破棄して新しい検査を始めますか？")) return;
    dispatch({ type: "resetSession" });
    setFocusedRowIndex(null);
    setOpenStatusMenuFor(null);
    setPaused(false);
  }, [dirty]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>MNREAD-J / Jk 解析</h1>
        <div className="app-actions">
          <button type="button" onClick={() => dispatch({ type: "undo" })} disabled={history.past.length === 0}>
            取り消し
          </button>
          <button type="button" onClick={() => dispatch({ type: "redo" })} disabled={history.future.length === 0}>
            やり直し
          </button>
          <button type="button" onClick={() => setPaused((p) => !p)} data-testid="pause-toggle">
            {paused ? "検査を再開" : "検査を中断"}
          </button>
          <button type="button" onClick={resetSession}>
            新しい検査
          </button>
        </div>
      </header>

      {paused && (
        <p className="paused-banner" data-testid="paused-banner">
          検査を中断しています。入力内容はこのタブが開いているあいだ保持されます
          （端末には保存されません）。
        </p>
      )}

      <main className="app-body">
        <div className="column column-input">
          <SessionHeader draft={draft} dispatch={dispatch} />
          <ScoreSheet
            draft={draft}
            rows={view.rows}
            displayOrder={displayOrder}
            dispatch={dispatch}
            openStatusMenuFor={openStatusMenuFor}
            setOpenStatusMenuFor={setOpenStatusMenuFor}
            focusedRowIndex={focusedRowIndex}
            setFocusedRowIndex={setFocusedRowIndex}
          />
        </div>

        <div className="column column-view">
          <SpeedCurve rows={view.rows} focusedRowIndex={focusedRowIndex} />
          <IssueList draft={draft} view={view} />
          <LiveSummary view={view} />
          <KeyboardLegend />
        </div>
      </main>
    </div>
  );
}
