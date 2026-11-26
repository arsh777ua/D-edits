#!/usr/bin/env python3
"""Local HTTP server for fast Hinglish & English auto-caption generation.

Based on transcribe_hinglish.py using faster-whisper (CTranslate2) with CUDA
GPU acceleration and automatic CPU fallback.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
from email.parser import BytesParser
from email.policy import default as default_email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def _register_nvidia_dlls() -> None:
    """Ensure pip-installed nvidia-cublas-cu12 / nvidia-cudnn-cu12 DLLs are discoverable on Windows."""
    if os.name != "nt":
        return
    for site_dir in sys.path:
        nvidia_root = Path(site_dir) / "nvidia"
        if not nvidia_root.is_dir():
            continue
        for bin_dir in nvidia_root.glob("*/bin"):
            if bin_dir.is_dir():
                os.add_dll_directory(str(bin_dir))
                os.environ["PATH"] = f"{bin_dir};{os.environ.get('PATH', '')}"


_register_nvidia_dlls()

HINGLISH_MODEL = "MSpider3/whisper-hindi2hinglish-swift-ct2"
HINGLISH_PROMPT = (
    "Yeh ek Hinglish YouTube video hai jismein Hindi aur English dono words "
    "Roman script mein likhe jaate hain. Jaise: aaj hum seekhenge ki video "
    "kaise edit karte hain."
)

ENGLISH_MODEL = "base.en"
ENGLISH_PROMPT = "Clear English transcription with proper punctuation."

_MODEL_CACHE: dict[str, tuple[Any, str, str]] = {}


def get_cached_model(mode: str):
    model_name = HINGLISH_MODEL if mode == "hinglish" else ENGLISH_MODEL
    if model_name in _MODEL_CACHE:
        return _MODEL_CACHE[model_name]

    import ctranslate2
    from faster_whisper import WhisperModel

    has_cuda = False
    try:
        has_cuda = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        has_cuda = False

    device = "cuda" if has_cuda else "cpu"
    compute_type = "int8_float16" if device == "cuda" else "int8"

    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception:
        if device == "cuda":
            device = "cpu"
            compute_type = "int8"
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
        else:
            raise

    _MODEL_CACHE[model_name] = (model, device, compute_type)
    return model, device, compute_type


def transcribe_bytes(file_bytes: bytes, filename: str, mode: str) -> dict[str, Any]:
    suffix = Path(filename).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        model, device, compute_type = get_cached_model(mode)
        prompt = HINGLISH_PROMPT if mode == "hinglish" else ENGLISH_PROMPT

        segments_iter, info = model.transcribe(
            str(tmp_path),
            language="en",
            task="transcribe",
            beam_size=5,
            initial_prompt=prompt,
            word_timestamps=True,
            vad_filter=True,
        )

        segments: list[dict[str, Any]] = []
        for idx, seg in enumerate(segments_iter, start=1):
            text = seg.text.strip()
            if not text:
                continue
            words = []
            if seg.words:
                for w in seg.words:
                    words.append(
                        {
                            "word": w.word.strip(),
                            "start": round(float(w.start), 3),
                            "end": round(float(w.end), 3),
                        }
                    )
            segments.append(
                {
                    "id": idx,
                    "start": round(float(seg.start), 3),
                    "end": round(float(seg.end), 3),
                    "text": text,
                    "words": words,
                }
            )

        return {
            "mode": mode,
            "model": HINGLISH_MODEL if mode == "hinglish" else ENGLISH_MODEL,
            "device": device,
            "compute_type": compute_type,
            "duration": round(float(getattr(info, "duration", 0.0)), 3),
            "segments": segments,
        }
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def parse_multipart(content_type: str, body: bytes) -> tuple[bytes | None, str, str]:
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
    msg = BytesParser(policy=default_email_policy).parsebytes(header + body)

    file_bytes: bytes | None = None
    filename = "clip.mp4"
    mode = "hinglish"

    if msg.is_multipart():
        for part in msg.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name == "file":
                filename = part.get_filename() or filename
                payload = part.get_payload(decode=True)
                if isinstance(payload, (bytes, bytearray)):
                    file_bytes = bytes(payload)
            elif name == "mode":
                val = part.get_content()
                if isinstance(val, str) and val.strip() in ("hinglish", "english"):
                    mode = val.strip()

    return file_bytes, filename, mode


def get_default_projects_dir() -> Path:
    docs = Path.home() / "Documents"
    target = docs / "CutLite Projects"
    target.mkdir(parents=True, exist_ok=True)
    return target


class CaptionHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._send_json(200, {"ok": True})
            return
        if self.path == "/api/default-location":
            try:
                default_dir = get_default_projects_dir()
                self._send_json(200, {"path": str(default_dir)})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path == "/api/pick-folder":
            try:
                import tkinter as tk
                from tkinter import filedialog

                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                initial = str(get_default_projects_dir())
                selected = filedialog.askdirectory(
                    initialdir=initial,
                    title="Select Project Folder",
                )
                root.destroy()
                if selected:
                    self._send_json(200, {"path": str(Path(selected))})
                else:
                    self._send_json(200, {"path": None})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if self.path == "/api/save-project":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                base_path = Path(payload.get("folderPath") or get_default_projects_dir())
                record = payload.get("record") or {}
                proj_name = str(record.get("name") or "Untitled Project").strip()
                safe_name = "".join(
                    ch if ch.isalnum() or ch in (" ", "-", "_") else "_"
                    for ch in proj_name
                ).strip() or "Untitled_Project"
                proj_dir = base_path / safe_name
                proj_dir.mkdir(parents=True, exist_ok=True)
                proj_file = proj_dir / "project.cutlite.json"
                proj_file.write_text(
                    json.dumps(record, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                self._send_json(200, {"ok": True, "savedPath": str(proj_file)})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if self.path != "/api/transcribe":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            content_type = self.headers.get("Content-Type", "")
            body = self.rfile.read(length)
            file_bytes, filename, mode = parse_multipart(content_type, body)

            if not file_bytes:
                self._send_json(400, {"error": "No media file uploaded."})
                return

            result = transcribe_bytes(file_bytes, filename, mode)
            self._send_json(200, result)
        except Exception as exc:
            traceback.print_exc()
            self._send_json(500, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[caption-server] {format % args}")


def main() -> None:
    port = int(os.environ.get("CAPTION_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), CaptionHandler)
    print(f"[caption-server] Listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
