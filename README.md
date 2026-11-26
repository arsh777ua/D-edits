# CutLite — Minimal Video Editor

A lightweight, CapCut Desktop-inspired web video editor built with **React**, **TypeScript**, **Tailwind CSS**, **Web Audio API**, **FFmpeg.wasm**, and an optional local **Python (`faster-whisper`)** auto-caption server.

## Features

- **Project Home Screen & Management**: Create, rename, duplicate, search, sort, and delete projects with customizable resolution (`360p`–`4K` & `Custom`), aspect ratio (`16:9`, `9:16`, `1:1`, `4:5`, `21:9`, `Custom`), frame rate (`24`–`60 FPS`), preview background, and local storage (`IndexedDB` + local folder `.cutlite.json`).
- **Multilayer Timeline**: Separate `Captions`, `Text`, `Video`, and `Audio` layers with `+ Video` / `+ Text` / `+ Audio` / `+ Captions` track controls, marquee drag multi-selection, `Shift`/`Ctrl`-click selection, clip snapping, trimming, splitting, and ripple delete (`Q` / `W`).
- **Interactive Preview**: Exact project-resolution preview stage, Web Audio API gain (`-100 dB` to `+20 dB`), transform/crop/rotate, brightness/contrast, playback speed (`0.5x`–`2x`), and direct canvas positioning.
- **Auto Captions (Hinglish & English)**: Local GPU/CPU transcription via `faster-whisper` with **8 animated caption templates** + Normal mode, customizable fonts, colors, outlines, shadows, background pills, and **Apply Style to All**.
- **Customizable Keyboard Shortcuts**: 21 default NLE shortcuts + mouse-wheel navigation (`Alt+Scroll` move, `Ctrl+Scroll` zoom, `Shift+Scroll` scrub), conflict detection, and `localStorage` persistence.
- **MP4 Export**: Fast GPU `MediaRecorder` MP4 export and high-quality FFmpeg.wasm `libx264` CRF export with `720p`–`4K` resolution and bitrate presets.

## Getting Started

### Prerequisites

- **Node.js** (v18+ recommended)
- **Python 3.10+** with `faster-whisper` (optional, for local Auto Captions & local folder saving):
  ```bash
  pip install faster-whisper
  ```

### Run on Windows

Double-click `start.bat` or run:

```bash
npm install
npm run dev
```

To run the local Auto-Caption & project folder server alongside the dev server:

```bash
python server/caption_server.py
```

## Build & Lint

```bash
npm run build
npm run lint
```
