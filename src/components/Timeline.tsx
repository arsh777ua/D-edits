import {
  Captions,
  Film,
  Maximize2,
  Music,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  GraphicPreset,
  MediaAsset,
  TextClip,
  TimelineClip,
  TimelineTrack,
  TrackType,
} from '../types/editor';
import { clamp, formatDuration } from '../utils/time';
import { MIN_CLIP_DURATION, snapTime } from '../utils/timeline';

interface TimelineProps {
  height: number;
  onResizeHeight: (h: number) => void;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  onAddTrack: (type: TrackType) => void;
  onRemoveTrack: (type: TrackType, index: number) => void;
  mediaAssets: MediaAsset[];
  selectedClipId: string | null;
  selectedClipIds: string[];
  onSelectClip: (id: string | null, additive?: boolean) => void;
  onSelectClips: (ids: string[]) => void;
  playhead: number;
  projectDuration: number;
  onSeek: (time: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onSplit: () => void;
  onDelete: () => void;
  canRemoveSilence?: boolean;
  onRemoveSilence?: () => void;
  onUpdateClip: (
    id: string,
    patch: Partial<TimelineClip>,
    recordHistory?: boolean
  ) => void;
  onPushHistory: (snapshot: TimelineClip[]) => void;
  onDropMedia: (asset: MediaAsset, startTime: number, trackIndex?: number) => void;
  onDropText?: (
    preset: Partial<TextClip>,
    startTime: number,
    trackIndex?: number
  ) => void;
  onDropGraphic?: (
    preset: GraphicPreset,
    startTime: number,
    trackIndex?: number
  ) => void;
}

const TRACK_STYLE: Record<
  TrackType,
  { heightClass: string; icon: typeof Film }
> = {
  captions: { heightClass: 'h-9', icon: Captions },
  text: { heightClass: 'h-9', icon: Type },
  graphics: { heightClass: 'h-10', icon: Sparkles },
  video: { heightClass: 'h-12', icon: Film },
  audio: { heightClass: 'h-10', icon: Music },
};

export function Timeline({
  height,
  onResizeHeight,
  clips,
  tracks,
  onAddTrack,
  onRemoveTrack,
  mediaAssets,
  selectedClipId,
  selectedClipIds,
  onSelectClip,
  onSelectClips,
  playhead,
  projectDuration,
  onSeek,
  zoom,
  onZoomChange,
  onSplit,
  onDelete,
  canRemoveSilence,
  onRemoveSilence,
  onUpdateClip,
  onPushHistory,
  onDropMedia,
  onDropText,
  onDropGraphic,
}: TimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lanesContainerRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const assetMap = useMemo(() => {
    const map = new Map<string, MediaAsset>();
    for (const a of mediaAssets) map.set(a.id, a);
    return map;
  }, [mediaAssets]);

  const timelineTotalSec = Math.max(30, Math.ceil(projectDuration + 12));
  const timelineWidthPx = timelineTotalSec * zoom;

  const tickInterval = zoom >= 80 ? 1 : zoom >= 40 ? 2 : 5;
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= timelineTotalSec; t += tickInterval) {
      arr.push(t);
    }
    return arr;
  }, [timelineTotalSec, tickInterval]);

  const handleFitTimeline = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const availW = Math.max(200, el.clientWidth - 112 - 24);
    const targetDur = Math.max(projectDuration, 5);
    const fitZoom = clamp(availW / targetDur, 10, 160);
    onZoomChange(Math.round(fitZoom));
    el.scrollLeft = 0;
  };

  // Mouse wheel shortcuts: Alt+Scroll = horizontal move, Ctrl+Scroll = zoom, Shift+Scroll = scrub playhead
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 12 : -12;
      onZoomChange(clamp(zoom + delta, 15, 160));
      return;
    }

    if (e.altKey) {
      e.preventDefault();
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      container.scrollLeft += delta;
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      const step = e.deltaY > 0 ? 0.25 : -0.25;
      onSeek(Math.max(0, playhead + step));
    }
  };

  // Resize timeline panel vertically
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;

    const onMove = (ev: PointerEvent) => {
      const next = clamp(startH + (startY - ev.clientY), 190, 480);
      onResizeHeight(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Scrub playhead from ruler or playhead handle
  const handleRulerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateFromClientX = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft - 112;
      const t = Math.max(0, x / zoom);
      onSeek(t);
    };

    updateFromClientX(e.clientX);

    const onMove = (ev: PointerEvent) => updateFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Marquee / box multi-selection on empty timeline lanes
  const handleLanesPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const lanesEl = lanesContainerRef.current;
    if (!lanesEl) return;

    const lanesRect = lanesEl.getBoundingClientRect();
    const startX = e.clientX - lanesRect.left;
    const startY = e.clientY - lanesRect.top;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const initialSelection = additive ? [...selectedClipIds] : [];
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      const curX = ev.clientX - lanesRect.left;
      const curY = ev.clientY - lanesRect.top;
      if (Math.abs(curX - startX) > 4 || Math.abs(curY - startY) > 4) {
        dragged = true;
      }
      if (!dragged) return;

      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);
      setMarquee({ left, top, width, height });

      // Compute intersecting clips
      const selStartSec = left / zoom;
      const selEndSec = (left + width) / zoom;
      const laneEls = Array.from(
        lanesEl.querySelectorAll<HTMLElement>('[data-track-type]')
      );
      const hitTrackKeys = new Set<string>();
      for (const laneEl of laneEls) {
        const laneTop = laneEl.offsetTop;
        const laneBottom = laneTop + laneEl.offsetHeight;
        if (laneBottom >= top && laneTop <= top + height) {
          const tType = laneEl.getAttribute('data-track-type');
          const tIdx = laneEl.getAttribute('data-track-index');
          if (tType && tIdx !== null) hitTrackKeys.add(`${tType}:${tIdx}`);
        }
      }

      const hits = clips
        .filter((c) => {
          const key = `${c.trackType}:${c.trackIndex ?? 0}`;
          if (!hitTrackKeys.has(key)) return false;
          const cEnd = c.startTime + c.duration;
          return cEnd >= selStartSec && c.startTime <= selEndSec;
        })
        .map((c) => c.id);

      const merged = Array.from(new Set([...initialSelection, ...hits]));
      onSelectClips(merged);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (!dragged && !additive) {
        onSelectClip(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Move clip horizontally (and vertically across layers of the same trackType, or move multi-selection together)
  const handleClipMovePointerDown = (
    e: React.PointerEvent,
    clip: TimelineClip
  ) => {
    e.stopPropagation();
    const isAlreadyInMulti =
      selectedClipIds.includes(clip.id) && selectedClipIds.length > 1;
    if (!isAlreadyInMulti) {
      onSelectClip(clip.id, e.shiftKey || e.ctrlKey || e.metaKey);
    }

    const startX = e.clientX;
    const origStart = clip.startTime;
    const origTrackIndex = clip.trackIndex ?? 0;
    const snapshot = clips;
    const movingIds = isAlreadyInMulti ? new Set(selectedClipIds) : new Set([clip.id]);
    const origStarts = new Map<string, number>();
    for (const c of snapshot) {
      if (movingIds.has(c.id)) origStarts.set(c.id, c.startTime);
    }
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startX) / zoom;
      if (Math.abs(dxSec) > 0.02) moved = true;

      if (isAlreadyInMulti) {
        const minOrig = Math.min(...Array.from(origStarts.values()));
        const clampedDx = Math.max(-minOrig, dxSec);
        for (const id of movingIds) {
          const base = origStarts.get(id) ?? 0;
          onUpdateClip(id, { startTime: Math.max(0, base + clampedDx) }, false);
        }
        return;
      }

      const rawStart = Math.max(0, origStart + dxSec);
      const snapped = snapTime(rawStart, snapshot, clip.id, playhead, zoom);

      let nextTrackIndex = origTrackIndex;
      const els = document.elementsFromPoint(ev.clientX, ev.clientY);
      for (const el of els) {
        const laneType = el.getAttribute('data-track-type');
        const laneIdx = el.getAttribute('data-track-index');
        if (laneType === clip.trackType && laneIdx !== null) {
          nextTrackIndex = Number(laneIdx);
          if (nextTrackIndex !== origTrackIndex) moved = true;
          break;
        }
      }

      onUpdateClip(
        clip.id,
        { startTime: snapped, trackIndex: nextTrackIndex },
        false
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) onPushHistory(snapshot);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Trim left or right edge
  const handleTrimPointerDown = (
    e: React.PointerEvent,
    clip: TimelineClip,
    edge: 'left' | 'right'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectClip(clip.id);

    const startX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const origSourceStart = clip.sourceStart;
    const speed = clip.trackType === 'video' ? clip.speed : 1;
    const isBoundedMedia =
      clip.trackType === 'audio' ||
      (clip.trackType === 'video' && clip.mediaType === 'video');
    const snapshot = clips;
    let changed = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startX) / zoom;
      if (Math.abs(dxSec) > 0.01) changed = true;

      if (edge === 'left') {
        const minDelta = isBoundedMedia
          ? -origSourceStart / speed
          : -origStart;
        const maxDelta = origDuration - MIN_CLIP_DURATION;
        const clampedDelta = clamp(
          dxSec,
          Math.max(minDelta, -origStart),
          maxDelta
        );

        onUpdateClip(
          clip.id,
          {
            startTime: origStart + clampedDelta,
            duration: origDuration - clampedDelta,
            sourceStart: isBoundedMedia
              ? Math.max(0, origSourceStart + clampedDelta * speed)
              : origSourceStart,
          },
          false
        );
      } else {
        const maxDuration = isBoundedMedia
          ? (clip.sourceDuration - origSourceStart) / speed
          : 600;
        const nextDuration = clamp(
          origDuration + dxSec,
          MIN_CLIP_DURATION,
          Math.max(MIN_CLIP_DURATION, maxDuration)
        );
        onUpdateClip(clip.id, { duration: nextDuration }, false);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (changed) onPushHistory(snapshot);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag & drop from Media/Audio/Text sidebar onto a specific track layer
  const handleTrackDrop = (
    e: React.DragEvent,
    targetTrack: TrackType,
    targetIndex: number
  ) => {
    e.preventDefault();
    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft - 112;
    const dropTime = Math.max(0, x / zoom);

    const graphicPayload = e.dataTransfer.getData('application/x-cutlite-graphic');
    if (graphicPayload && targetTrack === 'graphics') {
      try {
        const preset = JSON.parse(graphicPayload) as GraphicPreset;
        onDropGraphic?.(preset, dropTime, targetIndex);
      } catch {
        // Ignore invalid payload
      }
      return;
    }

    const textPayload = e.dataTransfer.getData('application/x-cutlite-text');
    if (textPayload && (targetTrack === 'text' || targetTrack === 'captions')) {
      try {
        const preset = JSON.parse(textPayload) as Partial<TextClip>;
        onDropText?.(preset, dropTime, targetIndex);
      } catch {
        onDropText?.({}, dropTime, targetIndex);
      }
      return;
    }

    const assetId = e.dataTransfer.getData('application/x-cutlite-media');
    if (!assetId) return;
    const asset = assetMap.get(assetId);
    if (!asset) return;

    if (targetTrack === 'audio' && asset.type !== 'audio') return;
    if (targetTrack === 'video' && asset.type === 'audio') return;
    if (targetTrack === 'text' || targetTrack === 'captions') return;

    onDropMedia(asset, dropTime, targetIndex);
  };

  return (
    <section
      style={{ height }}
      className="shrink-0 bg-[#14161b] border-t border-[#262932] flex flex-col select-none relative"
    >
      {/* Top Resize Handle */}
      <div
        onPointerDown={handleResizePointerDown}
        title="Drag to resize timeline"
        className="h-1.5 w-full cursor-ns-resize hover:bg-[#00d4c6]/50 transition-colors shrink-0"
      />

      {/* Timeline Toolbar */}
      <div className="h-9 px-3 border-b border-[#22252e] flex items-center justify-between gap-2 shrink-0 bg-[#16181d]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSplit}
            title="Split clip at playhead (E)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[#d0d4dc] hover:text-white hover:bg-[#232630] transition-colors cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Split</span>
          </button>

          <button
            type="button"
            onClick={onDelete}
            disabled={selectedClipIds.length === 0}
            title="Delete selected clip (F / Delete)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[#d0d4dc] hover:text-red-400 hover:bg-[#232630] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>

          {onRemoveSilence && (
            <button
              type="button"
              onClick={onRemoveSilence}
              disabled={!canRemoveSilence}
              title="Remove silent parts from selected video/audio clip"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[#d0d4dc] hover:text-[#00d4c6] hover:bg-[#232630] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <VolumeX className="w-3.5 h-3.5" />
              <span>Remove Silence</span>
            </button>
          )}

          <div className="h-4 w-px bg-[#262932] mx-1" />

          {/* Add Layer Controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onAddTrack('video')}
              title="Add Video Overlay Layer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1e2028] border border-[#2a2d36] text-[#d0d4dc] hover:text-white hover:border-[#00d4c6]/60 cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#00d4c6]" />
              <span>Video</span>
            </button>
            <button
              type="button"
              onClick={() => onAddTrack('graphics')}
              title="Add Graphics Layer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1e2028] border border-[#2a2d36] text-[#d0d4dc] hover:text-white hover:border-[#00d4c6]/60 cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#00d4c6]" />
              <span>Graphics</span>
            </button>
            <button
              type="button"
              onClick={() => onAddTrack('text')}
              title="Add Text Layer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1e2028] border border-[#2a2d36] text-[#d0d4dc] hover:text-white hover:border-[#00d4c6]/60 cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#00d4c6]" />
              <span>Text</span>
            </button>
            <button
              type="button"
              onClick={() => onAddTrack('captions')}
              title="Add Captions Layer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1e2028] border border-[#2a2d36] text-[#d0d4dc] hover:text-white hover:border-[#00d4c6]/60 cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#00d4c6]" />
              <span>Captions</span>
            </button>
            <button
              type="button"
              onClick={() => onAddTrack('audio')}
              title="Add Audio Layer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1e2028] border border-[#2a2d36] text-[#d0d4dc] hover:text-white hover:border-[#00d4c6]/60 cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#00d4c6]" />
              <span>Audio</span>
            </button>
          </div>
        </div>

        {/* Navigation Hint + Zoom Controls */}
        <div className="flex items-center gap-3">
          <span className="hidden lg:inline text-[10px] text-[#6d7382]">
            Alt+Scroll: Move · Ctrl+Scroll: Zoom · Shift+Scroll: Scrub
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onZoomChange(clamp(zoom - 15, 10, 160))}
              title="Zoom out (-)"
              className="p-1 rounded text-[#9aa0ad] hover:text-white hover:bg-[#232630] cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={10}
              max={160}
              value={zoom}
              onChange={(e) => onZoomChange(Number(e.target.value))}
              aria-label="Timeline zoom"
              className="editor-slider w-24"
            />
            <button
              type="button"
              onClick={() => onZoomChange(clamp(zoom + 15, 10, 160))}
              title="Zoom in (+)"
              className="p-1 rounded text-[#9aa0ad] hover:text-white hover:bg-[#232630] cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitTimeline}
              title="Fit timeline to view"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1e2028] border border-[#2a2d36] text-[#d0d4dc] hover:text-white hover:border-[#00d4c6]/60 cursor-pointer ml-1"
            >
              <Maximize2 className="w-3 h-3 text-[#00d4c6]" />
              <span>Fit</span>
            </button>
          </div>
        </div>
      </div>

      {/* Unified Scrollable Timeline Area (pinned scrollbars, sticky ruler & sticky track labels) */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectClip(null);
        }}
        className="flex-1 min-h-0 overflow-auto custom-scrollbar relative bg-[#111318]"
      >
        <div
          style={{ width: timelineWidthPx + 112 }}
          className="min-h-full flex flex-col relative"
        >
          {/* Top Row: Corner + Sticky Time Ruler */}
          <div className="h-6 flex sticky top-0 z-30 bg-[#16181d] border-b border-[#262932] shrink-0">
            <div className="w-28 shrink-0 sticky left-0 z-40 bg-[#14161b] border-r border-[#262932]" />
            <div
              onPointerDown={handleRulerPointerDown}
              style={{ width: timelineWidthPx }}
              className="relative cursor-pointer shrink-0"
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  style={{ left: t * zoom }}
                  className="absolute top-0 bottom-0 flex flex-col justify-end pointer-events-none"
                >
                  <span className="text-[10px] font-mono text-[#7e8494] pl-1 leading-none mb-1">
                    {formatDuration(t)}
                  </span>
                  <div className="w-px h-1.5 bg-[#3a3e4b]" />
                </div>
              ))}
            </div>
          </div>

          {/* Body: Sticky Track Labels + Track Lanes */}
          <div className="flex flex-1 relative">
            {/* Sticky Left Track Labels Column */}
            <div className="w-28 shrink-0 sticky left-0 z-20 bg-[#14161b] border-r border-[#262932] flex flex-col gap-1.5 px-2 py-2">
              {tracks.map((track) => {
                const { heightClass, icon: Icon } = TRACK_STYLE[track.type];
                const canRemove =
                  tracks.filter((t) => t.type === track.type).length > 1;
                return (
                  <div
                    key={track.id}
                    className={`group ${heightClass} flex items-center justify-between gap-1 text-[11px] font-medium text-[#8c92a0] px-2 rounded bg-[#181b22] border border-[#22252e] shrink-0`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className="w-3.5 h-3.5 text-[#00d4c6] shrink-0" />
                      <span className="truncate">{track.label}</span>
                    </div>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveTrack(track.type, track.index);
                        }}
                        title={`Remove ${track.label}`}
                        aria-label={`Remove ${track.label}`}
                        className="p-0.5 rounded text-[#6d7382] hover:text-red-400 hover:bg-[#232630] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Track Lanes + Playhead */}
            <div
              ref={lanesContainerRef}
              onPointerDown={handleLanesPointerDown}
              style={{ width: timelineWidthPx }}
              className="flex flex-col gap-1.5 py-2 relative shrink-0"
            >
              {tracks.map((track) => {
                const { heightClass } = TRACK_STYLE[track.type];
                const trackClips = clips.filter(
                  (c) =>
                    c.trackType === track.type &&
                    (c.trackIndex ?? 0) === track.index
                );
                return (
                  <div
                    key={track.id}
                    data-track-type={track.type}
                    data-track-index={track.index}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes('application/x-cutlite-media') ||
                        e.dataTransfer.types.includes('application/x-cutlite-text') ||
                        e.dataTransfer.types.includes('application/x-cutlite-graphic')
                      ) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => handleTrackDrop(e, track.type, track.index)}
                    className={`${heightClass} relative bg-[#171920]/80 border-y border-[#22252e]/70 shrink-0`}
                  >
                    {trackClips.map((clip) => {
                      const isSelected =
                        clip.id === selectedClipId ||
                        selectedClipIds.includes(clip.id);
                      const leftPx = clip.startTime * zoom;
                      const widthPx = Math.max(14, clip.duration * zoom);
                      const asset =
                        'mediaId' in clip ? assetMap.get(clip.mediaId) : undefined;

                      let colorClasses =
                        'bg-[#1f3b4d] border-[#2d5873] text-white';
                      if (clip.trackType === 'audio') {
                        colorClasses =
                          'bg-[#1e3a32] border-[#2a5c4d] text-[#d5f5eb]';
                      } else if (clip.trackType === 'text') {
                        colorClasses =
                          'bg-[#3b294d] border-[#5b3d7a] text-[#f3e8ff]';
                      } else if (clip.trackType === 'captions') {
                        colorClasses =
                          'bg-[#283056] border-[#45518f] text-[#e0e7ff]';
                      } else if (clip.trackType === 'graphics') {
                        colorClasses =
                          'bg-[#13383c] border-[#00d4c6]/50 text-[#ccfbf1]';
                      }

                      return (
                        <div
                          key={clip.id}
                          style={{ left: leftPx, width: widthPx }}
                          onPointerDown={(e) =>
                            handleClipMovePointerDown(e, clip)
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className={`group absolute top-0.5 bottom-0.5 rounded-md border overflow-hidden flex items-center cursor-grab active:cursor-grabbing transition-shadow ${colorClasses} ${
                            isSelected
                              ? 'ring-2 ring-[#00d4c6] border-[#00d4c6] z-10'
                              : 'hover:brightness-110'
                          }`}
                        >
                          {clip.trackType === 'video' && asset?.thumbnailUrl && (
                            <div
                              className="h-full w-11 shrink-0 bg-cover bg-center opacity-80 border-r border-black/30 pointer-events-none"
                              style={{
                                backgroundImage: `url(${asset.thumbnailUrl})`,
                              }}
                            />
                          )}

                          <div className="px-2 min-w-0 flex-1 flex items-center gap-1.5 pointer-events-none">
                            <span className="text-[11px] font-medium truncate">
                              {clip.name}
                            </span>
                            {clip.trackType === 'video' && clip.speed !== 1 && (
                              <span className="text-[9px] font-mono px-1 rounded bg-black/40 text-[#00d4c6]">
                                {clip.speed}x
                              </span>
                            )}
                          </div>

                          <div
                            onPointerDown={(e) =>
                              handleTrimPointerDown(e, clip, 'left')
                            }
                            title="Drag to trim start"
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-[#00d4c6]/80 transition-colors"
                          />

                          <div
                            onPointerDown={(e) =>
                              handleTrimPointerDown(e, clip, 'right')
                            }
                            title="Drag to trim end"
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-[#00d4c6]/80 transition-colors"
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Marquee Selection Box */}
              {marquee && (
                <div
                  style={{
                    left: marquee.left,
                    top: marquee.top,
                    width: marquee.width,
                    height: marquee.height,
                  }}
                  className="absolute border border-[#00d4c6] bg-[#00d4c6]/15 rounded-xs pointer-events-none z-30"
                />
              )}

              {/* Playhead */}
              <div
                style={{ left: playhead * zoom }}
                className="absolute top-0 bottom-0 w-px bg-[#00d4c6] z-20 pointer-events-none"
              >
                <div
                  onPointerDown={handleRulerPointerDown}
                  className="w-3 h-3 -ml-[5.5px] -mt-2 bg-[#00d4c6] rounded-b-sm pointer-events-auto cursor-ew-resize shadow"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
