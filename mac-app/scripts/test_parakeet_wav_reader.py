#!/usr/bin/env python3
"""Tests for read_wav_float32 in parakeet-transcribe.py.

Run: python scripts/test_parakeet_wav_reader.py
"""

import os
import struct
import sys
import tempfile
import unittest

import numpy as np

# Import the reader from the sibling script.
sys.path.insert(0, os.path.dirname(__file__))
from importlib.util import spec_from_file_location, module_from_spec

_spec = spec_from_file_location(
    "parakeet_transcribe",
    os.path.join(os.path.dirname(__file__), "parakeet-transcribe.py"),
)
_mod = module_from_spec(_spec)
_spec.loader.exec_module(_mod)
read_wav_float32 = _mod.read_wav_float32


def _write_wav(path, samples, sample_rate, audio_format, bits_per_sample):
    """Write a minimal WAV file with the given format parameters."""
    if audio_format == 3:  # IEEE float
        if bits_per_sample == 32:
            raw = samples.astype(np.float32).tobytes()
        else:
            raw = samples.astype(np.float64).tobytes()
    elif audio_format == 1:  # Integer PCM
        if bits_per_sample == 16:
            raw = (samples * 32768).clip(-32768, 32767).astype(np.int16).tobytes()
        elif bits_per_sample == 32:
            raw = np.clip(samples * 2147483647, -2147483648, 2147483647).astype(np.int32).tobytes()
        elif bits_per_sample == 8:
            raw = ((samples + 1.0) * 128).clip(0, 255).astype(np.uint8).tobytes()
        else:
            raise ValueError(f"Unsupported: {bits_per_sample}")
    else:
        raise ValueError(f"Unsupported format: {audio_format}")

    bytes_per_sample = bits_per_sample // 8
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(raw)))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<H", audio_format))
        f.write(struct.pack("<H", 1))  # mono
        f.write(struct.pack("<I", sample_rate))
        f.write(struct.pack("<I", sample_rate * bytes_per_sample))
        f.write(struct.pack("<H", bytes_per_sample))
        f.write(struct.pack("<H", bits_per_sample))
        f.write(b"data")
        f.write(struct.pack("<I", len(raw)))
        f.write(raw)


class TestReadWavFloat32(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def _path(self, name):
        return os.path.join(self.tmpdir, name)

    def _sine(self, n=4800, sr=16000, freq=440):
        return np.sin(2 * np.pi * freq * np.arange(n) / sr).astype(np.float32)

    def test_ieee_float32_roundtrip(self):
        """Float32 WAV (format 3) — the format Swift produces."""
        samples = self._sine()
        path = self._path("float32.wav")
        _write_wav(path, samples, 16000, audio_format=3, bits_per_sample=32)

        result, sr = read_wav_float32(path)
        self.assertEqual(sr, 16000)
        self.assertEqual(result.dtype, np.float32)
        np.testing.assert_array_equal(result, samples)

    def test_pcm_int16(self):
        """Int16 PCM (format 1) — standard WAV format."""
        samples = self._sine()
        path = self._path("int16.wav")
        _write_wav(path, samples, 16000, audio_format=1, bits_per_sample=16)

        result, sr = read_wav_float32(path)
        self.assertEqual(sr, 16000)
        self.assertEqual(result.dtype, np.float32)
        # Int16 quantization loses precision, so use a tolerance.
        np.testing.assert_allclose(result, samples, atol=1 / 32768)

    def test_pcm_int32(self):
        """Int32 PCM (format 1)."""
        samples = self._sine()
        path = self._path("int32.wav")
        _write_wav(path, samples, 16000, audio_format=1, bits_per_sample=32)

        result, sr = read_wav_float32(path)
        self.assertEqual(sr, 16000)
        np.testing.assert_allclose(result, samples, atol=1 / 2147483648)

    def test_sample_rate_preserved(self):
        """Sample rate from header is returned correctly."""
        samples = self._sine(n=1000)
        path = self._path("sr48k.wav")
        _write_wav(path, samples, 48000, audio_format=3, bits_per_sample=32)

        _, sr = read_wav_float32(path)
        self.assertEqual(sr, 48000)

    def test_empty_audio(self):
        """Zero-length WAV still parses without error."""
        samples = np.array([], dtype=np.float32)
        path = self._path("empty.wav")
        _write_wav(path, samples, 16000, audio_format=3, bits_per_sample=32)

        result, sr = read_wav_float32(path)
        self.assertEqual(len(result), 0)
        self.assertEqual(sr, 16000)

    def test_rejects_non_wav(self):
        """Non-WAV file raises ValueError."""
        path = self._path("not_a_wav.txt")
        with open(path, "w") as f:
            f.write("not a wav file")

        with self.assertRaises(ValueError):
            read_wav_float32(path)

    def test_unsupported_format_raises(self):
        """WAV with unsupported audio format code raises ValueError."""
        path = self._path("alaw.wav")
        # Write a valid WAV header but with format=6 (A-law)
        with open(path, "wb") as f:
            f.write(b"RIFF")
            f.write(struct.pack("<I", 36))
            f.write(b"WAVE")
            f.write(b"fmt ")
            f.write(struct.pack("<I", 16))
            f.write(struct.pack("<H", 6))  # A-law
            f.write(struct.pack("<H", 1))
            f.write(struct.pack("<I", 16000))
            f.write(struct.pack("<I", 16000))
            f.write(struct.pack("<H", 1))
            f.write(struct.pack("<H", 8))
            f.write(b"data")
            f.write(struct.pack("<I", 0))

        with self.assertRaises(ValueError, msg="Unsupported WAV format: 6"):
            read_wav_float32(path)

    def test_skips_unknown_chunks(self):
        """WAV with extra chunks (e.g. LIST) between fmt and data is handled."""
        samples = self._sine(n=100)
        path = self._path("extra_chunks.wav")
        raw = samples.tobytes()
        junk = b"\x00" * 16

        with open(path, "wb") as f:
            total = 4 + (8 + 16) + (8 + len(junk)) + (8 + len(raw))
            f.write(b"RIFF")
            f.write(struct.pack("<I", total))
            f.write(b"WAVE")
            # fmt chunk
            f.write(b"fmt ")
            f.write(struct.pack("<I", 16))
            f.write(struct.pack("<H", 3))   # float
            f.write(struct.pack("<H", 1))
            f.write(struct.pack("<I", 16000))
            f.write(struct.pack("<I", 16000 * 4))
            f.write(struct.pack("<H", 4))
            f.write(struct.pack("<H", 32))
            # junk chunk (should be skipped)
            f.write(b"JUNK")
            f.write(struct.pack("<I", len(junk)))
            f.write(junk)
            # data chunk
            f.write(b"data")
            f.write(struct.pack("<I", len(raw)))
            f.write(raw)

        result, sr = read_wav_float32(path)
        np.testing.assert_array_equal(result, samples)


if __name__ == "__main__":
    unittest.main()
