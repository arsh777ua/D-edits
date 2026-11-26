import {
  Captions,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type {
  CaptionSegment,
  CaptionTemplateId,
  CaptionWord,
  MediaAsset,
  SidebarTab,
  TextClip,
} from '../types/editor';
import {
  CAPTION_TEMPLATES,
  formatCaptionChunks,
  type FormattedCaptionChunk,
} from '../utils/captions';
import { formatDuration } from '../utils/time';

interface LeftSidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  mediaAssets: MediaAsset[];
  importStatus?: string | null;
  onImportFiles: (files: FileList | File[]) => void;
  onAddMediaToTimeline: (asset: MediaAsset) => void;
  onRemoveMedia: (assetId: string) => void;
  onAddTextClip: (preset?: Partial<TextClip>) => void;
  onAddCaptionClips?: (
    segments: Array<{
      start: number;
      end: number;
      text: string;
      words?: CaptionWord[];
    }>,
    style: {
      fontSize: number;
      color: string;
      y: number;
      fontFamily?: string;
      captionTemplate?: CaptionTemplateId;
      highlightColor?: string;
      bgColor?: string;
      bgOpacity?: number;
      outlineWidth?: number;
    }
  ) => void;
  onSeekTo?: (time: number) => void;
}

const TEXT_PRESETS: Array<{
  label: string;
  preview: string;
  preset: Partial<TextClip>;
}> = [
  {
    label: 'Default Text',
    preview: 'Add text',
    preset: { text: 'Your Text Here', fontSize: 42, color: '#ffffff', y: 0 },
  },
  {
    label: 'Bold Title',
    preview: 'TITLE',
    preset: { text: 'MAIN TITLE', fontSize: 64, color: '#ffffff', y: -5 },
  },
  {
    label: 'Lower Third',
    preview: 'Subtitle',
    preset: { text: 'Speaker Name', fontSize: 32, color: '#00d4c6', y: 32 },
  },
  {
    label: 'Caption',
    preview: 'Caption line',
    preset: { text: 'Caption text goes here', fontSize: 28, color: '#fde047', y: 35 },
  },
];

