#!/usr/bin/env python3
import json
import os
import sys
import tempfile
import unittest

# Add repo root to path
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "build"))

import build_dict_zh as builder


class TestBuildDictZh(unittest.TestCase):
    def test_parse_bkrs_line_standard(self):
        line = "你好 [你好] ni3 hao3\t[p]межд.[/p] 1) привет, здравствуйте; 2) как поживаете?"
        parsed = builder.parse_bkrs_line(line)
        self.assertIsNotNone(parsed)
        word, entry = parsed
        self.assertEqual(word, "你好")
        self.assertEqual(entry["p"], "ni3 hao3")
        self.assertEqual(entry["trad"], "你好")
        self.assertEqual(entry["pos"], "межд.")
        self.assertIn("привет, здравствуйте", entry["t"])

    def test_parse_bkrs_line_tab_format(self):
        line = "中国\tZhong1 guo2\tКитай; китайский"
        parsed = builder.parse_bkrs_line(line)
        self.assertIsNotNone(parsed)
        word, entry = parsed
        self.assertEqual(word, "中国")
        self.assertIn("Китай", entry["t"])

    def test_parse_bkrs_line_skips_non_cjk_and_comments(self):
        self.assertIsNone(builder.parse_bkrs_line("# comment"))
        self.assertIsNone(builder.parse_bkrs_line("hello\tworld"))
        self.assertIsNone(builder.parse_bkrs_line(""))

    def test_parse_cedict_line(self):
        line = "中國 中国 [Zhong1 guo2] /China/Middle Kingdom/"
        parsed = builder.parse_cedict_line(line)
        self.assertIsNotNone(parsed)
        word, entry = parsed
        self.assertEqual(word, "中国")
        self.assertEqual(entry["trad"], "中國")
        self.assertEqual(entry["p"], "Zhong1 guo2")
        self.assertEqual(entry["t"], ["China", "Middle Kingdom"])

    def test_fuse_cedict_with_en_ru(self):
        cedict = {
            "中国": {"p": "Zhong1 guo2", "t": ["China", "Middle Kingdom"], "trad": "中國"},
            "好": {"p": "hao3", "t": ["good"], "trad": "好"},
        }
        en_ru = {
            "china": ["Китай", "фарфор"],
            "good": ["хороший", "добрый"],
        }
        fused = builder.fuse_cedict_with_en_ru(cedict, en_ru)
        self.assertIn("Китай", fused["中国"]["t"])
        self.assertIn("хороший", fused["好"]["t"])

    def test_build_bkrs_schema(self):
        lines = [
            "你好 [你好] ni3 hao3\tпривет",
            "中国 [中國] Zhong1 guo2\tКитай",
        ]
        res = builder.build_bkrs(lines)
        self.assertEqual(res["v"], 1)
        self.assertEqual(res["lang"], "zh-ru")
        self.assertEqual(len(res["w"]), 2)
        self.assertIn("你好", res["w"])
        self.assertIn("中国", res["w"])


if __name__ == "__main__":
    unittest.main()
