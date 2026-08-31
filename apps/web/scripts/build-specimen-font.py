#!/usr/bin/env python3
"""A4レポートの実物大見本に使う書体を作る（1グリフのサブセット）。

なぜ同梱するのか
----------------
実物大見本と 50mm 校正バーは体裁ではなく**計測器**である。紙の上で「これが
N pt の大きさです」と言い切っているので、刷る機械によって大きさが変わっては
ならない。`pt` が定める全角ボディ（em）は書体によらず同じだが、実際に刷られる
墨の高さ（字面）は書体ごとに違う（SPEC §5.7 の注記。実測: ヒラギノ明朝
ProN W3 の「読」= 0.913 em、Noto Serif JP = 0.918 em）。フォールバック指定の
ままだと Mac と Windows で違う大きさの見本を刷ることになる。

レポートの他の文字は環境のフォントでよい。物理量を主張していないため。

出所とライセンス
----------------
Noto Serif JP（SIL Open Font License 1.1）。予約フォント名（RFN）の指定は
ないが、改変版であることを明示するため family 名を変えている。原本の著作権・
ライセンス表記は name テーブルに残し、OFL 全文を `apps/web/public/` に置いて
ビルド成果物と一緒に配る。

使い方
------
    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python apps/web/scripts/build-specimen-font.py

出力を差し替えたら、印刷実機で墨の高さを測り直すこと（バーが検出できるのは
倍率のズレだけで、字面の変化は検出できない）。
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Subsetter

# 見本に使う文字。増やすときはここと styles.css のコメントを両方直す。
SPECIMEN_CHARS = "読"

SOURCE_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/"
    "NotoSerifJP%5Bwght%5D.ttf"
)
LICENSE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/OFL.txt"

WEIGHT = 400  # 本文と同じ常用ウェイト。可変フォントの既定は 200（ExtraLight）
FAMILY = "MNREAD Report Mincho"
POSTSCRIPT = "MNREADReportMincho-Regular"

ROOT = Path(__file__).resolve().parents[1]
OUT_FONT = ROOT / "src" / "assets" / "mnread-report-mincho.woff2"
OUT_LICENSE = ROOT / "public" / "OFL-NotoSerifJP.txt"
CACHE = Path("/tmp") / "mnread-fontsrc"


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"取得: {url}")
        urllib.request.urlretrieve(url, dest)  # noqa: S310 - 出所は上の定数のみ
    return dest


def rename(font: TTFont) -> None:
    """family 名を差し替える。原本の著作権・ライセンス表記(0/13/14)は残す。"""
    name = font["name"]
    unique = f"{FAMILY}; subset of {name.getDebugName(3)}"
    description = (
        f"Subset of Noto Serif JP ({SPECIMEN_CHARS} only), instanced at wght={WEIGHT}. "
        "Used as a physical-size specimen in the MNREAD-J/Jk report."
    )
    for platform, encoding, language in ((3, 1, 0x409), (1, 0, 0)):
        for name_id, value in (
            (1, FAMILY),
            (2, "Regular"),
            (3, unique),
            (4, FAMILY),
            (6, POSTSCRIPT),
            (10, description),
        ):
            name.setName(value, name_id, platform, encoding, language)
    # 可変フォント由来の typographic family / variations 名は意味を失うので落とす
    for name_id in (16, 17, 25, 257):
        name.removeNames(name_id)


def ink_height_em(font: TTFont, char: str) -> float:
    glyphs = font.getGlyphSet()
    pen = BoundsPen(glyphs)
    glyphs[font.getBestCmap()[ord(char)]].draw(pen)
    _, y_min, _, y_max = pen.bounds
    return (y_max - y_min) / font["head"].unitsPerEm


def main() -> int:
    source = fetch(SOURCE_URL, CACHE / "NotoSerifJP[wght].ttf")
    fetch(LICENSE_URL, OUT_LICENSE)

    font = instancer.instantiateVariableFont(TTFont(source), {"wght": WEIGHT})
    rename(font)

    subsetter = Subsetter()
    subsetter.populate(text=SPECIMEN_CHARS)
    subsetter.subset(font)
    font.flavor = "woff2"

    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT_FONT)

    for char in SPECIMEN_CHARS:
        print(f"字面高 {char} = {ink_height_em(font, char):.4f} em")
    print(f"{OUT_FONT.relative_to(ROOT)}  {OUT_FONT.stat().st_size} bytes")
    print(f"{OUT_LICENSE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
