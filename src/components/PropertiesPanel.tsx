import { RotateCcw, Sliders, Sparkles, VolumeX } from 'lucide-react';
import { useRef } from 'react';
import type {
  AudioClip,
  CaptionTemplateId,
  GraphicClip,
  MediaAsset,
  PlaybackSpeed,
  TextClip,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import { CAPTION_TEMPLATES } from '../utils/captions';
import { useSystemFonts } from '../utils/systemFonts';
import { dbToGain, formatDb, gainToDb } from '../utils/time';
import { GraphicProperties } from './GraphicProperties';

interface PropertiesPanelProps {
  selectedClip: TimelineClip | null;
  clips: TimelineClip[];
  mediaAssets?: MediaAsset[];
  onUpdateClip: (
    id: string,
    patch: Partial<TimelineClip>,
    recordHistory?: boolean
  ) => void;
  onApplyTextStyleToAll?: (sourceClipId: string) => void;
  onSaveGraphicPreset?: (clip: GraphicClip, name: string) => void;
  onRemoveSilence?: (clip: VideoClip | AudioClip) => void;
  onPushHistory: (snapshot: TimelineClip[]) => void;
}

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 1.5, 2];

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue: string;
  onChange: (val: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  displayValue,
  onChange,
  onDragStart,
  onDragEnd,
}: SliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#9aa0ad]">{label}</span>
        <span className="font-mono text-[#e8eaed] tabular-nums">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onDragStart}
        onPointerUp={onDragEnd}
        onChange={(e) => onChange(Number(e.target.value))}
        className="editor-slider w-full"
      />
    </div>
  );
}

