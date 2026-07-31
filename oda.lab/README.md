# 一次資料

本ディレクトリには MNREAD-J / Jk の**正本**となる資料を置く。SPEC.md の各式はここに帰着する。

**PDF 本体は git で追跡していない。** 小田研究室（東京女子大学）の著作物であり、本リポジトリで再配布しないため。下記から取得して本ディレクトリに置くこと。

| ファイル名 | 資料 | 入手先 |
|---|---|---|
| `MNREAD-J-JkMan020518.pdf` | MNREAD-J, Jk チャートマニュアル（小田浩一、2002-05-18） | https://www.cis.twcu.ac.jp/~k-oda/MNREAD-J/MNREAD-J-JkMan020518.pdf |
| `odalab web resource center.pdf` | MNREAD-J Q&A（小田浩一・歓喜仁美・川嶋英嗣・田中恵津子、1998-2010） | https://www.cis.twcu.ac.jp/~k-oda/MNREAD-J/MNREADJ-QandA.html （ページを PDF として保存） |

MNREAD-J 公式ページ: https://www.cis.twcu.ac.jp/~k-oda/MNREAD-J/

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