export function LeftSidebar({
  activeTab,
  onTabChange,
  mediaAssets,
  importStatus,
  onImportFiles,
  onAddMediaToTimeline,
  onRemoveMedia,
  onAddTextClip,
  onAddCaptionClips,
  onSeekTo,
}: LeftSidebarProps) {
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Auto-captions state
  const [captionMode, setCaptionMode] = useState<'hinglish' | 'english'>('hinglish');
  const [captionAssetId, setCaptionAssetId] = useState<string>('');
  const [captionTemplate, setCaptionTemplate] =
    useState<CaptionTemplateId>('none');
  const [captionColor, setCaptionColor] = useState('#ffffff');
  const [captionHighlightColor, setCaptionHighlightColor] = useState('#fde047');
  const [captionBgColor, setCaptionBgColor] = useState('#000000');
  const [captionBgOpacity, setCaptionBgOpacity] = useState(0);
  const [captionOutlineWidth, setCaptionOutlineWidth] = useState(0);
  const [captionFontSize, setCaptionFontSize] = useState(38);
  const [captionY, setCaptionY] = useState(32);
  const [captionLines, setCaptionLines] = useState(1);
  const [captionMaxChars, setCaptionMaxChars] = useState(8);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [captionSegments, setCaptionSegments] = useState<FormattedCaptionChunk[]>([]);
  const [captionMeta, setCaptionMeta] = useState<string | null>(null);

  const handleSelectCaptionTemplate = (tplId: CaptionTemplateId) => {
    setCaptionTemplate(tplId);
    const meta = CAPTION_TEMPLATES.find((t) => t.id === tplId);
    if (meta) {
      setCaptionColor(meta.defaultColor);
      setCaptionHighlightColor(meta.defaultHighlightColor);
      setCaptionBgColor(meta.defaultBgColor);
      setCaptionBgOpacity(meta.defaultBgOpacity);
      setCaptionOutlineWidth(meta.defaultOutlineWidth);
    }
  };

  const visualAssets = mediaAssets.filter(
    (a) => a.type === 'video' || a.type === 'image'
  );
  const audioAssets = mediaAssets.filter((a) => a.type === 'audio');
  const transcribableAssets = mediaAssets.filter(
    (a) => a.type === 'video' || a.type === 'audio'
  );
  const selectedCaptionAsset =
    transcribableAssets.find((a) => a.id === captionAssetId) ??
    transcribableAssets[0];

  const handleGenerateCaptions = async () => {
    if (!selectedCaptionAsset) return;
    setIsTranscribing(true);
    setCaptionError(null);
    setCaptionMeta(null);

    try {
      const form = new FormData();
      form.append('file', selectedCaptionAsset.file);
      form.append('mode', captionMode);

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `Server error (${res.status})`);
      }

      const data = (await res.json()) as {
        segments: CaptionSegment[];
        device?: string;
        model?: string;
      };

      const rawSegs = data.segments ?? [];
      const formatted = formatCaptionChunks(
        rawSegs,
        captionLines,
        captionMaxChars,
        captionTemplate
      );
      setCaptionSegments(formatted);
      setCaptionMeta(
        `${formatted.length} captions · ${data.device?.toUpperCase() || 'LOCAL'}`
      );

      if (formatted.length > 0 && onAddCaptionClips) {
        onAddCaptionClips(formatted, {
          fontSize: captionFontSize,
          color: captionColor,
          y: captionY,
          captionTemplate,
          highlightColor: captionHighlightColor,
          bgColor: captionBgColor,
          bgOpacity: captionBgOpacity,
          outlineWidth: captionOutlineWidth,
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to connect to caption server';
      setCaptionError(
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? 'Caption server not running. Launch via start.bat or run: python server/caption_server.py'
          : msg
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleDownloadSrt = () => {
    if (captionSegments.length === 0) return;
    const fmt = (sec: number) => {
      const ms = Math.max(0, Math.round(sec * 1000));
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const rem = ms % 1000;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rem).padStart(3, '0')}`;
    };
    const srt = captionSegments
      .map((seg, i) => `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text}\n`)
      .join('\n');
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captions_${captionMode}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDragStart = (e: React.DragEvent, asset: MediaAsset) => {
    e.dataTransfer.setData('application/x-cutlite-media', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  return (
    <aside className="flex shrink-0 h-full bg-[#16181d] border-r border-[#262932]">
      {/* Icon Rail */}
      <nav
        aria-label="Editor tools"
        className="w-14 bg-[#121419] border-r border-[#262932] flex flex-col items-center py-2.5 gap-1.5"
      >
        {(
          [
            { id: 'media', label: 'Media', icon: Film },
            { id: 'text', label: 'Text', icon: Type },
            { id: 'captions', label: 'Captions', icon: Captions },
            { id: 'audio', label: 'Audio', icon: Music },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              title={label}
              className={`w-11 py-2 rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium transition-colors cursor-pointer ${
                active
                  ? 'bg-[#00d4c6]/15 text-[#00d4c6]'
                  : 'text-[#8c92a0] hover:text-white hover:bg-[#1e2028]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Panel Content */}
      <div className="w-64 lg:w-72 flex flex-col h-full overflow-hidden">
        {activeTab === 'media' && (
          <div
            className="flex flex-col h-full p-3 gap-3"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setIsDraggingOver(true);
              }
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDropFiles}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
                Media Library
              </h2>
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#232630] hover:bg-[#2d313d] text-xs font-medium text-white transition-colors cursor-pointer"
                title="Import video or image files"
              >
                <Upload className="w-3.5 h-3.5 text-[#00d4c6]" />
                <span>Import</span>
              </button>
              <input
                ref={mediaInputRef}
                type="file"
                multiple
                accept=".mp4,.mov,.webm,.png,.jpg,.jpeg,.webp,video/*,image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) onImportFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {importStatus && (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[#00d4c6]/10 border border-[#00d4c6]/30 text-[11px] text-[#00d4c6]">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate">{importStatus}</span>
              </div>
            )}

            {visualAssets.length === 0 ? (
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-5 text-center gap-2 transition-colors cursor-pointer ${
                  isDraggingOver
                    ? 'border-[#00d4c6] bg-[#00d4c6]/10'
                    : 'border-[#2c303a] hover:border-[#3d4250] bg-[#1a1c23]/60'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-[#232630] flex items-center justify-center text-[#00d4c6]">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-xs font-medium text-white">
                  Import Videos or Images
                </p>
                <p className="text-[11px] text-[#7e8494]">
                  Drop MP4, MOV, PNG, or JPG here, or click to browse
                </p>
              </button>
            ) : (
              <div
                className={`flex-1 overflow-y-auto custom-scrollbar pr-1 grid grid-cols-2 gap-2 content-start ${
                  isDraggingOver ? 'ring-2 ring-[#00d4c6] rounded-lg' : ''
                }`}
              >
                {visualAssets.map((asset) => (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, asset)}
                    onDoubleClick={() => onAddMediaToTimeline(asset)}
                    title={`${asset.name} — Drag to timeline or click +`}
                    className="group relative rounded-lg overflow-hidden bg-[#1e2028] border border-[#2a2d36] hover:border-[#00d4c6]/60 transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <div className="aspect-video bg-[#0e0f12] relative overflow-hidden">
                      {asset.thumbnailUrl ? (
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.name}
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#555b69]">
                          {asset.type === 'image' ? (
                            <ImageIcon className="w-6 h-6" />
                          ) : (
                            <Film className="w-6 h-6" />
                          )}
                        </div>
                      )}

                      <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/75 text-[10px] font-mono text-white">
                        {asset.type === 'image'
                          ? 'IMG'
                          : formatDuration(asset.duration)}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddMediaToTimeline(asset);
                        }}
                        title="Add to timeline"
                        className="absolute bottom-1 right-1 w-6 h-6 rounded-md bg-[#00d4c6] text-[#091214] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveMedia(asset.id);
                        }}
                        title="Remove from library"
                        className="absolute top-1 right-1 w-5 h-5 rounded bg-black/70 text-[#b0b5c0] hover:text-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="px-1.5 py-1 text-[11px] text-[#d0d4dc] truncate">
                      {asset.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'text' && (
          <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
                Text Overlays
              </h2>
            </div>

            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-cutlite-text',
                  JSON.stringify({})
                );
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onAddTextClip()}
              title="Click to add at playhead, or drag onto Text track"
              className="w-full py-2.5 px-3 rounded-lg bg-[#00d4c6] hover:bg-[#18e3d5] text-[#091214] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-grab active:cursor-grabbing"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Text at Playhead</span>
            </button>

            <div className="space-y-2 mt-1">
              <p className="text-[11px] text-[#7e8494]">
                Presets (click or drag to timeline)
              </p>
              <div className="grid grid-cols-1 gap-2">
                {TEXT_PRESETS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/x-cutlite-text',
                        JSON.stringify(item.preset)
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAddTextClip(item.preset)}
                    title={`Click or drag "${item.label}" to timeline`}
                    className="group flex items-center justify-between p-3 rounded-lg bg-[#1e2028] border border-[#2a2d36] hover:border-[#00d4c6]/60 text-left transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <div>
                      <div
                        className="text-sm font-semibold"
                        style={{ color: item.preset.color }}
                      >
                        {item.preview}
                      </div>
                      <div className="text-[11px] text-[#7e8494]">
                        {item.label}
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-[#8c92a0] group-hover:text-[#00d4c6]" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'captions' && (
          <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
                Auto Captions
              </h2>
              <span className="text-[10px] font-mono text-[#00d4c6]">
                Whisper AI
              </span>
            </div>

            {/* Language Selector */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#9aa0ad] block">Language</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'hinglish', label: 'Hinglish' },
                    { id: 'english', label: 'English' },
                  ] as const
                ).map((lang) => (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => setCaptionMode(lang.id)}
                    className={`py-1.5 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      captionMode === lang.id
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6]'
                        : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source Media Selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-[#9aa0ad] block">
                Source Video / Audio
              </label>
              {transcribableAssets.length === 0 ? (
                <p className="text-[11px] text-[#6d7382] p-2.5 rounded-lg bg-[#121419] border border-[#22252e]">
                  Import a video or audio file in the Media/Audio tab first.
                </p>
              ) : (
                <select
                  value={selectedCaptionAsset?.id ?? ''}
                  onChange={(e) => setCaptionAssetId(e.target.value)}
                  className="w-full bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                >
                  {transcribableAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Caption Style */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-[#8c92a0] block">Size</span>
                <select
                  value={captionFontSize}
                  onChange={(e) => setCaptionFontSize(Number(e.target.value))}
                  className="w-full bg-[#1e2028] border border-[#2a2d36] rounded px-1.5 py-1 text-[11px] text-white outline-none"
                >
                  <option value={28}>Small</option>
                  <option value={34}>Medium</option>
                  <option value={44}>Large</option>
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-[#8c92a0] block">Pos</span>
                <select
                  value={captionY}
                  onChange={(e) => setCaptionY(Number(e.target.value))}
                  className="w-full bg-[#1e2028] border border-[#2a2d36] rounded px-1.5 py-1 text-[11px] text-white outline-none"
                >
                  <option value={34}>Bottom</option>
                  <option value={0}>Center</option>
                  <option value={-34}>Top</option>
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-[#8c92a0] block">Color</span>
                <input
                  type="color"
                  value={captionColor}
                  onChange={(e) => setCaptionColor(e.target.value)}
                  className="w-full h-6.5 rounded border border-[#2a2d36] bg-transparent cursor-pointer"
                />
              </div>
            </div>

            {/* Caption Template Selector (Normal + 8 Animated Templates) */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#9aa0ad] block">
                Caption Template
              </span>
              <div className="grid grid-cols-1 gap-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                {CAPTION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectCaptionTemplate(tpl.id)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      captionTemplate === tpl.id
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-white'
                        : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    <span className="text-[11px] font-medium truncate">
                      {tpl.name}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-[#00d4c6] shrink-0">
                      {tpl.badge}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Lines & Max Characters per Line (for Normal template) */}
            {captionTemplate === 'none' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-[#8c92a0] block">
                    Lines
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={captionLines}
                    onChange={(e) =>
                      setCaptionLines(
                        Math.max(1, Math.min(6, Number(e.target.value) || 1))
                      )
                    }
                    className="w-full bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded px-2 py-1 text-xs font-mono text-white outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#8c92a0] block">
                    Chars / Line
                  </label>
                  <input
                    type="number"
                    min={4}
                    max={80}
                    value={captionMaxChars}
                    onChange={(e) =>
                      setCaptionMaxChars(
                        Math.max(4, Math.min(80, Number(e.target.value) || 8))
                      )
                    }
                    className="w-full bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded px-2 py-1 text-xs font-mono text-white outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!selectedCaptionAsset || isTranscribing}
              onClick={() => void handleGenerateCaptions()}
              className="w-full py-2.5 px-3 rounded-lg bg-[#00d4c6] hover:bg-[#18e3d5] disabled:opacity-40 disabled:pointer-events-none text-[#091214] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {isTranscribing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating Captions...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Captions</span>
                </>
              )}
            </button>

            {captionError && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
                {captionError}
              </div>
            )}

            {captionSegments.length > 0 && (
              <div className="flex-1 min-h-0 flex flex-col gap-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#00d4c6] font-medium">
                    {captionMeta}
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadSrt}
                    className="flex items-center gap-1 text-[11px] text-[#b0b5c0] hover:text-white cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>.SRT</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                  {captionSegments.map((seg) => (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => onSeekTo?.(seg.start)}
                      className="w-full text-left p-2 rounded-lg bg-[#1e2028] hover:border-[#00d4c6]/60 border border-[#2a2d36] transition-colors cursor-pointer"
                    >
                      <div className="text-[10px] font-mono text-[#00d4c6]">
                        {formatDuration(seg.start)} → {formatDuration(seg.end)}
                      </div>
                      <div className="text-xs text-white mt-0.5 leading-snug">
                        {seg.text}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'audio' && (
          <div
            className="flex flex-col h-full p-3 gap-3"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setIsDraggingOver(true);
              }
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDropFiles}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
                Audio
              </h2>
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#232630] hover:bg-[#2d313d] text-xs font-medium text-white transition-colors cursor-pointer"
                title="Import audio files"
              >
                <Upload className="w-3.5 h-3.5 text-[#00d4c6]" />
                <span>Import</span>
              </button>
              <input
                ref={audioInputRef}
                type="file"
                multiple
                accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) onImportFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {audioAssets.length === 0 ? (
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-5 text-center gap-2 transition-colors cursor-pointer ${
                  isDraggingOver
                    ? 'border-[#00d4c6] bg-[#00d4c6]/10'
                    : 'border-[#2c303a] hover:border-[#3d4250] bg-[#1a1c23]/60'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-[#232630] flex items-center justify-center text-[#00d4c6]">
                  <Music className="w-5 h-5" />
                </div>
                <p className="text-xs font-medium text-white">
                  Import Background Music
                </p>
                <p className="text-[11px] text-[#7e8494]">
                  Supports MP3, WAV, M4A, AAC, OGG
                </p>
              </button>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {audioAssets.map((asset) => (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, asset)}
                    className="group flex items-center gap-2.5 p-2.5 rounded-lg bg-[#1e2028] border border-[#2a2d36] hover:border-[#00d4c6]/60 cursor-grab active:cursor-grabbing"
                  >
                    <div className="w-8 h-8 rounded-md bg-[#00d4c6]/15 text-[#00d4c6] flex items-center justify-center shrink-0">
                      <Music className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{asset.name}</p>
                      <p className="text-[10px] font-mono text-[#7e8494]">
                        {formatDuration(asset.duration)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddMediaToTimeline(asset)}
                      title="Add audio to timeline"
                      className="w-7 h-7 rounded-md bg-[#00d4c6] text-[#091214] flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveMedia(asset.id)}
                      title="Remove audio"
                      className="w-6 h-6 rounded text-[#7e8494] hover:text-red-400 flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
