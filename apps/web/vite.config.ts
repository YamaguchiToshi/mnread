import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * 開発時だけ CSP の connect-src を緩める。
 *
 * index.html の CSP は `connect-src 'none'` で外部送信を封じている。これは
 * 出荷物の保証なので弱められないが、そのままだと Vite の HMR WebSocket も
 * 落ちる。開発サーバでのみ同一オリジンの ws を許可し、ビルド成果物には
 * 一切手を触れない（`apply: "serve"`）。
 */
function relaxCspForDev(): Plugin {
  return {
    name: "mnread-dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace("connect-src 'none'", "connect-src 'self' ws: wss:");
    },
  };
}

/**
 * GitHub Pages はサブパス配信のため base を固定する（PLAN.md「GitHub Pages とブランチ構成」）。
 * Phase 4 以降で Pages のソースを main のビルドへ差し替える際、ここが合っていないと
 * アセットが 404 になる。足場を作る時点で入れておく。
 */
export default defineConfig({
  base: "/mnread/",
  plugins: [react(), relaxCspForDev()],
  build: {
    outDir: "dist",
    // 患者データを外部に出さない設計のため、外部リクエストを生む要素を持ち込まない。
    // アセットはすべてバンドルする（Phase 6 の PWA / CSP 固定の前提）。
    assetsInlineLimit: 0,
  },
});
