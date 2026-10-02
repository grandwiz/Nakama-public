"""Synthetic packaging/cache tests; no models, downloads, microphone, or device."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("speech_builder", Path(__file__).with_name("build-bundled-speech-runtime.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def elf(align=16384, needed="libc.so"):
    data = bytearray(512)
    data[:6] = b"\x7fELF\x02\x01"
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<HH", data, 54, 56, 2)
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 4, 0, 0, 0, 512, 512, align)
    struct.pack_into("<IIQQQQQQ", data, 120, 2, 4, 192, 192, 192, 48, 48, 8)
    struct.pack_into("<QQQQQQ", data, 192, 5, 256, 1, 0, 0, 0)
    data[256:256 + len(needed) + 1] = needed.encode() + b"\0"
    return bytes(data)


class RuntimePackagingTest(unittest.TestCase):
    def test_accepts_aligned_elf_and_records_dependencies(self):
        data = elf()
        metadata = builder.elf_metadata(data)
        self.assertEqual(["libc.so"], metadata["needed"])
        self.assertEqual([16384], metadata["loadAlignments"])
        self.assertEqual(hashlib.sha256(data).hexdigest(), metadata["sha256"])

    def test_rejects_four_kilobyte_native_alignment(self):
        with self.assertRaisesRegex(RuntimeError, "16 KB"):
            builder.elf_metadata(elf(align=4096))

    def test_rejects_unpackaged_shared_runtime(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected native dependency"):
            builder.elf_metadata(elf(needed="libc++_shared.so"))

    def test_archive_path_cannot_escape_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "source.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("../outside", "do not write")
            with self.assertRaisesRegex(RuntimeError, "Unsafe archive path"):
                builder.extract(archive, root / "source")
            self.assertFalse((root / "outside").exists())

    def test_archive_links_never_followed_or_created(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "source.zip"
            with zipfile.ZipFile(archive, "w") as z:
                item = zipfile.ZipInfo("unused-sample-link")
                item.external_attr = 0o120777 << 16
                z.writestr(item, "../../outside")
            builder.extract(archive, root / "source")
            item = root / "source/unused-sample-link"
            self.assertFalse(item.is_symlink())
            self.assertEqual("../../outside", item.read_text())
            self.assertFalse((root / "outside").exists())

    def test_cache_requires_matching_recipe_and_output_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            aar, provenance = root / "runtime.aar", root / "runtime.json"
            aar.write_bytes(b"verified fixture")
            record = {"recipe": builder.recipe(), "outputSha256": builder.sha(aar)}
            provenance.write_text(json.dumps(record))
            with patch.object(builder, "OUT", aar), patch.object(builder, "PROVENANCE", provenance):
                self.assertTrue(builder.verified_cache())
                aar.write_bytes(b"changed fixture")
                self.assertFalse(builder.verified_cache())
                aar.write_bytes(b"verified fixture")
                record["recipe"]["flags"] = ["-DSHERPA_ONNX_ENABLE_TTS=ON"]
                provenance.write_text(json.dumps(record))
                self.assertFalse(builder.verified_cache())


if __name__ == "__main__":
    unittest.main()
