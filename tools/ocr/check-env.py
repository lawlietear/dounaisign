"""Validate local Windows OCR setup without visiting the site or reading credentials."""
import contextlib
import importlib.metadata
import json
import platform
import sys
from pathlib import Path

if sys.platform != 'win32' or sys.maxsize <= 2**32 or platform.machine().upper() not in ('AMD64', 'X86_64') or sys.version_info[:2] != (3, 12):
    raise SystemExit('Windows x64 CPython 3.12 is required.')
if (importlib.metadata.version('rapidocr'), importlib.metadata.version('onnxruntime')) != ('3.10.0', '1.31.0'):
    raise SystemExit('Pinned OCR versions do not match.')

root = Path(__file__).resolve().parent
with contextlib.redirect_stdout(sys.stderr):
    import onnxruntime as ort
    import rapidocr
    session = ort.InferenceSession(str(root / 'models/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx'), providers=['CPUExecutionProvider'])
print(json.dumps({'python': platform.python_version(), 'rapidocr': importlib.metadata.version('rapidocr'),
                 'onnxruntime': ort.__version__, 'providers': session.get_providers(),
                 'modelSessionInitialized': True}))
