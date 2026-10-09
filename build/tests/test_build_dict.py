import json
import os
import tempfile
import unittest

import build_dict

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
DUMP = os.path.join(FIXTURES, "kaikki-sample.jsonl")
FREQ = os.path.join(FIXTURES, "freq-sample.txt")


def build_fixture(top=None):
    with open(FREQ, encoding="utf-8") as fh:
        ranks = build_dict.load_freq(fh, top)
    with open(DUMP, encoding="utf-8") as fh:
        return build_dict.build(fh, ranks)


class BuildDictTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = build_fixture()

    def test_format_version(self):
        self.assertEqual(self.d["v"], 1)
        self.assertEqual(set(self.d), {"v", "w", "f", "p"})

    def test_word_level_translations_ignore_other_languages(self):
        # First ru of each sense, deduplicated, at most two, stress marks stripped.
        self.assertEqual(self.d["w"]["go"], "идти, ехать")

    def test_sense_level_translations(self):
        self.assertEqual(self.d["w"]["run"], "бежать, запускать")
        self.assertEqual(self.d["w"]["book"], "книга")

    def test_sense_level_before_unattached_word_level(self):
        self.assertEqual(self.d["w"]["give"], "давать, поддаваться")

    def test_translations_with_latin_text_dropped(self):
        self.assertEqual(self.d["w"]["US"], "США")

    def test_non_english_entries_ignored(self):
        self.assertNotIn("не то", self.d["w"]["book"])

    def test_words_outside_frequency_list_dropped(self):
        self.assertNotIn("zymurgy", self.d["w"])

    def test_words_without_russian_dropped(self):
        self.assertNotIn("cats", self.d["w"])

    def test_form_of_entry(self):
        self.assertEqual(self.d["f"]["went"], "go")

    def test_forms_of_lemma(self):
        self.assertEqual(self.d["f"]["runs"], "run")
        self.assertEqual(self.d["f"]["ran"], "run")

    def test_forms_with_skipped_tags_dropped(self):
        self.assertNotIn("ranne", self.d["f"])  # romanization
        self.assertNotIn("german", self.d["f"])  # table-tags

    def test_nonstandard_forms_dropped(self):
        # `the` is listed both in forms[] (alternative) and as form-of (obsolete) of `they`.
        self.assertEqual(self.d["w"]["they"], "они")
        self.assertNotIn("the", self.d["f"])

    def test_ambiguous_form_prefers_more_frequent_lemma(self):
        self.assertEqual(self.d["f"]["leaves"], "leave")

    def test_form_that_is_a_lemma_stays_in_words(self):
        self.assertEqual(self.d["w"]["better"], "лучше")
        self.assertNotIn("better", self.d["f"])

    def test_forms_outside_frequency_list_dropped(self):
        self.assertNotIn("goes", self.d["f"])

    def test_case_collision_keeps_both(self):
        self.assertEqual(self.d["w"]["polish"], "полировать")
        self.assertEqual(self.d["w"]["Polish"], "польский")

    def test_phrases_of_two_and_three_words(self):
        self.assertEqual(self.d["p"]["as well"], "тоже")
        self.assertEqual(self.d["p"]["in order to"], "для того чтобы")

    def test_long_phrases_and_rare_words_dropped(self):
        self.assertNotIn("rain cats and dogs", self.d["p"])
        self.assertNotIn("in zymurgy", self.d["p"])

    def test_contraction_passes_via_parts(self):
        self.assertEqual(self.d["w"]["don't"], "не")

    def test_top_limits_frequency_list(self):
        d = build_fixture(top=3)  # the, go, leave
        self.assertEqual(set(d["w"]), {"go", "leave"})


class CliTest(unittest.TestCase):
    def test_writes_compact_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "dict.json")
            self.assertEqual(build_dict.main([DUMP, "--freq", FREQ, "--out", out]), 0)
            with open(out, encoding="utf-8") as fh:
                d = json.load(fh)
        self.assertEqual(d, build_fixture())


if __name__ == "__main__":
    unittest.main()
