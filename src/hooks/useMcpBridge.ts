import { useEffect, useRef } from 'react';
import type {
  AudioClip,
  CaptionTemplateId,
  CaptionWord,
  GraphicClip,
  GraphicPreset,
  ProjectRecord,
  ProjectSettings,
  TextClip,
  TimelineClip,
  TrackType,
  VideoClip,
} from '../types/editor';
import { BUILTIN_GRAPHIC_PRESETS } from '../utils/graphicTemplates';
import { DEFAULT_PROJECT_SETTINGS } from '../utils/projectConfig';
import { fetchSfxList } from '../utils/sfx';
import {
  buildClipsFromActiveSegments,
  decodeAssetAudioBuffer,
  detectActiveSegments,
  type SilenceRemovalOptions,
} from '../utils/silenceRemoval';
import {
  rippleDeleteLeftAtTime,
  rippleDeleteRightAtTime,
  splitClipAtTime,
} from '../utils/timeline';
import type { useEditorState } from './useEditorState';

const BRIDGE_URL = 'http://127.0.0.1:8766';

type EditorHandle = ReturnType<typeof useEditorState>;

export interface McpBridgeOptions {
  editor: EditorHandle;
  screen: 'home' | 'editor';
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  projectSettings: ProjectSettings;
  customGraphicPresets: GraphicPreset[];
  onCreateProject: (name: string, settings: ProjectSettings) => Promise<void>;
  onOpenProject: (record: ProjectRecord) => Promise<void>;
  onUpdateProjectSettings: (name: string, settings: ProjectSettings) => Promise<void>;
  onSaveGraphicPreset: (clip: GraphicClip, name: string) => void;
  onDeleteGraphicPreset: (presetId: string) => void;
  onSetExportOpen: (open: boolean) => void;
}

function serializeState(opts: McpBridgeOptions) {
  const { editor, screen, activeProject, projects, projectSettings } = opts;
  return {
    screen,
    activeProjectId: activeProject?.id ?? null,
    projectName: editor.projectName,
    projectSettings,
    projectDuration: editor.projectDuration,
    playhead: editor.playhead,
    isPlaying: editor.isPlaying,
    zoom: editor.zoom,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    selectedClipIds: editor.selectedClipIds,
    tracks: editor.tracks,
    mediaAssets: editor.mediaAssets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      duration: a.duration,
      width: a.width,
      height: a.height,
      mimeType: a.mimeType,
    })),
    clips: editor.clips,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      duration: p.duration,
      settings: p.settings,
      updatedAt: p.updatedAt,
    })),
  };
}

