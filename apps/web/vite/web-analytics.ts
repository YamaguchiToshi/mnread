/**
 * Cloudflare Web Analytics のビーコンを、ビルド時にだけ index.html へ差し込む。
 *
 * なぜ index.html に直書きしないか（ADR-0017）:
 *
 * このアプリの CSP は `default-src 'self'` / `connect-src 'none'` で外部接続を
 * 構成として禁じている。これは「患者データを端末外に出さない」を設定ミスで
 * 壊せないようにするための保証であり、既定の姿は保証が効いたままでなければ
 * ならない。ビーコンを index.html に直書きすると、開発中・テスト中・トークン
 * 未設定のビルドまで含めて **常に穴が開いた CSP** が既定になる。
 *
 * そこで既定（トークン未設定）では index.html をそのまま出し、トークンが
 * 与えられたときにだけ、ビーコン1本ぶんだけ CSP を開けてスクリプトを足す。
 * つまり **穴はビーコンが実在するビルドにしか存在しない**。
 *
 * サイトトークンは秘密情報ではない（配信される HTML に平文で載る性質のもの）。
 * それでもリポジトリに置かず環境変数から取るのは、秘匿のためではなく、
 * 「計測を入れるかどうか」を配信の設定として1か所に置くためである。
 */

import type { Plugin } from "vite";

/** ビーコン本体の配信元。`script-src` に必要。 */
const BEACON_ORIGIN = "https://static.cloudflareinsights.com";

/**
 * 計測データの送信先。`connect-src` に必要。
 *
 * Cloudflare プロキシ配下のサイトは自ドメインの `/cdn-cgi/rum` へ送るが、
 * GitHub Pages 配信は非プロキシなので、送信先はこの外部ホストになる。
 */
const REPORT_ORIGIN = "https://cloudflareinsights.com";

/** Cloudflare のサイトトークンは32桁の16進。想定外の値を HTML へ流し込まない。 */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * ビーコンを足した HTML を返す。トークンがなければ入力をそのまま返す。
 *
 * 置換対象が見つからない場合は投げる。黙って素通しすると、
 * 「CSP は開いたのにビーコンがない」「ビーコンはあるのに CSP が塞いでいる」の
 * どちらかを配信しうる。どちらも画面上の手がかりがないので、ビルドを止める。
 */
export function applyWebAnalytics(html: string, token: string | undefined): string {
  if (!token) return html;

  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(
      `VITE_CF_BEACON_TOKEN が Cloudflare のサイトトークン（32桁の16進）の形をしていない: ${JSON.stringify(token)}`,
    );
  }

  // CSP は「self のみ」から「self ＋ ビーコン1本」へ。default-src は動かさず、
  // script-src と connect-src だけを、必要なホストに限って開ける。
  const withScriptSrc = replaceOnce(
    html,
    "default-src 'self';",
    `default-src 'self'; script-src 'self' ${BEACON_ORIGIN};`,
  );
  const withConnectSrc = replaceOnce(
    withScriptSrc,
    "connect-src 'none';",
    `connect-src ${REPORT_ORIGIN};`,
  );

  // 属性は Cloudflare が配るスニペットのまま（`type="module"`）。
  // 手を加えると、向こうの配信が変わったときに差分の追跡先が増える。
  const beacon =
    `    <!-- アクセス数の把握のみ。Cookie を置かず、入力値には触れない（ADR-0017）。 -->\n` +
    `    <script type="module" src="${BEACON_ORIGIN}/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>\n`;

  return replaceOnce(withConnectSrc, "  </head>", `${beacon}  </head>`);
}

function replaceOnce(html: string, needle: string, replacement: string): string {
  const first = html.indexOf(needle);
  if (first === -1) {
    throw new Error(`index.html に ${JSON.stringify(needle)} が見つからない（差し込み位置の前提が崩れている）`);
  }
  if (html.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`index.html の ${JSON.stringify(needle)} が複数ある（どれを置換すべきか決められない）`);
  }
  return html.slice(0, first) + replacement + html.slice(first + needle.length);
}

/**
 * ビルド成果物にだけ適用する（`apply: "build"`）。
 *
 * 開発サーバに入れない理由は2つある。開発中に外部へ ping を打つ必要がないこと、
 * そして vite.config.ts の `relaxCspForDev` が `connect-src 'none'` を目印に
 * 書き換えているため、先にここが触ると目印が消えることである。
 */
export function webAnalytics(token: string | undefined): Plugin {
  return {
    name: "mnread-web-analytics",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => applyWebAnalytics(html, token),
    },
  };
}
