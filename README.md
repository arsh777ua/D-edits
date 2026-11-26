# D-EDITS

A web-based video editor built with React, TypeScript, Vite, Tailwind CSS, FFmpeg, and a built-in CutLite AI MCP server.

## Getting Started

```bash
npm install
npm run dev
```

Or on Windows, run `start.bat` to install dependencies (if needed), start the optional Python auto-caption server (`server/caption_server.py`), and launch the dev server.

### Scripts

- `npm run dev` — Start the Vite development server (and local MCP bridge on `http://127.0.0.1:8766`)
- `npm run build` — Type-check, build the MCP server, and bundle the app into `dist/`
- `npm run build:mcp` — Build only the MCP server (`mcp/dist/server.js`)
- `npm run lint` — Run Oxlint
- `npm run preview` — Preview the production build


## CutLite AI MCP Server

CutLite includes a built-in **Model Context Protocol (MCP)** server so any AI CLI (Claude Code, Gemini CLI, Codex CLI, Cursor, Antigravity, etc.) can inspect and edit videos directly inside the live editor.

### How it works

1. **Editor + Bridge (`http://127.0.0.1:8766`)**: When you start CutLite (`npm run dev` or `start.bat`), Vite automatically starts the local CutLite MCP Bridge on port `8766`. The open browser tab connects to it via Server-Sent Events (SSE).
2. **MCP Server (`mcp/dist/server.js`)**: Any AI CLI spawns `node mcp/dist/server.js` over `stdio`. Each tool call is forwarded through the bridge to your live CutLite editor.

### Build the MCP server

```bash
npm run build:mcp
```

### Connect from any CLI

- **Claude Code**:
  ```bash
  claude mcp add cutlite -- node "./mcp/dist/server.js"
  ```
- **Gemini CLI / Codex / Cursor / Antigravity** (MCP JSON config):
  ```json
  {
    "mcpServers": {
      "cutlite": {
        "command": "node",
        "args": ["./mcp/dist/server.js"]
      }
    }
  }
  ```

### Available MCP Tools

- **Inspect & Projects**: `get_editor_state`, `list_projects`, `create_project`, `open_project`, `update_project_settings`
- **Media**: `import_media_from_path`, `remove_media`, `add_media_to_timeline`
- **Editing & Timeline**: `add_text_clip`, `add_caption_clips`, `update_clip`, `split_clip`, `ripple_delete_left`, `ripple_delete_right`, `delete_clips`, `apply_style_to_all_text`, `manage_track`
- **Playback & History**: `set_playhead`, `set_playback`, `select_clips`, `undo`, `redo`, `open_export_modal`
