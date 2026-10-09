"""Wikipedia の作品一覧から、手動投入用の D1 SQL を生成する。"""

import argparse
import re
from pathlib import Path
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup


SOURCE_URL = "https://ja.wikipedia.org/wiki/週刊少年マガジン連載作品の一覧"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "seeds/random-magazine-title-data.sql"
COLUMNS = ("title", "title_url", "author", "author_url", "start_issue", "end_issue")


def visible_cell(cell):
    """ソート用の非表示文字や脚注を除いたセルのコピーを返す。"""
    cleaned = BeautifulSoup(str(cell), "html.parser")
    for node in cleaned.select("sup, .sortkey, .reference, [hidden]"):
        node.decompose()
    for node in cleaned.select("[style], [aria-hidden]"):
        style = re.sub(r"\s+", "", node.get("style", "")).lower()
        if "display:none" in style or node.get("aria-hidden") == "true":
            node.decompose()
    return cleaned


def name_and_url(cell):
    cleaned = visible_cell(cell)
    name = cleaned.get_text("", strip=True)
    anchor = cleaned.find("a", href=True)
    url = urljoin(SOURCE_URL, anchor["href"]) if anchor else None
    return name, url


def issue(cell):
    cleaned = visible_cell(cell)
    for separator in cleaned.select("hr, br"):
        separator.replace_with("\n")
    parts = cleaned.get_text("", strip=False).strip().splitlines()
    values = []
    for part in parts:
        text = part.strip()
        if not text:
            continue
        match = re.fullmatch(r"(\d{4})\.(\d{1,2}(?:[/･]\d{1,2})?)", text)
        if match:
            numbers = "/".join(str(int(number)) for number in re.split(r"[/･]", match[2]))
            values.append(f"{match[1]}年{numbers}号")
        elif text.startswith("連載中"):
            values.append("連載中")
        elif text == "移籍中":
            values.append(text)
        else:
            raise ValueError(f"未対応の号表記です: {text!r}")
    if not values:
        raise ValueError("号表記が空です。")
    return "／".join(values)


def parse_titles(html):
    soup = BeautifulSoup(html, "html.parser")
    # 年別掲載作品一覧の節に限定し、列見出しで対象テーブルを確認する。
    heading = soup.find(id="年別掲載作品一覧")
    if not heading:
        raise ValueError("年別掲載作品一覧の見出しが見つかりません。")
    tables = []
    heading_level = int(heading.name[1]) if re.fullmatch(r"h[1-6]", heading.name) else 3
    for node in heading.find_all_next():
        if re.fullmatch(r"h[1-6]", node.name or "") and int(node.name[1]) <= heading_level:
            break
        if node.name == "table":
            tables.append(node)

    for table in tables:
        header = None
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"], recursive=False)
            labels = [visible_cell(cell).get_text("", strip=True) for cell in cells]
            if all(label in labels for label in ("No", "作品名", "作者（作画）", "開始", "終了")):
                header = labels
                break
        if not header:
            continue

        positions = {label: header.index(label) for label in ("No", "作品名", "作者（作画）", "開始", "終了")}
        titles = []
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"], recursive=False)
            if not cells:
                continue
            # 年別見出し・繰り返しヘッダー・ソート用ダミー行を除外。
            number = visible_cell(cells[positions["No"]]).get_text("", strip=True)
            if not re.fullmatch(r"\d{3,}", number):
                continue
            # Wikipedia に番号だけ残り、作品情報がコメント化された空行がある。
            if len(cells) == 2 and not visible_cell(cells[1]).get_text(strip=True):
                continue
            if len(cells) != len(header):
                raise ValueError(f"作品行の列数が不正です: No {number}")
            title, title_url = name_and_url(cells[positions["作品名"]])
            author, author_url = name_and_url(cells[positions["作者（作画）"]])
            if not title or not author:
                raise ValueError(f"作品名または作者が空です: No {number}")
            titles.append((title, title_url, author, author_url,
                           issue(cells[positions["開始"]]), issue(cells[positions["終了"]])))
        if not titles:
            raise ValueError("作品一覧に取り込み可能な作品がありません。")
        return titles
    raise ValueError("作品一覧テーブルが見つかりません。Wikipedia の構造を確認してください。")


def sql_literal(value):
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def generate_sql(titles):
    if not titles:
        raise ValueError("空のデータで SQL は生成できません。")
    lines = [
        f"-- 出典: {SOURCE_URL}",
        "-- Wikipedia contributors / CC BY-SA（出典ページのライセンスを参照）",
        '-- このサービスのデータのみを置換。D1 execute のファイル単位のトランザクションで適用する。',
        'DELETE FROM magazine_titles;',
    ]
    for title in titles:
        lines.append(
            f'INSERT INTO magazine_titles ({", ".join(COLUMNS)}) VALUES '
            f'({", ".join(sql_literal(value) for value in title)});'
        )
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--html", type=Path, help="保存済み HTML を使い、通信せず生成する")
    args = parser.parse_args()
    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        # 一度だけ取得。定期実行・自動リトライは行わない。
        request = Request(
            "https://ja.wikipedia.org/wiki/" + quote("週刊少年マガジン連載作品の一覧"),
            headers={"User-Agent": "junk-services-random-magazine-title/1.0 (manual import)"},
        )
        with urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8")
    titles = parse_titles(html)
    sql = generate_sql(titles)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # 解析失敗時は既存ファイルを変更しない。世代管理はせず同名で更新。
    args.output.write_text(sql, encoding="utf-8")
    print(f"{len(titles)} 作品を {args.output} に出力しました。")


if __name__ == "__main__":
    main()

