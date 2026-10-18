"""Packaging checks run without importing native desktop code or changing releases."""
import argparse
import ast
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

import package


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / "downloads" / "companion.zip"
        self.originals = {name: (package.ROOT / name).read_bytes() for name in package.FILES}

    def entries(self):
        with ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {"folio-computer-companion/" + name for name in package.FILES})
            return {name: archive.read("folio-computer-companion/" + name) for name in package.FILES}

    def test_default_archive_preserves_original_origin_and_allowed_files(self):
        package.build_archive(self.output)
        entries = self.entries()
        for name in package.FILES:
            expected = self.originals[name]
            if name.endswith(".cmd"):
                expected = expected.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            self.assertEqual(entries[name], expected, name)
        self.assertEqual(package.OUTPUT, package.ROOT.parent / "dist/downloads/folio-computer-companion.zip")

    def test_github_archive_changes_only_literal_origin_and_documentation(self):
        origin = "https://folio-publisher.github.io"
        package.build_archive(self.output, origin)
        entries = self.entries()
        original_tree = ast.parse(self.originals["folio_companion.py"])
        built_tree = ast.parse(entries["folio_companion.py"])
        assignments = [node for node in built_tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "SITE_ORIGIN" for target in node.targets)]
        self.assertEqual(len(assignments), 1)
        self.assertIsInstance(assignments[0].value, ast.Constant)
        self.assertEqual(assignments[0].value.value, origin)
        # The packaged program has exactly the original executable AST except this literal.
        for node in original_tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "SITE_ORIGIN" for target in node.targets):
                node.value = ast.Constant(value=origin)
        self.assertEqual(ast.dump(original_tree), ast.dump(built_tree))
        self.assertIn(origin.encode(), entries["README.md"])
        self.assertNotIn(b"folio-book-studio.goofycamel128.chatgpt.site", entries["README.md"])
        for name in package.FILES:
            self.assertEqual((package.ROOT / name).read_bytes(), self.originals[name], name)

    def test_custom_https_origins_are_canonical_for_browser_headers(self):
        for value, expected in (
            ("https://books.example.org", "https://books.example.org"),
            ("https://BOOKS.EXAMPLE.ORG:443", "https://books.example.org"),
            ("https://books.example.org:8443", "https://books.example.org:8443"),
            ("https://xn--bcher-kva.example", "https://xn--bcher-kva.example"),
            ("https://127.0.0.1", "https://127.0.0.1"),
            ("https://[2001:db8::1]:8443", "https://[2001:db8::1]:8443"),
        ):
            with self.subTest(value=value):
                self.assertEqual(package.site_origin(value), expected)

    def test_invalid_or_unsafe_origins_cannot_change_existing_artifact(self):
        self.output.parent.mkdir(parents=True)
        self.output.write_bytes(b"existing artifact")
        bad_origins = (
            "http://owner.github.io", "javascript:alert(1)", "https://owner.github.io/",
            "https://owner.github.io/repository", "https://user:password@owner.github.io",
            "https://@owner.github.io", "https://owner.github.io?", "https://owner.github.io#",
            "https://owner.github.io?x=1", "https://owner.github.io#x", " https://owner.github.io",
            "https://owner.github.io\n", "https://owner.github.io\r\nSITE_ORIGIN = 'https://evil.test'",
            "https://owner.github.io\t", "https://owner.github.io\x00", "https://owner.github.io\x7f",
            "https://owner.github.io\\evil.test", "https://evil.test'; __import__('os').system('whoami')#",
            "https://", "https:///owner.github.io", "https://books..example", "https://-books.example",
            "https://books-.example", "https://books_example.org", "https://books.example.",
            "https://한글.example", "https://books.example:65536", "https://books.example:0",
            "https://books.example:", "https://books.example:0443", "https://books.example:abc",
            "https://%6fwner.github.io", "https://[fe80::1%25eth0]", "https://[invalid]",
            "https://127.1", "https://2130706433", "https://0x7f000001", "https://0x7f.1",
            "https://127.0.0.01", "https://books.123", "https://" + "a" * 64 + ".example",
        )
        for value in bad_origins:
            with self.subTest(value=repr(value)):
                with self.assertRaises(argparse.ArgumentTypeError):
                    package.build_archive(self.output, value)
                self.assertEqual(self.output.read_bytes(), b"existing artifact")

    def test_missing_allowlisted_file_preserves_previous_archive(self):
        self.output.parent.mkdir(parents=True)
        self.output.write_bytes(b"previous release")
        fixture = Path(self.temp.name) / "fixture"
        fixture.mkdir()
        for name, payload in self.originals.items():
            if name != "windows_desktop.py":
                (fixture / name).write_bytes(payload)
        with patch.object(package, "ROOT", fixture), self.assertRaises(FileNotFoundError):
            package.build_archive(self.output, "https://owner.github.io")
        self.assertEqual(self.output.read_bytes(), b"previous release")

    def test_unexpected_origin_assignment_fails_closed(self):
        for source in (
            b"OTHER = 'unchanged'\n",
            b"SITE_ORIGIN = 'one'\nSITE_ORIGIN = 'two'\n",
            b"SITE_ORIGIN = str('one')\n",
            b"SITE_ORIGIN = OTHER = 'one'\n",
        ):
            with self.subTest(source=source), self.assertRaises(ValueError):
                package.configured_companion(source, "https://owner.github.io")

    def test_cli_places_configured_archive_at_absolute_staging_path(self):
        result = subprocess.run([sys.executable, str(package.ROOT / "package.py"), "--site-origin", "https://owner.github.io", "--output", str(self.output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), str(self.output))
        self.assertIn(b"SITE_ORIGIN = 'https://owner.github.io'", self.entries()["folio_companion.py"])

    def test_cli_rejects_relative_output_without_creating_it(self):
        result = subprocess.run([sys.executable, str(package.ROOT / "package.py"), "--output", "relative.zip"], cwd=self.temp.name, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("absolute .zip path", result.stderr)
        self.assertFalse((Path(self.temp.name) / "relative.zip").exists())


if __name__ == "__main__":
    unittest.main()