export function useMcpBridge(options: McpBridgeOptions) {
  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });

  // Sync state snapshot to the local bridge
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const snapshot = serializeState(latestRef.current);
      void fetch(`${BRIDGE_URL}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      }).catch(() => {});
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    options.screen,
    options.activeProject?.id,
    options.editor.projectName,
    options.projectSettings,
    options.editor.projectDuration,
    options.editor.playhead,
    options.editor.isPlaying,
    options.editor.zoom,
    options.editor.tracks,
    options.editor.mediaAssets,
    options.editor.clips,
    options.editor.selectedClipIds,
    options.editor.canUndo,
    options.editor.canRedo,
    options.projects,
  ]);

  // Listen for commands from the bridge over SSE
  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const postResult = async (
      id: string,
      ok: boolean,
      result?: unknown,
      error?: string
    ) => {
      await fetch(`${BRIDGE_URL}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ok, result, error }),
      }).catch(() => {});
    };

    const handleCommand = async (id: string, action: string, params: Record<string, unknown>) => {
      const opts = latestRef.current;
      const { editor } = opts;

      try {
        switch (action) {
          case 'get_state': {
            await postResult(id, true, serializeState(opts));
            return;
          }

          case 'list_projects': {
            await postResult(
              id,
              true,
              opts.projects.map((p) => ({
                id: p.id,
                name: p.name,
                duration: p.duration,
                settings: p.settings,
                updatedAt: p.updatedAt,
              }))
            );
            return;
          }

          case 'create_project': {
            const name = typeof params.name === 'string' && params.name.trim()
              ? params.name.trim()
              : 'AI Video Project';
            const settings: ProjectSettings = {
              ...DEFAULT_PROJECT_SETTINGS,
              width: typeof params.width === 'number' ? params.width : DEFAULT_PROJECT_SETTINGS.width,
              height: typeof params.height === 'number' ? params.height : DEFAULT_PROJECT_SETTINGS.height,
              fps: (typeof params.fps === 'number' ? params.fps : DEFAULT_PROJECT_SETTINGS.fps) as ProjectSettings['fps'],
              resolutionPreset:
                (typeof params.resolutionPreset === 'string'
                  ? params.resolutionPreset
                  : DEFAULT_PROJECT_SETTINGS.resolutionPreset) as ProjectSettings['resolutionPreset'],
              aspectRatioPreset:
                (typeof params.aspectRatioPreset === 'string'
                  ? params.aspectRatioPreset
                  : DEFAULT_PROJECT_SETTINGS.aspectRatioPreset) as ProjectSettings['aspectRatioPreset'],
            };
            await opts.onCreateProject(name, settings);
            await postResult(id, true, { name, settings });
            return;
          }

          case 'open_project': {
            const projectId = String(params.projectId ?? '');
            const target = opts.projects.find((p) => p.id === projectId);
            if (!target) {
              await postResult(id, false, undefined, `Project not found: ${projectId}`);
              return;
            }
            await opts.onOpenProject(target);
            await postResult(id, true, { id: target.id, name: target.name });
            return;
          }

          case 'update_project_settings': {
            if (!opts.activeProject) {
              await postResult(id, false, undefined, 'No active project open');
              return;
            }
            const nextName =
              typeof params.name === 'string' && params.name.trim()
                ? params.name.trim()
                : opts.editor.projectName;
            const nextSettings: ProjectSettings = {
              ...opts.projectSettings,
              width: typeof params.width === 'number' ? params.width : opts.projectSettings.width,
              height: typeof params.height === 'number' ? params.height : opts.projectSettings.height,
              fps: (typeof params.fps === 'number' ? params.fps : opts.projectSettings.fps) as ProjectSettings['fps'],
            };
            await opts.onUpdateProjectSettings(nextName, nextSettings);
            await postResult(id, true, { name: nextName, settings: nextSettings });
            return;
          }

          case 'import_media_url': {
            const url = String(params.url ?? '');
            const name = String(params.name ?? 'media');
            const mimeType = String(params.mimeType ?? 'application/octet-stream');
            if (!url) {
              await postResult(id, false, undefined, 'Missing media URL');
              return;
            }
            const resp = await fetch(url);
            if (!resp.ok) {
              await postResult(id, false, undefined, `Failed to fetch media: ${resp.status}`);
              return;
            }
            const blob = await resp.blob();
            const file = new File([blob], name, { type: mimeType || blob.type });
            const created = await editor.addMediaFiles([file]);
            if (created.length === 0) {
              await postResult(id, false, undefined, `Unsupported or unreadable media file: ${name}`);
              return;
            }
            const asset = created[0];
            await postResult(id, true, {
              id: asset.id,
              name: asset.name,
              type: asset.type,
              duration: asset.duration,
              width: asset.width,
              height: asset.height,
              mimeType: asset.mimeType,
            });
            return;
          }

          case 'remove_media': {
            const assetId = String(params.assetId ?? '');
            const exists = editor.mediaAssets.some((a) => a.id === assetId);
            if (!exists) {
              await postResult(id, false, undefined, `Media asset not found: ${assetId}`);
              return;
            }
            editor.removeMediaAsset(assetId);
            await postResult(id, true, { removedAssetId: assetId });
            return;
          }

          case 'add_media_to_timeline': {
            const assetId = String(params.assetId ?? '');
            const asset = editor.mediaAssets.find((a) => a.id === assetId);
            if (!asset) {
              await postResult(id, false, undefined, `Media asset not found: ${assetId}`);
              return;
            }
            const startTime =
              typeof params.startTime === 'number' ? params.startTime : undefined;
            const trackIndex =
              typeof params.trackIndex === 'number' ? params.trackIndex : 0;
            editor.addMediaToTimeline(asset, startTime, trackIndex);
            await postResult(id, true, {
              addedAssetId: asset.id,
              name: asset.name,
              trackIndex,
              startTime: startTime ?? 'end-of-track',
            });
            return;
          }

          case 'add_text_clip': {
            const preset: Partial<TextClip> = {
              text: typeof params.text === 'string' ? params.text : 'Text Overlay',
              duration: typeof params.duration === 'number' ? Math.max(0.2, params.duration) : 4,
              fontSize: typeof params.fontSize === 'number' ? params.fontSize : 42,
              color: typeof params.color === 'string' ? params.color : '#ffffff',
              fontFamily: typeof params.fontFamily === 'string' ? params.fontFamily : 'Inter, sans-serif',
              x: typeof params.x === 'number' ? params.x : 0,
              y: typeof params.y === 'number' ? params.y : 25,
              bold: typeof params.bold === 'boolean' ? params.bold : undefined,
              outlineColor: typeof params.outlineColor === 'string' ? params.outlineColor : undefined,
              outlineWidth: typeof params.outlineWidth === 'number' ? params.outlineWidth : undefined,
              bgColor: typeof params.bgColor === 'string' ? params.bgColor : undefined,
              bgOpacity: typeof params.bgOpacity === 'number' ? params.bgOpacity : undefined,
            };
            const trackIndex = typeof params.trackIndex === 'number' ? params.trackIndex : 0;
            const startTime = typeof params.startTime === 'number' ? params.startTime : undefined;
            editor.addTextClip(preset, trackIndex, startTime);
            await postResult(id, true, { added: true, text: preset.text });
            return;
          }

          case 'add_caption_clips': {
            const segments = Array.isArray(params.segments)
              ? (params.segments as Array<{
                  start: number;
                  end: number;
                  text: string;
                  words?: CaptionWord[];
                }>)
              : [];
            if (segments.length === 0) {
              await postResult(id, false, undefined, 'No caption segments provided');
              return;
            }
            const rawStyle = (params.style ?? {}) as Record<string, unknown>;
            const style = {
              fontSize: typeof rawStyle.fontSize === 'number' ? rawStyle.fontSize : 40,
              color: typeof rawStyle.color === 'string' ? rawStyle.color : '#ffffff',
              y: typeof rawStyle.y === 'number' ? rawStyle.y : 34,
              fontFamily: typeof rawStyle.fontFamily === 'string' ? rawStyle.fontFamily : 'Inter, sans-serif',
              captionTemplate: (typeof rawStyle.captionTemplate === 'string'
                ? rawStyle.captionTemplate
                : 'phrase-highlight') as CaptionTemplateId,
              highlightColor: typeof rawStyle.highlightColor === 'string' ? rawStyle.highlightColor : '#fde047',
              bgColor: typeof rawStyle.bgColor === 'string' ? rawStyle.bgColor : '#000000',
              bgOpacity: typeof rawStyle.bgOpacity === 'number' ? rawStyle.bgOpacity : 0,
              outlineWidth: typeof rawStyle.outlineWidth === 'number' ? rawStyle.outlineWidth : 2,
            };
            const trackIndex = typeof params.trackIndex === 'number' ? params.trackIndex : 0;
            editor.addCaptionClips(segments, style, trackIndex);
            await postResult(id, true, { count: segments.length });
            return;
          }

          case 'list_graphic_presets': {
            const allPresets = [...BUILTIN_GRAPHIC_PRESETS, ...opts.customGraphicPresets];
            await postResult(
              id,
              true,
              allPresets.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                templateId: p.templateId,
                category: p.category,
                defaultDuration: p.defaultDuration,
                isCustom: Boolean(p.isCustom),
                layers: p.layers,
                specific: p.specific,
                sfx: p.sfx,
              }))
            );
            return;
          }

          case 'add_graphic_clip': {
            const allPresets = [...BUILTIN_GRAPHIC_PRESETS, ...opts.customGraphicPresets];
            const presetId = typeof params.presetId === 'string' ? params.presetId : undefined;
            const templateId = typeof params.templateId === 'string' ? params.templateId : undefined;
            const basePreset =
              (presetId ? allPresets.find((p) => p.id === presetId) : undefined) ??
              (templateId ? allPresets.find((p) => p.templateId === templateId) : undefined);

            if (!basePreset) {
              await postResult(
                id,
                false,
                undefined,
                `Graphic preset not found (presetId=${presetId ?? 'none'}, templateId=${templateId ?? 'none'}). Call list_graphic_presets first.`
              );
              return;
            }

            const overriddenPreset: GraphicPreset = {
              ...basePreset,
              defaultDuration:
                typeof params.duration === 'number'
                  ? Math.max(0.2, params.duration)
                  : basePreset.defaultDuration,
              layers: Array.isArray(params.layers)
                ? (params.layers as GraphicPreset['layers'])
                : basePreset.layers,
              visual:
                params.visual && typeof params.visual === 'object'
                  ? { ...basePreset.visual, ...(params.visual as Partial<GraphicPreset['visual']>) }
                  : basePreset.visual,
              transform:
                params.transform && typeof params.transform === 'object'
                  ? { ...basePreset.transform, ...(params.transform as Partial<GraphicPreset['transform']>) }
                  : basePreset.transform,
              animation:
                params.animation && typeof params.animation === 'object'
                  ? { ...basePreset.animation, ...(params.animation as Partial<GraphicPreset['animation']>) }
                  : basePreset.animation,
              specific:
                params.specific && typeof params.specific === 'object'
                  ? { ...basePreset.specific, ...(params.specific as Partial<GraphicPreset['specific']>) }
                  : basePreset.specific,
              sfx:
                params.sfx && typeof params.sfx === 'object'
                  ? {
                      enabled: true,
                      sfxFile: 'pop.mp3',
                      volume: 0.85,
                      triggerMode: 'on-start',
                      ...(basePreset.sfx ?? {}),
                      ...(params.sfx as Partial<NonNullable<GraphicPreset['sfx']>>),
                    }
                  : basePreset.sfx,
            };

            const trackIndex = typeof params.trackIndex === 'number' ? params.trackIndex : 0;
            const startTime = typeof params.startTime === 'number' ? params.startTime : undefined;
            editor.addGraphicClip(overriddenPreset, trackIndex, startTime);
            await postResult(id, true, {
              added: true,
              presetId: basePreset.id,
              templateId: basePreset.templateId,
              name: basePreset.name,
              trackIndex,
              startTime: startTime ?? editor.playhead,
            });
            return;
          }

          case 'save_graphic_preset': {
            const clipId = String(params.clipId ?? '');
            const name = String(params.name ?? '');
            const target = editor.clips.find(
              (c): c is GraphicClip => c.id === clipId && c.trackType === 'graphics'
            );
            if (!target) {
              await postResult(id, false, undefined, `Graphic clip not found: ${clipId}`);
              return;
            }
            opts.onSaveGraphicPreset(target, name || `${target.name} Preset`);
            await postResult(id, true, { savedFromClipId: clipId, name });
            return;
          }

          case 'delete_graphic_preset': {
            const presetId = String(params.presetId ?? '');
            if (!presetId) {
              await postResult(id, false, undefined, 'Missing presetId');
              return;
            }
            opts.onDeleteGraphicPreset(presetId);
            await postResult(id, true, { deletedPresetId: presetId });
            return;
          }

          case 'list_sfx': {
            const files = await fetchSfxList();
            await postResult(id, true, files);
            return;
          }

          case 'remove_silence': {
            const clipId = String(params.clipId ?? '');
            const target = editor.clips.find(
              (c): c is VideoClip | AudioClip =>
                c.id === clipId && (c.trackType === 'video' || c.trackType === 'audio')
            );
            if (!target) {
              await postResult(
                id,
                false,
                undefined,
                `Video or audio clip not found: ${clipId}`
              );
              return;
            }
            const asset = editor.mediaAssets.find((a) => a.id === target.mediaId);
            if (!asset) {
              await postResult(id, false, undefined, `Media asset not found for clip: ${clipId}`);
              return;
            }
            if (target.trackType === 'video' && target.mediaType === 'image') {
              await postResult(id, false, undefined, 'Cannot remove silence from an image clip');
              return;
            }

            const silenceOpts: SilenceRemovalOptions = {
              thresholdDb:
                typeof params.thresholdDb === 'number' ? params.thresholdDb : -35,
              minSilenceSec:
                typeof params.minSilenceSec === 'number' ? params.minSilenceSec : 0.35,
              paddingSec:
                typeof params.paddingSec === 'number' ? params.paddingSec : 0.08,
              rippleCloseGaps:
                typeof params.rippleCloseGaps === 'boolean' ? params.rippleCloseGaps : true,
            };

            const audioBuffer = await decodeAssetAudioBuffer(asset);
            const analysis = detectActiveSegments(audioBuffer, target, silenceOpts);
            if (analysis.segments.length === 0) {
              await postResult(
                id,
                false,
                undefined,
                'No active audio segments detected above threshold; try lowering thresholdDb.'
              );
              return;
            }

            const replacementClips = buildClipsFromActiveSegments(
              target,
              analysis.segments,
              silenceOpts.rippleCloseGaps
            );

            editor.applyEdit((prev) =>
              prev.flatMap((c) => (c.id === target.id ? replacementClips : [c]))
            );
            if (replacementClips[0]) {
              editor.setSelectedClipId(replacementClips[0].id);
            }

            await postResult(id, true, {
              clipId,
              originalDuration: analysis.originalDuration,
              keptDuration: analysis.keptDuration,
              removedSeconds: analysis.removedSeconds,
              segmentCount: replacementClips.length,
              newClipIds: replacementClips.map((c) => c.id),
            });
            return;
          }

          case 'update_clip': {
            const clipId = String(params.clipId ?? '');
            const rawPatch = (params.patch ?? {}) as Record<string, unknown>;
            const target = editor.clips.find((c) => c.id === clipId);
            if (!target) {
              await postResult(id, false, undefined, `Clip not found: ${clipId}`);
              return;
            }

            let patch: Partial<TimelineClip> = rawPatch as Partial<TimelineClip>;
            if (target.trackType === 'graphics') {
              const gPatch: Partial<GraphicClip> = { ...(rawPatch as Partial<GraphicClip>) };
              if (rawPatch.visual && typeof rawPatch.visual === 'object') {
                gPatch.visual = { ...target.visual, ...(rawPatch.visual as Partial<GraphicClip['visual']>) };
              }
              if (rawPatch.transform && typeof rawPatch.transform === 'object') {
                gPatch.transform = {
                  ...target.transform,
                  ...(rawPatch.transform as Partial<GraphicClip['transform']>),
                };
              }
              if (rawPatch.animation && typeof rawPatch.animation === 'object') {
                gPatch.animation = {
                  ...target.animation,
                  ...(rawPatch.animation as Partial<GraphicClip['animation']>),
                };
              }
              if (rawPatch.specific && typeof rawPatch.specific === 'object') {
                gPatch.specific = {
                  ...target.specific,
                  ...(rawPatch.specific as Partial<GraphicClip['specific']>),
                };
              }
              if (rawPatch.sfx && typeof rawPatch.sfx === 'object') {
                gPatch.sfx = {
                  enabled: true,
                  sfxFile: 'pop.mp3',
                  volume: 0.85,
                  triggerMode: 'on-start',
                  ...(target.sfx ?? {}),
                  ...(rawPatch.sfx as Partial<NonNullable<GraphicClip['sfx']>>),
                };
              }
              patch = gPatch;
            }

            editor.updateClip(clipId, patch, true);
            await postResult(id, true, { clipId, patch });
            return;
          }

          case 'delete_clips': {
            const clipIds = Array.isArray(params.clipIds)
              ? params.clipIds.map(String)
              : editor.selectedClipIds;
            if (clipIds.length === 0) {
              await postResult(id, false, undefined, 'No clipIds provided or selected');
              return;
            }
            const toRemove = new Set(clipIds);
            editor.applyEdit((prev) => prev.filter((c) => !toRemove.has(c.id)));
            editor.setSelectedClipIds((prev) => prev.filter((cid) => !toRemove.has(cid)));
            await postResult(id, true, { deletedClipIds: clipIds });
            return;
          }

          case 'split_clip': {
            const clipId = String(params.clipId ?? '');
            const time = Number(params.time);
            const target = editor.clips.find((c) => c.id === clipId);
            if (!target) {
              await postResult(id, false, undefined, `Clip not found: ${clipId}`);
              return;
            }
            if (!Number.isFinite(time) || time <= target.startTime + 0.2 || time >= target.startTime + target.duration - 0.2) {
              await postResult(
                id,
                false,
                undefined,
                `Split time ${time}s must be at least 0.2s inside clip [${target.startTime}, ${target.startTime + target.duration}]`
              );
              return;
            }
            editor.applyEdit((prev) => splitClipAtTime(prev, clipId, time));
            await postResult(id, true, { clipId, splitAt: time });
            return;
          }

          case 'ripple_delete_left': {
            const clipId = String(params.clipId ?? '');
            const time = Number(params.time);
            const res = rippleDeleteLeftAtTime(editor.clips, clipId, time);
            if (!res) {
              await postResult(id, false, undefined, 'Cannot ripple delete left at the given clip/time');
              return;
            }
            editor.applyEdit(() => res.clips);
            editor.setPlayhead(res.nextPlayhead);
            await postResult(id, true, { clipId, time, nextPlayhead: res.nextPlayhead });
            return;
          }

          case 'ripple_delete_right': {
            const clipId = String(params.clipId ?? '');
            const time = Number(params.time);
            const nextClips = rippleDeleteRightAtTime(editor.clips, clipId, time);
            if (!nextClips) {
              await postResult(id, false, undefined, 'Cannot ripple delete right at the given clip/time');
              return;
            }
            editor.applyEdit(() => nextClips);
            await postResult(id, true, { clipId, time });
            return;
          }

          case 'select_clips': {
            const clipIds = Array.isArray(params.clipIds) ? params.clipIds.map(String) : [];
            editor.setSelectedClipIds(clipIds);
            await postResult(id, true, { selectedClipIds: clipIds });
            return;
          }

          case 'set_playhead': {
            const time = Math.max(0, Number(params.time ?? 0));
            editor.setIsPlaying(false);
            editor.setPlayhead(time);
            await postResult(id, true, { playhead: time });
            return;
          }

          case 'set_playback': {
            const playing = Boolean(params.playing);
            editor.setIsPlaying(playing);
            await postResult(id, true, { isPlaying: playing });
            return;
          }

          case 'set_zoom': {
            const zoom = Math.max(10, Math.min(300, Number(params.zoom ?? 50)));
            editor.setZoom(zoom);
            await postResult(id, true, { zoom });
            return;
          }

          case 'add_track': {
            const type = String(params.type ?? 'video') as TrackType;
            editor.addTrack(type);
            await postResult(id, true, { addedTrackType: type });
            return;
          }

          case 'remove_track': {
            const type = String(params.type ?? '') as TrackType;
            const index = Number(params.index ?? 0);
            editor.removeTrack(type, index);
            await postResult(id, true, { removed: { type, index } });
            return;
          }

          case 'apply_style_to_all_text': {
            const sourceClipId = String(params.sourceClipId ?? '');
            editor.applyStyleToAllTextClips(sourceClipId);
            await postResult(id, true, { sourceClipId });
            return;
          }

          case 'undo': {
            if (!editor.canUndo) {
              await postResult(id, false, undefined, 'Nothing to undo');
              return;
            }
            editor.undo();
            await postResult(id, true, { undone: true });
            return;
          }

          case 'redo': {
            if (!editor.canRedo) {
              await postResult(id, false, undefined, 'Nothing to redo');
              return;
            }
            editor.redo();
            await postResult(id, true, { redone: true });
            return;
          }

          case 'open_export_modal': {
            const open = params.open !== false;
            opts.onSetExportOpen(open);
            await postResult(id, true, { exportOpen: open });
            return;
          }

          default:
            await postResult(id, false, undefined, `Unknown action: ${action}`);
        }
      } catch (err) {
        await postResult(
          id,
          false,
          undefined,
          err instanceof Error ? err.message : String(err)
        );
      }
    };

    const connect = () => {
      if (closed) return;
      source = new EventSource(`${BRIDGE_URL}/events`);
      source.addEventListener('hello', () => {
        const snapshot = serializeState(latestRef.current);
        void fetch(`${BRIDGE_URL}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        }).catch(() => {});
      });
      source.addEventListener('command', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            id: string;
            action: string;
            params?: Record<string, unknown>;
          };
          void handleCommand(payload.id, payload.action, payload.params ?? {});
        } catch {
          // ignore malformed command
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed && reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 2000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, []);
}
