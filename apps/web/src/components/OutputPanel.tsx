/**
 * 出力画面（SPEC §8.2）
 *
 * 3系統をまとめて扱う。
 *   1. 電子カルテ用テキスト（コピー）
 *   2. A4 患者・支援者向けレポート（印刷）
 *   3. 生データ書き出し（JSON / CSV のダウンロード）
 *
 * **書き出しは検者の明示操作でのみ発生する。** 自動保存も自動送信も行わない。
 * 端末にデータを残さない設計であり、ファイルが出るのはボタンを押した瞬間だけである。
 *
 * 入力エラーがある間は何も出さない（ADR-0004）。部分的な出力は、後から見た人に
 * 「測れた分だけの結果」と読まれてしまう。
 */

import { useState, type JSX } from "react";

import { buildEmrText } from "../output/emrText.js";
import { buildExportBundle } from "../output/exportData.js";
import { PatientReport } from "../output/PatientReport.js";
import type { SessionView } from "../session/derive.js";

export interface OutputPanelProps {
  readonly view: SessionView;
}

export function OutputPanel({ view }: OutputPanelProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  if (!view.outcome.ok) {
    return (
      <section className="output output-blocked card" data-testid="output-panel">
        <div className="card-head">
          <h2>出力</h2>
        </div>
        <p className="blocked-note">
          入力エラーがあるため出力を作成しません。入力画面で該当行を修正してください。
        </p>
      </section>
    );
  }

  const result = view.outcome.result;
  const emrText = buildEmrText(result);
  const bundle = buildExportBundle(result);
  const plateauRows = view.selectedPlateauRows;

  const copyEmrText = (): void => {
    void navigator.clipboard?.writeText(emrText).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section className="output" data-testid="output-panel">
      {result.requiresReview && (
        <p className="review-flag no-print" data-testid="output-review-warning">
          目視確認を要する点があります。出力前に判定画面をご確認ください。
        </p>
      )}

      {/* --- 1. 電子カルテ用テキスト --- */}
      <div className="output-block card no-print">
        <div className="card-head">
          <h3>電子カルテ用テキスト</h3>
          <div className="output-actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="copy-emr"
              onClick={copyEmrText}
            >
              クリップボードにコピー
            </button>
            {copied && <span className="detail">コピーしました</span>}
          </div>
        </div>
        <p className="detail">
          算出法・測定距離・距離補正を含んだ定型文です。そのまま貼り付けられます。
        </p>
        {/*
          全文が一度に見えている必要がある。スクロールさせると、貼り付ける前に
          目を通すという手順が実際には省かれる。
        */}
        <textarea
          className="emr-text"
          data-testid="emr-text"
          readOnly
          rows={emrText.split("\n").length + 1}
          value={emrText}
        />
      </div>

      {/* --- 2. A4 レポート --- */}
      <div className="output-block card">
        <div className="no-print">
          <div className="card-head">
            <h3>A4 患者・支援者向けレポート</h3>
            <div className="output-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="print-report"
                onClick={() => window.print()}
              >
                印刷 / PDF 保存
              </button>
            </div>
          </div>
          <p className="detail">
            氏名は入りません。上端はレターヘッド用紙・院印のために空けてあります。
            推奨サイズの見本は<strong>倍率 100%</strong>で印刷したときに実物大になります
            （紙面の 50 mm 目盛りで確かめられます）。ブラウザが刷るヘッダ・フッタ
            （日付や URL）は出ないようにしてあります。もし出る場合は、印刷ダイアログの
            「ヘッダーとフッター」をオフにしてください。
          </p>
        </div>
        <div className="paper-preview">
          <PatientReport result={result} rows={view.rows} plateauRows={plateauRows} />
        </div>
      </div>

      {/* --- 3. 生データ --- */}
      <div className="output-block card no-print">
        <div className="card-head">
          <h3>生データ書き出し</h3>
          <div className="output-actions">
            <button
              type="button"
              className="btn"
              data-testid="download-json"
              onClick={() =>
                downloadFile(`${bundle.fileBaseName}.json`, "application/json", bundle.json)
              }
            >
              JSON をダウンロード
            </button>
            <button
              type="button"
              className="btn"
              data-testid="download-csv"
              onClick={() =>
                downloadFile(`${bundle.fileBaseName}.csv`, "text/csv", bundle.csv)
              }
            >
              CSV をダウンロード
            </button>
          </div>
        </div>
        <p className="detail">
          氏名を含みません。数値は丸めずフル精度で書き出します（再解析に使えることが条件のため）。
        </p>
      </div>
    </section>
  );
}

/**
 * ブラウザ内でファイルを作って渡す。
 *
 * 外部へは一切送らない。Blob URL は使い終わったら必ず解放する
 * （解放しないとページを閉じるまでデータがメモリに残る）。
 */
function downloadFile(fileName: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
