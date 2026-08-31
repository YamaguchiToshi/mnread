# 文献

本ディレクトリには本プロジェクトが依拠する文献の PDF を置く。二層ある。

- **一次資料（正本）** — MNREAD-J / Jk の規範。SPEC.md の各式はここに帰着する
- **参考資料** — 英語版 MNREAD についての文献。式の裁定には使わない

**PDF 本体は git で追跡していない**（`.gitignore` の `references/*.pdf`）。再配布の判断を
本リポジトリで行わないためである。下記の入手先から取得して本ディレクトリに置くこと。

## 一次資料（正本）

小田研究室（東京女子大学）の著作物。**式に関する最終的な権威はこの2点**である。

| ファイル名 | 資料 | 入手先 |
|---|---|---|
| `MNREAD-J-JkMan020518.pdf` | MNREAD-J, Jk チャートマニュアル（小田浩一、2002-05-18） | https://www.cis.twcu.ac.jp/~k-oda/MNREAD-J/MNREAD-J-JkMan020518.pdf |
| `odalab web resource center.pdf` | MNREAD-J Q&A（小田浩一・歓喜仁美・川嶋英嗣・田中恵津子、1998-2010） | https://www.cis.twcu.ac.jp/~k-oda/MNREAD-J/MNREADJ-QandA.html （ページを PDF として保存） |

MNREAD-J 公式ページ: https://www.cis.twcu.ac.jp/~k-oda/MNREAD-J/

## 参考資料

英語版 MNREAD の実装についての出典。**式の裁定には使わない**（本仕様の帰着先は上表の2点）。
照合対象がどこまでを指すかを決めるために置いてある。

| ファイル名 | 資料 | 入手先 |
|---|---|---|
| `i1534-7362-18-1-8.pdf` | Calabrèse A, To L, He Y, Berkholtz E, Rafian P, Legge GE. *Comparing performance on the MNREAD iPad application with the MNREAD acuity chart.* Journal of Vision (2018) 18(1):8, 1–11 | https://doi.org/10.1167/18.1.8 （CC BY-NC-ND 4.0）|

この論文が確定させること（"MNREAD parameters estimation", p.4–5）:

> Both methods used the same calculations: MRS and CPS were estimated using the original
> algorithm described in Legge (2007); RA and ACC were calculated according to the standard
> formulas (Calabrèse, Owsley et al., 2016).

すなわち **iPad 版アプリの自動推定 = `mnreadR` = Legge 2007 法**。本リポジトリが
`packages/core/test/oracle/mansfield.ts` で照合しているものと同一である。含意は
`docs/mnreadr-comparison.md` 末尾の追記に書いた。

ただし論文が測ったのは 2017 年時点の**プレリリース版**アプリである（"a prerelease version of
the MNREAD iPad app"）。現行の配布版が今も同じ計算かどうかは、この論文からは言えない。

## 閲覧方法

式・表・スコアシートが図として組まれているため、テキスト抽出ではなくページを画像として読む必要がある。

```
brew install poppler
```

を入れたうえで、Claude Code の Read ツールに `pages` を指定して読む。

## 原典から本リポジトリに取り込んだもの

PDF がなくても開発と検証は進められる。原典の数値は `packages/fixtures/data/` に出所つきで転記済みで、転記の健全性は `pnpm verify:fixtures` が独立の参照式で検証する。

| fixture | 原典の該当箇所 |
|---|---|
| `qa-point-size.json` | Q&A A4.3 のポイント換算表（21件・9桁） |
| `manual-table-a-distance.json` | マニュアル 表A 距離補正（33件） |
| `manual-table-b-decimal-acuity.json` | マニュアル 表B 小数視力 |
| `manual-table-c-speed.json` | マニュアル 表C 読書時間→読書速度 |
| `chart-printed-values.json` | 図1a チャート印刷 M size |
| `manual-worked-example.json` | §4 測定例（患者HK、15cm、19行）と §4.1〜§4.5 の記載値 |

式そのものの出典は SPEC.md の各節に locator つきで記載してある。

## 注意

原典に当たるべき場面では、`deep-research-report-1.md` / `-2.md`（二次資料）ではなくこちらを見ること。実際、M 値の定数について二次資料からは判断がつかず、Q&A A7 の原文で確定した経緯がある（ADR-0007）。
