/**
 * 書き出した JSON の読み込み（SPEC §8.2.3）
 *
 * 検者がファイルを選んだときだけ動く。ドラッグ＆ドロップも自動読み込みもしない
 * （患者データが意図せず載る経路を作らない）。読み込みはブラウザ内で完結し、
 * 外部へは何も送らない。
 *
 * 壊れたファイルは読める部分だけ入れずに拒否し、理由を出す。半分だけ入った検査は
 * 入力途中の検査と見分けがつかないためである。
 */

import { useId, useRef, useState, type Dispatch, type JSX } from "react";

import { parseExportedSession } from "../output/importData.js";
import type { Action } from "../session/reducer.js";

export interface SessionImportProps {
  readonly dispatch: Dispatch<Action>;
  /** 入力中のデータがあるか。あれば読み込み前に確認する */
  readonly dirty: boolean;
  /** 読み込み成功後に画面状態を戻すための後始末 */
  readonly onLoaded: () => void;
}

/**
 * ファイルを文字列として読む。
 *
 * `Blob.text()` ではなく `FileReader` を使う。jsdom が `Blob.text()` を実装して
 * いないため、前者では読み込み経路をテストから駆動できない。ブラウザでの挙動は
 * どちらも同じである。
 */
function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

export function SessionImport({
  dispatch,
  dirty,
  onLoaded,
}: SessionImportProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "warn"; text: string } | null>(
    null,
  );
  const inputId = useId();

  const handleFile = async (file: File): Promise<void> => {
    let text: string;
    try {
      text = await readTextFile(file);
    } catch {
      setMessage({ kind: "error", text: "ファイルを読み取れませんでした。" });
      return;
    }
    const outcome = parseExportedSession(text);
    if (!outcome.ok) {
      setMessage({ kind: "error", text: `読み込めませんでした：${outcome.error}` });
      return;
    }
    dispatch({ type: "loadSession", draft: outcome.draft });
    onLoaded();
    setMessage(
      outcome.warnings.length === 0
        ? null
        : { kind: "warn", text: outcome.warnings.join(" / ") },
    );
  };

  return (
    <>
      <button
        type="button"
        data-testid="import-session"
        onClick={() => {
          if (dirty && !window.confirm("入力内容を破棄してファイルを読み込みますか？")) {
            return;
          }
          setMessage(null);
          inputRef.current?.click();
        }}
      >
        ファイルから読み込み
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        data-testid="import-file"
        aria-label="書き出した JSON ファイル"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // 同じファイルを続けて選んでも change が起きるようにする
          event.currentTarget.value = "";
          if (file !== undefined) void handleFile(file);
        }}
      />
      {message !== null && (
        <p
          className={message.kind === "error" ? "import-error" : "import-warn"}
          data-testid="import-message"
          role="status"
        >
          {message.text}
        </p>
      )}
    </>
  );
}
