import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from generate_sql import generate_sql, issue, parse_titles
from bs4 import BeautifulSoup


class GenerateSqlTests(unittest.TestCase):
    def test_combined_issue(self):
        for source, expected in (
            ("1970.02/03", "1970年2/3号"),
            ("1975.4･5", "1975年4/5号"),
            ("連載中（不定期）", "連載中"),
            ("2026.12<hr>2026.41", "2026年12号／2026年41号"),
            ("2026.15<hr>移籍中", "2026年15号／移籍中"),
        ):
            with self.subTest(source=source):
                cell = BeautifulSoup(f"<td>{source}</td>", "html.parser").td
                self.assertEqual(issue(cell), expected)

    def test_parse_visible_names_urls_and_skip_heading(self):
        html = '''<h3 id="年別掲載作品一覧">年別掲載作品一覧</h3><table id="mw_w">
          <tr><th>No</th><th>作品名</th><th>作者（作画）</th><th>原作者など</th><th>開始</th><th>終了</th><th>備考</th></tr>
          <tr><td>000.5</td><td>作品名</td><td>作者（作画）</td><td>原作者など</td><td>開始</td><td>終了</td><td>備考</td></tr>
          <tr><th>001</th><td><span style="display: none">よみ</span><a href="/wiki/作品">作品</a><sup>注</sup></td>
          <td>作者</td><td>－</td><td>1968.01<sup>注</sup></td><td>連載中</td><td>－</td></tr></table>'''
        self.assertEqual(parse_titles(html), [
            ("作品", "https://ja.wikipedia.org/wiki/作品", "作者", None, "1968年1号", "連載中"),
        ])

    def test_section_selection_and_commented_empty_row(self):
        table = """<table><tr><th>No</th><th>作品名</th><th>作者（作画）</th>
          <th>開始</th><th>終了</th></tr>
          <tr><th>001</th><td>対象作品</td><td><a href="/wiki/作者">作者</a></td>
          <td>2000.01</td><td>連載中</td></tr>
          <tr><th>002</th><td><!-- 非表示の作品情報 --></td></tr></table>"""
        html = table.replace("対象作品", "対象外") + '<h3 id="年別掲載作品一覧">年別掲載作品一覧</h3>' + table
        titles = parse_titles(html)
        self.assertEqual(len(titles), 1)
        self.assertEqual(titles[0][0], "対象作品")
        self.assertEqual(titles[0][3], "https://ja.wikipedia.org/wiki/作者")
        with self.assertRaises(ValueError):
            parse_titles('<h3 id="年別掲載作品一覧">一覧</h3><h2>脚注</h2>' + table)

    def test_real_data_rerun(self):
        root = Path(__file__).resolve().parents[2]
        db = sqlite3.connect(":memory:")
        db.executescript((root / "migrations/0004_create_magazine_titles.sql").read_text())
        sql = (root / "seeds/random-magazine-title-data.sql").read_text(encoding="utf-8")
        db.executescript(sql)
        first = db.execute("SELECT * FROM magazine_titles").fetchall()
        self.assertGreater(len(first), 0)
        db.executescript(sql)
        self.assertEqual(db.execute("SELECT * FROM magazine_titles").fetchall(), first)

    def test_rerun_and_sql_escaping(self):
        db = sqlite3.connect(":memory:")
        root = Path(__file__).resolve().parents[2]
        db.executescript((root / "migrations/0004_create_magazine_titles.sql").read_text())
        db.execute("CREATE TABLE other_service (value TEXT)")
        db.execute("INSERT INTO other_service VALUES ('keep')")
        sql = generate_sql([("It's a title", None, "作者", None, "2000年1号", "連載中")])
        db.executescript(sql)
        db.executescript(sql)
        self.assertEqual(db.execute('SELECT title, title_url FROM magazine_titles').fetchall(), [("It's a title", None)])
        self.assertEqual(db.execute("SELECT value FROM other_service").fetchone(), ("keep",))

    def test_invalid_input_does_not_produce_delete_sql(self):
        with self.assertRaises(ValueError):
            parse_titles("<table><tr><td>unexpected</td></tr></table>")
        with self.assertRaises(ValueError):
            generate_sql([])
        with self.assertRaises(ValueError):
            issue(BeautifulSoup("<td></td>", "html.parser").td)

    def test_malformed_work_row_is_rejected(self):
        html = '''<h3 id="年別掲載作品一覧">年別掲載作品一覧</h3><table><tr><th>No</th><th>作品名</th><th>作者（作画）</th>
          <th>開始</th><th>終了</th></tr><tr><td>001</td><td>作品</td></tr></table>'''
        with self.assertRaises(ValueError):
            parse_titles(html)

    def test_failed_import_preserves_existing_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.html"
            output = Path(directory) / "data.sql"
            source.write_text("<table></table>", encoding="utf-8")
            output.write_text("keep existing SQL", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("generate_sql.py")),
                 "--html", str(source), "--output", str(output)],
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(encoding="utf-8"), "keep existing SQL")


if __name__ == "__main__":
    unittest.main()

