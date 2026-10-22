"""Read one CAPTCHA PNG from stdin; return local pinned RapidOCR transcription only."""
import contextlib
import importlib.metadata
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "models/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx"
DICTIONARY = ROOT / "models/PP-OCRv5/rec/ppocrv5_dict.txt"


def recognize():
    if not MODEL.is_file() or not DICTIONARY.is_file():
        return {"ok": False, "code": "ocr_unavailable", "reason": "assets_missing"}
    if (importlib.metadata.version("rapidocr"), importlib.metadata.version("onnxruntime")) != ("3.10.0", "1.31.0"):
        return {"ok": False, "code": "ocr_unavailable", "reason": "environment_mismatch"}
    from rapidocr import EngineType, LangRec, ModelType, OCRVersion, RapidOCR
    engine = RapidOCR(params={
        "Global.use_det": False, "Global.use_cls": False, "Global.use_rec": True,
        "Global.log_level": "error", "Global.model_root_dir": str(ROOT / "models"),
        "Rec.engine_type": EngineType.ONNXRUNTIME, "Rec.lang_type": LangRec.CH,
        "Rec.model_type": ModelType.MOBILE, "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_path": str(MODEL), "Rec.rec_keys_path": str(DICTIONARY),
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "EngineConfig.onnxruntime.use_cuda": False,
        "EngineConfig.onnxruntime.use_coreml": False,
    })
    result = engine(sys.stdin.buffer.read(), use_det=False, use_cls=False, use_rec=True)
    texts = [] if result.txts is None else list(result.txts)
    scores = [] if result.scores is None else list(result.scores)
    if len(texts) != len(scores):
        return {"ok": False, "code": "ocr_failed", "reason": "invalid_result"}
    return {"ok": True, "rows": [{"text": str(text), "confidence": float(score)} for text, score in zip(texts, scores)]}


if __name__ == "__main__":
    try:
        # Keep framework logs off the JSON channel; image bytes never leave this process.
        with contextlib.redirect_stdout(sys.stderr):
            output = recognize()
    except Exception as exc:
        output = {"ok": False, "code": "ocr_failed", "reason": type(exc).__name__}
    print(json.dumps(output, ensure_ascii=False))
    sys.exit(0 if output.get("ok") else 1)
