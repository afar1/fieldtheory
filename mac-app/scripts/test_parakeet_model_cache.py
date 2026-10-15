"""Cache layout regressions; run with the Parakeet runtime's Python."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("parakeet_transcribe", Path(__file__).with_name("parakeet-transcribe.py"))
parakeet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parakeet)


class ModelCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.snapshot = self.root / "snapshots" / "revision"
        self.snapshot.mkdir(parents=True)
        self.blobs = self.root / "blobs"
        self.blobs.mkdir()
        for index, name in enumerate(parakeet.MODEL_FILES):
            blob = self.blobs / str(index)
            blob.write_bytes((name + " original bytes").encode())
            (self.snapshot / name).symlink_to(blob)

    def test_cached_models_are_repaired_offline_for_both_engines(self):
        for model in parakeet.MODEL_REPOS:
            with self.subTest(model=model), patch("huggingface_hub.snapshot_download", return_value=str(self.snapshot)) as download:
                prepared = parakeet.prepare_model_cache(model)
                self.assertEqual(prepared, self.snapshot)
                self.assertTrue(download.call_args.kwargs["local_files_only"])
                for index, name in enumerate(parakeet.MODEL_FILES):
                    self.assertFalse((prepared / name).is_symlink())
                    self.assertEqual((prepared / name).read_bytes(), (self.blobs / str(index)).read_bytes())
                before = (prepared / parakeet.MODEL_FILES[0]).stat().st_ino
                parakeet.prepare_model_cache(model)
                self.assertEqual((prepared / parakeet.MODEL_FILES[0]).stat().st_ino, before)

    def test_new_downloads_and_incomplete_snapshots_are_prepared_before_loading(self):
        from huggingface_hub.errors import LocalEntryNotFoundError
        for cached in [LocalEntryNotFoundError("not cached"), str(self.root / "missing")]:
            with self.subTest(cached=type(cached).__name__), patch(
                "huggingface_hub.snapshot_download", side_effect=[cached, str(self.snapshot)]
            ):
                prepared = parakeet.prepare_model_cache(parakeet.DEFAULT_MODEL_NAME)
                self.assertTrue(all((prepared / name).is_file() and not (prepared / name).is_symlink() for name in parakeet.MODEL_FILES))

    def test_interrupted_copy_preserves_the_link_and_shared_blob(self):
        with patch.object(parakeet.shutil, "copyfile", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                parakeet.materialize_model_files(self.snapshot)
        self.assertTrue(all((self.snapshot / name).is_symlink() for name in parakeet.MODEL_FILES))
        self.assertEqual((self.blobs / "0").read_bytes(), (parakeet.MODEL_FILES[0] + " original bytes").encode())
        self.assertEqual(list(self.snapshot.glob(".fieldtheory-copy-*")), [])

    def test_missing_download_has_an_actionable_path(self):
        (self.snapshot / parakeet.MODEL_FILES[0]).unlink()
        with patch("huggingface_hub.snapshot_download", return_value=str(self.snapshot)):
            with self.assertRaisesRegex(FileNotFoundError, "Parakeet model file is missing:.*encoder-model.onnx"):
                parakeet.prepare_model_cache(parakeet.DEFAULT_MODEL_NAME)


if __name__ == "__main__":
    unittest.main()