export function PropertiesPanel({
  selectedClip,
  clips,
  mediaAssets = [],
  onUpdateClip,
  onApplyTextStyleToAll,
  onSaveGraphicPreset,
  onRemoveSilence,
  onPushHistory,
}: PropertiesPanelProps) {
  const dragSnapshotRef = useRef<TimelineClip[] | null>(null);

  const handleDragStart = () => {
    dragSnapshotRef.current = clips;
  };

  const handleDragEnd = () => {
    if (dragSnapshotRef.current) {
      onPushHistory(dragSnapshotRef.current);
      dragSnapshotRef.current = null;
    }
  };

  if (!selectedClip) {
    return (
      <aside className="w-64 lg:w-72 shrink-0 bg-[#16181d] border-l border-[#262932] p-4 flex flex-col items-center justify-center text-center gap-2">
        <div className="w-10 h-10 rounded-full bg-[#1e2028] flex items-center justify-center text-[#555b69]">
          <Sliders className="w-5 h-5" />
        </div>
        <p className="text-xs font-medium text-[#b0b5c0]">No Clip Selected</p>
        <p className="text-[11px] text-[#6d7382] max-w-[180px]">
          Click a clip on the timeline to adjust its properties.
        </p>
      </aside>
    );
  }

  return (
    <aside className="w-64 lg:w-72 shrink-0 bg-[#16181d] border-l border-[#262932] flex flex-col h-full overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[#262932] flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
            {selectedClip.trackType === 'video'
              ? 'Clip Properties'
              : selectedClip.trackType === 'graphics'
                ? 'Graphic Properties'
                : selectedClip.trackType === 'captions'
                  ? 'Caption Properties'
                  : selectedClip.trackType === 'text'
                    ? 'Text Properties'
                    : 'Audio Properties'}
          </h2>
          <p className="text-[11px] text-[#6d7382] truncate">
            {selectedClip.name}
          </p>
        </div>

        {selectedClip.trackType === 'video' && (
          <button
            type="button"
            title="Reset all adjustments"
            onClick={() =>
              onUpdateClip(selectedClip.id, {
                scale: 1,
                x: 0,
                y: 0,
                cropTop: 0,
                cropRight: 0,
                cropBottom: 0,
                cropLeft: 0,
                rotate: 0,
                volume: 1,
                speed: 1,
                brightness: 1,
                contrast: 1,
              })
            }
            className="p-1.5 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3.5 space-y-5">
        {selectedClip.trackType === 'video' && (
          <VideoProperties
            clip={selectedClip}
            onUpdate={(patch, rec) => onUpdateClip(selectedClip.id, patch, rec)}
            onRemoveSilence={onRemoveSilence}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        )}

        {(selectedClip.trackType === 'text' ||
          selectedClip.trackType === 'captions') && (
          <TextProperties
            clip={selectedClip}
            textClipCount={
              clips.filter((c) => c.trackType === selectedClip.trackType).length
            }
            onUpdate={(patch, rec) => onUpdateClip(selectedClip.id, patch, rec)}
            onApplyToAll={
              onApplyTextStyleToAll
                ? () => onApplyTextStyleToAll(selectedClip.id)
                : undefined
            }
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        )}

        {selectedClip.trackType === 'graphics' && (
          <GraphicProperties
            key={selectedClip.id}
            clip={selectedClip}
            mediaAssets={mediaAssets}
            onUpdate={(patch, rec) => onUpdateClip(selectedClip.id, patch, rec)}
            onSavePreset={(c, name) => onSaveGraphicPreset?.(c, name)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        )}

        {selectedClip.trackType === 'audio' && (
          <AudioProperties
            clip={selectedClip}
            onUpdate={(patch, rec) => onUpdateClip(selectedClip.id, patch, rec)}
            onRemoveSilence={onRemoveSilence}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        )}
      </div>
    </aside>
  );
}

function VideoProperties({
  clip,
  onUpdate,
  onRemoveSilence,
  onDragStart,
  onDragEnd,
}: {
  clip: VideoClip;
  onUpdate: (patch: Partial<VideoClip>, recordHistory?: boolean) => void;
  onRemoveSilence?: (clip: VideoClip | AudioClip) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <>
      {/* Transform */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold text-white">Transform</h3>
        <SliderRow
          label="Scale"
          value={clip.scale}
          min={0.1}
          max={3}
          step={0.05}
          displayValue={`${Math.round(clip.scale * 100)}%`}
          onChange={(v) => onUpdate({ scale: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <SliderRow
          label="Position X"
          value={clip.x}
          min={-100}
          max={100}
          step={1}
          displayValue={`${clip.x}%`}
          onChange={(v) => onUpdate({ x: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <SliderRow
          label="Position Y"
          value={clip.y}
          min={-100}
          max={100}
          step={1}
          displayValue={`${clip.y}%`}
          onChange={(v) => onUpdate({ y: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <SliderRow
          label="Rotate"
          value={clip.rotate}
          min={-180}
          max={180}
          step={1}
          displayValue={`${clip.rotate}°`}
          onChange={(v) => onUpdate({ rotate: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      <div className="h-px bg-[#262932]" />

      {/* Crop */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold text-white">Crop</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <SliderRow
            label="Top"
            value={clip.cropTop}
            min={0}
            max={45}
            displayValue={`${clip.cropTop}%`}
            onChange={(v) => onUpdate({ cropTop: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <SliderRow
            label="Bottom"
            value={clip.cropBottom}
            min={0}
            max={45}
            displayValue={`${clip.cropBottom}%`}
            onChange={(v) => onUpdate({ cropBottom: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <SliderRow
            label="Left"
            value={clip.cropLeft}
            min={0}
            max={45}
            displayValue={`${clip.cropLeft}%`}
            onChange={(v) => onUpdate({ cropLeft: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <SliderRow
            label="Right"
            value={clip.cropRight}
            min={0}
            max={45}
            displayValue={`${clip.cropRight}%`}
            onChange={(v) => onUpdate({ cropRight: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
      </div>

      {clip.mediaType === 'video' && (
        <>
          <div className="h-px bg-[#262932]" />
          {/* Audio & Speed */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold text-white">
              Volume & Speed
            </h3>
            <SliderRow
              label="Volume"
              value={gainToDb(clip.volume)}
              min={-100}
              max={20}
              step={0.5}
              displayValue={formatDb(gainToDb(clip.volume))}
              onChange={(db) => onUpdate({ volume: dbToGain(db) }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#9aa0ad] block">Speed</span>
              <div className="grid grid-cols-4 gap-1.5">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onUpdate({ speed: s }, true)}
                    className={`py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                      clip.speed === s
                        ? 'bg-[#00d4c6] text-[#091214] font-semibold'
                        : 'bg-[#22252e] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
            {onRemoveSilence && (
              <button
                type="button"
                onClick={() => onRemoveSilence(clip)}
                className="w-full py-2 px-3 rounded-lg bg-[#00d4c6]/15 hover:bg-[#00d4c6]/25 border border-[#00d4c6]/45 text-[#00d4c6] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Remove Silent Parts</span>
              </button>
            )}
          </div>
        </>
      )}

      <div className="h-px bg-[#262932]" />

      {/* Basic Adjustments */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold text-white">Adjustments</h3>
        <SliderRow
          label="Brightness"
          value={clip.brightness}
          min={0.2}
          max={2}
          step={0.05}
          displayValue={`${Math.round(clip.brightness * 100)}%`}
          onChange={(v) => onUpdate({ brightness: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <SliderRow
          label="Contrast"
          value={clip.contrast}
          min={0.2}
          max={2}
          step={0.05}
          displayValue={`${Math.round(clip.contrast * 100)}%`}
          onChange={(v) => onUpdate({ contrast: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>
    </>
  );
}

function TextProperties({
  clip,
  textClipCount,
  onUpdate,
  onApplyToAll,
  onDragStart,
  onDragEnd,
}: {
  clip: TextClip;
  textClipCount: number;
  onUpdate: (patch: Partial<TextClip>, recordHistory?: boolean) => void;
  onApplyToAll?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const systemFonts = useSystemFonts();
  const normalizedFont = clip.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  const fontOptions = systemFonts.includes(normalizedFont)
    ? systemFonts
    : [normalizedFont, ...systemFonts].filter(Boolean);
  return (
    <>
      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-white block">
          Text Content
        </label>
        <textarea
          rows={3}
          value={clip.text}
          onChange={(e) => onUpdate({ text: e.target.value }, true)}
          className="w-full bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg p-2 text-xs text-white outline-none resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-[#9aa0ad] block">Font Family</label>
        <div className="flex items-center gap-2">
          <select
            value={normalizedFont}
            onChange={(e) => onUpdate({ fontFamily: e.target.value }, true)}
            className="flex-1 bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
          >
            {fontOptions.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onUpdate({ bold: clip.bold === false }, true)}
            title="Toggle Bold"
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
              clip.bold !== false
                ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6]'
                : 'bg-[#1e2028] border-[#2a2d36] text-[#8c92a0]'
            }`}
          >
            B
          </button>
        </div>
      </div>

      <SliderRow
        label="Font Size"
        value={clip.fontSize}
        min={16}
        max={120}
        step={1}
        displayValue={`${clip.fontSize}px`}
        onChange={(v) => onUpdate({ fontSize: v }, false)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#9aa0ad]">Text Color</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-[11px] font-mono text-[#d0d4dc]">
            {clip.color}
          </span>
          <input
            type="color"
            value={clip.color}
            onChange={(e) => onUpdate({ color: e.target.value }, true)}
            className="w-7 h-7 rounded border border-[#2a2d36] bg-transparent cursor-pointer"
          />
        </label>
      </div>

      <div className="h-px bg-[#262932]" />

      {/* Animation Template & Highlight / Background */}
      <div className="space-y-2.5">
        <label className="text-[11px] font-semibold text-white block">
          Caption Template
        </label>
        <select
          value={clip.captionTemplate ?? 'none'}
          onChange={(e) => {
            const tplId = e.target.value as CaptionTemplateId;
            const meta = CAPTION_TEMPLATES.find((t) => t.id === tplId);
            onUpdate(
              {
                captionTemplate: tplId,
                ...(meta
                  ? {
                      bgColor: meta.defaultBgColor,
                      bgOpacity: meta.defaultBgOpacity,
                      highlightColor: meta.defaultHighlightColor,
                    }
                  : {}),
              },
              true
            );
          }}
          className="w-full bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
        >
          {CAPTION_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#9aa0ad]">Highlight Color</span>
          <input
            type="color"
            value={clip.highlightColor ?? '#fde047'}
            onChange={(e) => onUpdate({ highlightColor: e.target.value }, true)}
            className="w-6 h-6 rounded border border-[#2a2d36] bg-transparent cursor-pointer"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#9aa0ad]">Background Pill</span>
          <input
            type="color"
            value={clip.bgColor ?? '#000000'}
            onChange={(e) => onUpdate({ bgColor: e.target.value }, true)}
            className="w-6 h-6 rounded border border-[#2a2d36] bg-transparent cursor-pointer"
          />
        </div>

        <SliderRow
          label="Bg Opacity"
          value={clip.bgOpacity ?? 0}
          min={0}
          max={1}
          step={0.05}
          displayValue={`${Math.round((clip.bgOpacity ?? 0) * 100)}%`}
          onChange={(v) => onUpdate({ bgOpacity: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      <div className="h-px bg-[#262932]" />

      {/* Outline */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-white">Outline</h3>
          <input
            type="color"
            value={clip.outlineColor ?? '#000000'}
            onChange={(e) => onUpdate({ outlineColor: e.target.value }, true)}
            title="Outline color"
            className="w-6 h-6 rounded border border-[#2a2d36] bg-transparent cursor-pointer"
          />
        </div>
        <SliderRow
          label="Thickness"
          value={clip.outlineWidth ?? 0}
          min={0}
          max={12}
          step={0.5}
          displayValue={`${clip.outlineWidth ?? 0}px`}
          onChange={(v) => onUpdate({ outlineWidth: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      <div className="h-px bg-[#262932]" />

      {/* Shadow */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-white">Shadow</h3>
          <input
            type="color"
            value={clip.shadowColor ?? '#000000'}
            onChange={(e) => onUpdate({ shadowColor: e.target.value }, true)}
            title="Shadow color"
            className="w-6 h-6 rounded border border-[#2a2d36] bg-transparent cursor-pointer"
          />
        </div>
        <SliderRow
          label="Blur"
          value={clip.shadowBlur ?? 6}
          min={0}
          max={24}
          step={1}
          displayValue={`${clip.shadowBlur ?? 6}px`}
          onChange={(v) => onUpdate({ shadowBlur: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      <div className="h-px bg-[#262932]" />

      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold text-white">Position</h3>
        <SliderRow
          label="Position X"
          value={clip.x}
          min={-48}
          max={48}
          step={1}
          displayValue={`${clip.x}%`}
          onChange={(v) => onUpdate({ x: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <SliderRow
          label="Position Y"
          value={clip.y}
          min={-48}
          max={48}
          step={1}
          displayValue={`${clip.y}%`}
          onChange={(v) => onUpdate({ y: v }, false)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      {textClipCount > 1 && onApplyToAll && (
        <>
          <div className="h-px bg-[#262932]" />
          <button
            type="button"
            onClick={onApplyToAll}
            className="w-full py-2 px-3 rounded-lg bg-[#00d4c6]/15 hover:bg-[#00d4c6]/25 border border-[#00d4c6]/50 text-[#00d4c6] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Apply Style to All ({textClipCount})</span>
          </button>
        </>
      )}
    </>
  );
}

function AudioProperties({
  clip,
  onUpdate,
  onRemoveSilence,
  onDragStart,
  onDragEnd,
}: {
  clip: AudioClip;
  onUpdate: (patch: Partial<AudioClip>, recordHistory?: boolean) => void;
  onRemoveSilence?: (clip: VideoClip | AudioClip) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const volumeDb = gainToDb(clip.volume);
  return (
    <div className="space-y-4">
      <SliderRow
        label="Volume"
        value={volumeDb}
        min={-100}
        max={20}
        step={0.5}
        displayValue={formatDb(volumeDb)}
        onChange={(db) => onUpdate({ volume: dbToGain(db) }, false)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      <SliderRow
        label="Fade In"
        value={clip.fadeIn}
        min={0}
        max={Math.min(5, clip.duration / 2)}
        step={0.1}
        displayValue={`${clip.fadeIn.toFixed(1)}s`}
        onChange={(v) => onUpdate({ fadeIn: v }, false)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      <SliderRow
        label="Fade Out"
        value={clip.fadeOut}
        min={0}
        max={Math.min(5, clip.duration / 2)}
        step={0.1}
        displayValue={`${clip.fadeOut.toFixed(1)}s`}
        onChange={(v) => onUpdate({ fadeOut: v }, false)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      {onRemoveSilence && (
        <button
          type="button"
          onClick={() => onRemoveSilence(clip)}
          className="w-full py-2 px-3 rounded-lg bg-[#00d4c6]/15 hover:bg-[#00d4c6]/25 border border-[#00d4c6]/45 text-[#00d4c6] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <VolumeX className="w-3.5 h-3.5" />
          <span>Remove Silent Parts</span>
        </button>
      )}
    </div>
  );
}
