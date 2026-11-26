import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRIDGE_URL =
  process.env.CUTLITE_BRIDGE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:8766';

async function bridgeRequest<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new Error(
      `Cannot reach CutLite Bridge at ${BRIDGE_URL}. Make sure CutLite is running (npm run dev or start.bat). Original error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    result?: T;
  } & T;

  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Bridge request failed with HTTP ${resp.status}`);
  }
  return data;
}

async function sendEditorCommand(
  action: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<unknown> {
  const res = await bridgeRequest<{ ok: boolean; result: unknown }>('/command', {
    method: 'POST',
    body: JSON.stringify({ action, params, timeoutMs }),
  });
  return res.result;
}

function jsonText(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorText(err: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: err instanceof Error ? err.message : String(err),
      },
    ],
  };
}

const server = new McpServer({
  name: 'cutlite-video-editor',
  version: '1.0.0',
});

// 1. Inspect editor state
server.tool(
  'get_editor_state',
  'Get the live state of the CutLite video editor (active project, screen, playhead, tracks, media assets, timeline clips, and saved projects).',
  {},
  async () => {
    try {
      const health = await bridgeRequest<{
        connectedBrowsers: number;
        hasState: boolean;
      }>('/health');
      if (health.connectedBrowsers > 0) {
        const state = await sendEditorCommand('get_state');
        return jsonText({ connected: true, state });
      }
      const cached = await bridgeRequest<{ connected: boolean; state: unknown }>('/state');
      return jsonText({
        connected: false,
        message:
          'No CutLite browser tab is currently connected. Open CutLite in your browser (e.g. http://localhost:5173).',
        lastKnownState: cached.state,
      });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'list_projects',
  'List all saved CutLite projects.',
  {},
  async () => {
    try {
      const result = await sendEditorCommand('list_projects');
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

// 2. Project management
server.tool(
  'create_project',
  'Create a new CutLite video project and open it in the editor.',
  {
    name: z.string().optional().describe('Project name (default: "AI Video Project")'),
    width: z.number().int().positive().optional().describe('Canvas width in px (e.g. 1920 or 1080)'),
    height: z.number().int().positive().optional().describe('Canvas height in px (e.g. 1080 or 1920)'),
    fps: z.enum(['24', '25', '30', '50', '60']).optional().describe('Frames per second'),
    resolutionPreset: z
      .enum(['360p', '480p', '720p', '1080p', '1440p', '2160p', 'custom'])
      .optional(),
    aspectRatioPreset: z
      .enum(['16:9', '9:16', '1:1', '4:5', '21:9', 'custom'])
      .optional(),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('create_project', {
        ...args,
        fps: args.fps ? Number(args.fps) : undefined,
      });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'open_project',
  'Open an existing saved CutLite project by its ID.',
  {
    projectId: z.string().describe('Project ID from list_projects or get_editor_state'),
  },
  async ({ projectId }) => {
    try {
      const result = await sendEditorCommand('open_project', { projectId });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'update_project_settings',
  'Update the active project name, resolution, or frame rate.',
  {
    name: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.enum(['24', '25', '30', '50', '60']).optional(),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('update_project_settings', {
        ...args,
        fps: args.fps ? Number(args.fps) : undefined,
      });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

// 3. Media library
server.tool(
  'import_media_from_path',
  'Import a local video, audio, or image file from disk into the CutLite Media Library.',
  {
    filePath: z.string().describe('Absolute or relative path to the local media file'),
    addToTimeline: z
      .boolean()
      .optional()
      .describe('If true, immediately place the imported media onto the timeline'),
    startTime: z
      .number()
      .min(0)
      .optional()
      .describe('Timeline start time in seconds (when addToTimeline is true)'),
    trackIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Track index (0 = base layer, 1+ = overlay)'),
  },
  async ({ filePath, addToTimeline, startTime, trackIndex }) => {
    try {
      const reg = await bridgeRequest<{
        url: string;
        name: string;
        mimeType: string;
        size: number;
      }>('/media/register', {
        method: 'POST',
        body: JSON.stringify({ filePath }),
      });

      const asset = (await sendEditorCommand(
        'import_media_url',
        {
          url: reg.url,
          name: reg.name,
          mimeType: reg.mimeType,
        },
        120000
      )) as { id: string };

      let timelineResult: unknown = undefined;
      if (addToTimeline && asset?.id) {
        timelineResult = await sendEditorCommand('add_media_to_timeline', {
          assetId: asset.id,
          startTime,
          trackIndex: trackIndex ?? 0,
        });
      }

      return jsonText({ asset, timelineResult });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'remove_media',
  'Remove a media asset from the Media Library and delete all timeline clips using it.',
  {
    assetId: z.string().describe('Media asset ID'),
  },
  async ({ assetId }) => {
    try {
      const result = await sendEditorCommand('remove_media', { assetId });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

// 4. Timeline & Clips
server.tool(
  'add_media_to_timeline',
  'Add an imported media asset to the timeline.',
  {
    assetId: z.string().describe('Media asset ID from get_editor_state'),
    startTime: z
      .number()
      .min(0)
      .optional()
      .describe('Start time in seconds (defaults to end of the target track)'),
    trackIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Track index (default 0)'),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('add_media_to_timeline', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'add_text_clip',
  'Add a text overlay clip to the timeline.',
  {
    text: z.string().describe('Text content to display'),
    startTime: z.number().min(0).optional().describe('Start time in seconds (defaults to playhead)'),
    duration: z.number().min(0.2).optional().describe('Duration in seconds (default 4)'),
    trackIndex: z.number().int().min(0).optional().describe('Text track index (default 0)'),
    fontSize: z.number().min(8).max(300).optional().describe('Font size in px (default 42)'),
    color: z.string().optional().describe('Text hex color (default "#ffffff")'),
    fontFamily: z.string().optional().describe('CSS font family'),
    x: z.number().min(-50).max(50).optional().describe('Horizontal offset % from center (-50 to 50)'),
    y: z.number().min(-50).max(50).optional().describe('Vertical offset % from center (-50 to 50, default 25)'),
    bold: z.boolean().optional(),
    outlineColor: z.string().optional(),
    outlineWidth: z.number().min(0).max(12).optional(),
    bgColor: z.string().optional(),
    bgOpacity: z.number().min(0).max(1).optional(),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('add_text_clip', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'add_caption_clips',
  'Add timed caption clips to the Captions track with optional animated templates.',
  {
    segments: z
      .array(
        z.object({
          start: z.number().min(0),
          end: z.number().min(0),
          text: z.string(),
          words: z
            .array(
              z.object({
                word: z.string(),
                start: z.number().min(0),
                end: z.number().min(0),
              })
            )
            .optional(),
        })
      )
      .min(1),
    style: z
      .object({
        fontSize: z.number().optional(),
        color: z.string().optional(),
        y: z.number().min(-50).max(50).optional(),
        fontFamily: z.string().optional(),
        captionTemplate: z
          .enum([
            'none',
            'one-word-pop',
            'one-word-box',
            'phrase-box',
            'phrase-clean',
            'phrase-highlight',
            'phrase-highlight-box',
            'neon-glow',
            'typewriter-wave',
          ])
          .optional(),
        highlightColor: z.string().optional(),
        bgColor: z.string().optional(),
        bgOpacity: z.number().min(0).max(1).optional(),
        outlineWidth: z.number().min(0).max(12).optional(),
      })
      .optional(),
    trackIndex: z.number().int().min(0).optional(),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('add_caption_clips', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'update_clip',
  'Update properties of an existing timeline clip (timing, trim, transform, crop, speed, volume, color, fades, or text style).',
  {
    clipId: z.string().describe('ID of the clip to update'),
    patch: z
      .object({
        name: z.string().optional(),
        startTime: z.number().min(0).optional(),
        duration: z.number().min(0.2).optional(),
        sourceStart: z.number().min(0).optional(),
        trackIndex: z.number().int().min(0).optional(),
        // Video transform & adjustments
        scale: z.number().min(0.1).max(3).optional(),
        x: z.number().min(-100).max(100).optional(),
        y: z.number().min(-100).max(100).optional(),
        rotate: z.number().min(-180).max(180).optional(),
        cropTop: z.number().min(0).max(45).optional(),
        cropRight: z.number().min(0).max(45).optional(),
        cropBottom: z.number().min(0).max(45).optional(),
        cropLeft: z.number().min(0).max(45).optional(),
        volume: z.number().min(0).max(2).optional(),
        speed: z.union([z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
        brightness: z.number().min(0.2).max(2).optional(),
        contrast: z.number().min(0.2).max(2).optional(),
        // Audio fades
        fadeIn: z.number().min(0).optional(),
        fadeOut: z.number().min(0).optional(),
        // Text / Captions
        text: z.string().optional(),
        fontSize: z.number().min(8).max(300).optional(),
        color: z.string().optional(),
        fontFamily: z.string().optional(),
        bold: z.boolean().optional(),
        outlineColor: z.string().optional(),
        outlineWidth: z.number().min(0).max(12).optional(),
        shadowColor: z.string().optional(),
        shadowBlur: z.number().min(0).max(24).optional(),
        captionTemplate: z
          .enum([
            'none',
            'one-word-pop',
            'one-word-box',
            'phrase-box',
            'phrase-clean',
            'phrase-highlight',
            'phrase-highlight-box',
            'neon-glow',
            'typewriter-wave',
          ])
          .optional(),
        highlightColor: z.string().optional(),
        bgColor: z.string().optional(),
        bgOpacity: z.number().min(0).max(1).optional(),
        // Motion Graphics (partial objects are merged with existing clip properties)
        presetName: z.string().optional(),
        layers: z.array(z.record(z.string(), z.unknown())).optional(),
        visual: z.record(z.string(), z.unknown()).optional(),
        transform: z.record(z.string(), z.unknown()).optional(),
        animation: z.record(z.string(), z.unknown()).optional(),
        specific: z.record(z.string(), z.unknown()).optional(),
        sfx: z.record(z.string(), z.unknown()).optional(),
      })
      .describe('Fields to update on the clip'),
  },
  async ({ clipId, patch }) => {
    try {
      const result = await sendEditorCommand('update_clip', { clipId, patch });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'split_clip',
  'Split a timeline clip into two clips at the given timeline time (seconds).',
  {
    clipId: z.string().describe('Clip ID to split'),
    time: z.number().min(0).describe('Timeline time in seconds where the cut should occur'),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('split_clip', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'ripple_delete_left',
  'Split a clip at `time`, delete the portion before `time`, and shift subsequent clips on that track left.',
  {
    clipId: z.string(),
    time: z.number().min(0),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('ripple_delete_left', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'ripple_delete_right',
  'Split a clip at `time`, delete the portion after `time`, and shift subsequent clips on that track left.',
  {
    clipId: z.string(),
    time: z.number().min(0),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('ripple_delete_right', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'delete_clips',
  'Delete one or more clips from the timeline by ID (or delete currently selected clips if omitted).',
  {
    clipIds: z.array(z.string()).optional(),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('delete_clips', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'apply_style_to_all_text',
  'Copy the font, color, position, and template styling from a text/caption clip to all other clips of the same trackType.',
  {
    sourceClipId: z.string(),
  },
  async ({ sourceClipId }) => {
    try {
      const result = await sendEditorCommand('apply_style_to_all_text', { sourceClipId });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

// 5. Motion Graphics, SFX & Silence Removal
server.tool(
  'list_graphic_presets',
  'List all built-in and custom motion graphic presets/templates available in CutLite.',
  {},
  async () => {
    try {
      const result = await sendEditorCommand('list_graphic_presets');
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'add_graphic_clip',
  'Add a motion graphic clip to the Graphics track from a presetId or templateId (use list_graphic_presets to see available IDs and customizable properties).',
  {
    presetId: z.string().optional().describe('Preset ID (e.g. "tpl-moving-grid-pop-text")'),
    templateId: z.string().optional().describe('Template ID (e.g. "moving-grid-counter", "cinematic-title-reveal")'),
    startTime: z.number().min(0).optional().describe('Start time in seconds (defaults to playhead)'),
    duration: z.number().min(0.2).optional().describe('Duration in seconds'),
    trackIndex: z.number().int().min(0).optional().describe('Graphics track index (default 0)'),
    layers: z.array(z.record(z.string(), z.unknown())).optional().describe('Override layers array'),
    visual: z.record(z.string(), z.unknown()).optional().describe('Partial visual style overrides'),
    transform: z.record(z.string(), z.unknown()).optional().describe('Partial transform overrides'),
    animation: z.record(z.string(), z.unknown()).optional().describe('Partial animation overrides'),
    specific: z.record(z.string(), z.unknown()).optional().describe('Template-specific overrides (e.g. countFrom, countTo, gridSize)'),
    sfx: z.record(z.string(), z.unknown()).optional().describe('Sound effect overrides (enabled, sfxFile, volume, triggerMode, delay)'),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('add_graphic_clip', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'save_graphic_preset',
  'Save an existing GraphicClip on the timeline as a reusable custom graphic preset.',
  {
    clipId: z.string().describe('ID of the graphic clip to save'),
    name: z.string().describe('Name for the saved custom preset'),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('save_graphic_preset', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'delete_graphic_preset',
  'Delete a custom saved graphic preset by ID.',
  {
    presetId: z.string().describe('Custom preset ID to delete'),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('delete_graphic_preset', args);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'list_sfx',
  'List all built-in sound effects (SFX) available for motion graphics.',
  {},
  async () => {
    try {
      const result = await sendEditorCommand('list_sfx');
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'remove_silence',
  'Automatically detect and remove silent pauses from a video or audio clip.',
  {
    clipId: z.string().describe('ID of the video or audio clip to process'),
    thresholdDb: z
      .number()
      .min(-60)
      .max(-10)
      .optional()
      .describe('Volume threshold in dB below which audio is treated as silence (default -35)'),
    minSilenceSec: z
      .number()
      .min(0.1)
      .max(2.0)
      .optional()
      .describe('Minimum silence duration in seconds to cut (default 0.35)'),
    paddingSec: z
      .number()
      .min(0)
      .max(0.3)
      .optional()
      .describe('Padding in seconds kept around speech (default 0.08)'),
    rippleCloseGaps: z
      .boolean()
      .optional()
      .describe('If true, close gaps between remaining speech segments (default true)'),
  },
  async (args) => {
    try {
      const result = await sendEditorCommand('remove_silence', args, 60000);
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

// 6. Tracks, Transport, History, Export
server.tool(
  'manage_track',
  'Add or remove a timeline track.',
  {
    action: z.enum(['add', 'remove']),
    type: z.enum(['video', 'audio', 'text', 'captions', 'graphics']),
    index: z.number().int().min(0).optional().describe('Required when action is "remove"'),
  },
  async ({ action, type, index }) => {
    try {
      const result = await sendEditorCommand(
        action === 'add' ? 'add_track' : 'remove_track',
        { type, index }
      );
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'set_playhead',
  'Seek the timeline playhead to a specific time in seconds.',
  {
    time: z.number().min(0),
  },
  async ({ time }) => {
    try {
      const result = await sendEditorCommand('set_playhead', { time });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'set_playback',
  'Play or pause preview playback in the editor.',
  {
    playing: z.boolean(),
  },
  async ({ playing }) => {
    try {
      const result = await sendEditorCommand('set_playback', { playing });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'select_clips',
  'Select specific clips on the timeline.',
  {
    clipIds: z.array(z.string()),
  },
  async ({ clipIds }) => {
    try {
      const result = await sendEditorCommand('select_clips', { clipIds });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'undo',
  'Undo the most recent timeline edit.',
  {},
  async () => {
    try {
      const result = await sendEditorCommand('undo');
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'redo',
  'Redo the most recently undone timeline edit.',
  {},
  async () => {
    try {
      const result = await sendEditorCommand('redo');
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

server.tool(
  'open_export_modal',
  'Open or close the video Export modal in the CutLite UI.',
  {
    open: z.boolean().optional().default(true),
  },
  async ({ open }) => {
    try {
      const result = await sendEditorCommand('open_export_modal', { open });
      return jsonText(result);
    } catch (err) {
      return errorText(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[CutLite MCP] Server running on stdio (bridge: ${BRIDGE_URL})`);
}

main().catch((err) => {
  console.error('[CutLite MCP] Fatal error:', err);
  process.exit(1);
});
