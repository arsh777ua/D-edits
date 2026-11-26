import { ChevronLeft, ChevronRight, Film, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AudioClip,
  MediaAsset,
  ProjectSettings,
  TextClip,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import { evaluateCaptionAnimation } from '../utils/captions';
import { formatAspectRatio } from '../utils/projectConfig';
import { clamp, formatTimecode } from '../utils/time';
import { computeAudioClipGain, findActiveClipsAtTime } from '../utils/timeline';

interface PreviewPlayerProps {
  clips: TimelineClip[];
  mediaAssets: MediaAsset[];
  projectSettings: ProjectSettings;
  playhead: number;
  projectDuration: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onTogglePlay: () => void;
  onStepFrame: (dir: -1 | 1) => void;
  onUpdateClip: (
    id: string,
    patch: Partial<TimelineClip>,
    recordHistory?: boolean
  ) => void;
  onPushHistory: (snapshot: TimelineClip[]) => void;
}

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function VideoLayer({
  clip,
  asset,
  playhead,
  isPlaying,
  isSelected,
  onPointerDown,
}: {
  clip: VideoClip;
  asset: MediaAsset;
  playhead: number;
  isPlaying: boolean;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || clip.mediaType !== 'video') return;
    const ctx = getAudioContext();
    if (!ctx || gainRef.current) return;

    try {
      const source = ctx.createMediaElementSource(video);
      const gainNode = ctx.createGain();
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      gainRef.current = gainNode;
    } catch {
      // Fallback if element already has a source node
    }
  }, [asset.id, clip.mediaType]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || clip.mediaType !== 'video') return;

    const expectedTime =
      clip.sourceStart + (playhead - clip.startTime) * clip.speed;
    video.playbackRate = clip.speed;

    if (gainRef.current) {
      gainRef.current.gain.value = clamp(clip.volume, 0, 10);
      video.volume = 1;
      video.muted = clip.volume <= 0;
    } else {
      video.volume = clamp(clip.volume, 0, 1);
      video.muted = clip.volume <= 0;
    }

    const syncCurrentTime = () => {
      if (video.readyState < 1) return;
      const drift = Math.abs(video.currentTime - expectedTime);
      if (!isPlaying || drift > 0.25) {
        if (Number.isFinite(expectedTime) && expectedTime >= 0) {
          video.currentTime = expectedTime;
        }
      }
    };

    syncCurrentTime();

    const onLoadedData = () => {
      syncCurrentTime();
      if (isPlaying && video.paused) {
        getAudioContext();
        video.play().catch(() => {});
      }
    };
    video.addEventListener('loadeddata', onLoadedData);

    if (isPlaying) {
      getAudioContext();
      if (video.paused && video.readyState >= 2) {
        video.play().catch(() => {});
      }
    } else if (!video.paused) {
      video.pause();
    }

    return () => {
      video.removeEventListener('loadeddata', onLoadedData);
    };
  }, [clip, playhead, isPlaying]);

  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute inset-0 w-full h-full flex items-center justify-center cursor-move ${
        isSelected ? 'ring-1 ring-inset ring-[#00d4c6]/60' : ''
      }`}
      style={{
        transform: `translate(${clip.x}%, ${clip.y}%) scale(${clip.scale}) rotate(${clip.rotate}deg)`,
        clipPath:
          clip.cropTop > 0 ||
          clip.cropRight > 0 ||
          clip.cropBottom > 0 ||
          clip.cropLeft > 0
            ? `inset(${clip.cropTop}% ${clip.cropRight}% ${clip.cropBottom}% ${clip.cropLeft}%)`
            : undefined,
        filter:
          clip.brightness !== 1 || clip.contrast !== 1
            ? `brightness(${clip.brightness}) contrast(${clip.contrast})`
            : undefined,
      }}
    >
      {clip.mediaType === 'video' ? (
        <video
          key={asset.id}
          ref={videoRef}
          src={asset.url}
          preload="auto"
          playsInline
          className="w-full h-full object-contain pointer-events-none"
        />
      ) : (
        <img
          src={asset.url}
          alt={clip.name}
          className="w-full h-full object-contain pointer-events-none"
        />
      )}
    </div>
  );
}

function AudioLayer({
  clip,
  asset,
  playhead,
  isPlaying,
}: {
  clip: AudioClip;
  asset: MediaAsset;
  playhead: number;
  isPlaying: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = getAudioContext();
    if (!ctx || gainRef.current) return;

    try {
      const source = ctx.createMediaElementSource(audio);
      const gainNode = ctx.createGain();
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      gainRef.current = gainNode;
    } catch {
      // Fallback
    }
  }, [asset.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const expectedTime = clip.sourceStart + (playhead - clip.startTime);
    const gain = computeAudioClipGain(clip, playhead);

    if (gainRef.current) {
      gainRef.current.gain.value = clamp(gain, 0, 10);
      audio.volume = 1;
      audio.muted = gain <= 0;
    } else {
      audio.volume = clamp(gain, 0, 1);
      audio.muted = gain <= 0;
    }

    const drift = Math.abs(audio.currentTime - expectedTime);
    if (!isPlaying || drift > 0.25) {
      if (Number.isFinite(expectedTime) && expectedTime >= 0) {
        audio.currentTime = expectedTime;
      }
    }

    if (isPlaying) {
      getAudioContext();
      if (audio.paused) audio.play().catch(() => {});
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [clip, playhead, isPlaying]);

  return <audio key={asset.id} ref={audioRef} src={asset.url} className="hidden" />;
}

export function PreviewPlayer({
  clips,
  mediaAssets,
  projectSettings,
  playhead,
  projectDuration,
  isPlaying,
  selectedClipId,
  onSelectClip,
  onTogglePlay,
  onStepFrame,
  onUpdateClip,
  onPushHistory,
}: PreviewPlayerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 640, height: 360 });

  const assetMap = useMemo(() => {
    const map = new Map<string, MediaAsset>();
    for (const a of mediaAssets) map.set(a.id, a);
    return map;
  }, [mediaAssets]);

  const activeVideoClips = useMemo(
    () => findActiveClipsAtTime<VideoClip>(clips, 'video', playhead),
    [clips, playhead]
  );
  const activeAudioClips = useMemo(
    () => findActiveClipsAtTime<AudioClip>(clips, 'audio', playhead),
    [clips, playhead]
  );
  const activeTextClips = useMemo(
    () => [
      ...findActiveClipsAtTime<TextClip>(clips, 'text', playhead),
      ...findActiveClipsAtTime<TextClip>(clips, 'captions', playhead),
    ],
    [clips, playhead]
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewportSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleTextPointerDown = (e: React.PointerEvent, clip: TextClip) => {
    e.stopPropagation();
    onSelectClip(clip.id);
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = clip.x;
    const origY = clip.y;
    const snapshot = clips;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startClientX) / rect.width) * 100;
      const dy = ((ev.clientY - startClientY) / rect.height) * 100;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) moved = true;
      onUpdateClip(
        clip.id,
        {
          x: Math.round(clamp(origX + dx, -48, 48) * 10) / 10,
          y: Math.round(clamp(origY + dy, -48, 48) * 10) / 10,
        },
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

  const handleMediaPointerDown = (e: React.PointerEvent, clip: VideoClip) => {
    e.stopPropagation();
    onSelectClip(clip.id);
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = clip.x;
    const origY = clip.y;
    const snapshot = clips;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startClientX) / rect.width) * 100;
      const dy = ((ev.clientY - startClientY) / rect.height) * 100;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) moved = true;
      onUpdateClip(
        clip.id,
        {
          x: Math.round(clamp(origX + dx, -100, 100) * 10) / 10,
          y: Math.round(clamp(origY + dy, -100, 100) * 10) / 10,
        },
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

  const targetRatio =
    projectSettings.width / Math.max(1, projectSettings.height);
  const availW = Math.max(120, viewportSize.width - 24);
  const availH = Math.max(120, viewportSize.height - 24);
  let stageW = availW;
  let stageH = stageW / targetRatio;
  if (stageH > availH) {
    stageH = availH;
    stageW = stageH * targetRatio;
  }

  const fontScale = stageH / 720;
  const aspectLabel =
    projectSettings.aspectRatioPreset === 'custom'
      ? formatAspectRatio(projectSettings.width, projectSettings.height)
      : projectSettings.aspectRatioPreset;

  const stageBgStyle: React.CSSProperties =
    projectSettings.previewBackground === 'checkerboard'
      ? {
          backgroundColor: '#1b1d24',
          backgroundImage:
            'linear-gradient(45deg, #262932 25%, transparent 25%), linear-gradient(-45deg, #262932 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262932 75%), linear-gradient(-45deg, transparent 75%, #262932 75%)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        }
      : {
          backgroundColor:
            projectSettings.previewBackground === 'custom'
              ? projectSettings.previewBackgroundColor
              : '#000000',
        };

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#0e0f12] select-none">
      {/* Preview Viewport */}
      <div
        ref={viewportRef}
        className="flex-1 min-h-0 p-3 flex items-center justify-center overflow-hidden"
        onClick={() => onSelectClip(null)}
      >
        <div
          ref={stageRef}
          className="relative rounded-lg overflow-hidden border border-[#262932] shadow-2xl flex items-center justify-center shrink-0"
          style={{
            width: Math.floor(stageW),
            height: Math.floor(stageH),
            ...stageBgStyle,
          }}
        >
          {activeVideoClips.length > 0 ? (
            activeVideoClips.map((vClip) => {
              const asset = assetMap.get(vClip.mediaId);
              if (!asset) return null;
              return (
                <VideoLayer
                  key={vClip.id}
                  clip={vClip}
                  asset={asset}
                  playhead={playhead}
                  isPlaying={isPlaying}
                  isSelected={selectedClipId === vClip.id}
                  onPointerDown={(e) => handleMediaPointerDown(e, vClip)}
                />
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-[#525866] px-4 text-center">
              <Film className="w-10 h-10 stroke-[1.5]" />
              <p className="text-xs">
                {clips.length === 0
                  ? 'Import media and drag it to the timeline to preview'
                  : 'No video clip at playhead'}
              </p>
            </div>
          )}

          {/* Audio Layers */}
          {activeAudioClips.map((aClip) => {
            const asset = assetMap.get(aClip.mediaId);
            if (!asset) return null;
            return (
              <AudioLayer
                key={aClip.id}
                clip={aClip}
                asset={asset}
                playhead={playhead}
                isPlaying={isPlaying}
              />
            );
          })}

          {/* Text & Caption Overlay Layers */}
          {activeTextClips.map((tClip) => {
            const anim = evaluateCaptionAnimation(tClip, playhead);
            const scaledFont = Math.max(10, tClip.fontSize * fontScale);
            const outlineW = (tClip.outlineWidth ?? 0) * fontScale;
            const outlineCol = tClip.outlineColor ?? '#000000';
            const shadowBlur = (tClip.shadowBlur ?? 6) * fontScale;
            const shadowCol = tClip.shadowColor ?? 'rgba(0,0,0,0.85)';
            const bgAlpha = tClip.bgOpacity ?? (anim.hasBackground ? 0.78 : 0);
            const bgHex = tClip.bgColor ?? '#000000';
            const highlightCol = tClip.highlightColor ?? '#fde047';

            const hexToRgba = (hex: string, alpha: number) => {
              const clean = hex.replace('#', '');
              const r = parseInt(clean.slice(0, 2) || '00', 16);
              const g = parseInt(clean.slice(2, 4) || '00', 16);
              const b = parseInt(clean.slice(4, 6) || '00', 16);
              return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            };

            const tokens = (tClip.text || 'Text').split(/\s+/).filter(Boolean);

            return (
              <div
                key={tClip.id}
                onPointerDown={(e) => handleTextPointerDown(e, tClip)}
                style={{
                  left: `calc(50% + ${tClip.x}%)`,
                  top: `calc(50% + ${tClip.y}%)`,
                  transform: `translate(-50%, calc(-50% + ${anim.translateY * fontScale}px)) scale(${anim.scale})`,
                  opacity: anim.opacity,
                  fontSize: `${scaledFont}px`,
                  color: tClip.color,
                  fontFamily: tClip.fontFamily,
                  fontWeight: tClip.bold === false ? 400 : 700,
                  backgroundColor:
                    bgAlpha > 0 ? hexToRgba(bgHex, bgAlpha) : undefined,
                  padding:
                    bgAlpha > 0
                      ? `${Math.max(3, 6 * fontScale)}px ${Math.max(8, 14 * fontScale)}px`
                      : undefined,
                  borderRadius: bgAlpha > 0 ? `${Math.max(6, 10 * fontScale)}px` : undefined,
                  WebkitTextStroke:
                    outlineW > 0 ? `${outlineW * 2}px ${outlineCol}` : undefined,
                  paintOrder: outlineW > 0 ? 'stroke fill' : undefined,
                  textShadow: anim.isNeon
                    ? `0 0 ${10 * fontScale}px ${tClip.color}, 0 0 ${22 * fontScale}px ${tClip.color}`
                    : shadowBlur > 0
                      ? `0 ${Math.max(1, 2 * fontScale)}px ${shadowBlur}px ${shadowCol}`
                      : 'none',
                }}
                className={`absolute whitespace-pre-wrap text-center leading-tight cursor-move rounded ${
                  selectedClipId === tClip.id
                    ? 'ring-1 ring-[#00d4c6]'
                    : 'hover:ring-1 hover:ring-white/40'
                }`}
              >
                {anim.isHighlightTemplate ? (
                  <span className="inline-flex flex-wrap items-center justify-center gap-x-[0.28em]">
                    {tokens.map((tok, idx) => {
                      const isActive = idx === anim.activeWordIndex;
                      const isFuture =
                        anim.isSequentialReveal && idx > anim.activeWordIndex;
                      return (
                        <span
                          key={`${tok}-${idx}`}
                          style={{
                            color: isActive ? highlightCol : tClip.color,
                            opacity: isFuture ? 0.18 : 1,
                            transform: isActive ? 'scale(1.08)' : 'scale(1)',
                            display: 'inline-block',
                          }}
                        >
                          {tok}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  tClip.text || 'Text'
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Transport Controls Bar */}
      <div className="h-10 shrink-0 px-4 border-t border-[#1e212a] bg-[#121419] flex items-center justify-between text-xs">
        <div className="font-mono text-[11px] tabular-nums flex items-center gap-1.5">
          <span className="text-[#00d4c6] font-medium">
            {formatTimecode(playhead, projectSettings.fps)}
          </span>
          <span className="text-[#525866]">/</span>
          <span className="text-[#8c92a0]">
            {formatTimecode(projectDuration, projectSettings.fps)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onStepFrame(-1)}
            title="Previous frame"
            className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className="w-8 h-8 rounded-full bg-[#e8eaed] hover:bg-white text-[#0e0f12] flex items-center justify-center transition-colors cursor-pointer"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onStepFrame(1)}
            title="Next frame"
            className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="text-[11px] text-[#6d7382] font-mono">
          {projectSettings.width}×{projectSettings.height} · {aspectLabel} ·{' '}
          {projectSettings.fps}fps
        </div>
      </div>
    </section>
  );
}
