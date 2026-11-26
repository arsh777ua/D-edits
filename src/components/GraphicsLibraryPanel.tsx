import {
  Copy,
  Eye,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphicCategory, GraphicPreset } from '../types/editor';
import {
  presetToPreviewClip,
  renderGraphicToCanvas,
} from '../utils/graphicsRenderer';
import {
  BUILTIN_GRAPHIC_PRESETS,
  GRAPHIC_CATEGORIES,
} from '../utils/graphicTemplates';

interface GraphicsLibraryPanelProps {
  customPresets: GraphicPreset[];
  onAddGraphic: (preset: GraphicPreset) => void;
  onDuplicatePreset: (preset: GraphicPreset) => void;
  onDeletePreset: (presetId: string) => void;
}

function TemplateCanvasPreview({
  preset,
  isHovered,
  width = 240,
  height = 135,
  playing,
  scrubTime,
}: {
  preset: GraphicPreset;
  isHovered?: boolean;
  width?: number;
  height?: number;
  playing?: boolean;
  scrubTime?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clip = useMemo(() => presetToPreviewClip(preset), [preset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const shouldAnimate = Boolean(isHovered || playing);
    let rafId = 0;
    const startMs = performance.now();

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      // Subtle dark studio backdrop
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#141720');
      grad.addColorStop(1, '#0b0d12');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      renderGraphicToCanvas({
        ctx,
        width,
        height,
        time: t,
        clip,
      });
    };

    if (!shouldAnimate) {
      draw(scrubTime ?? Math.min(1.4, (clip.duration || 4) * 0.35));
      return;
    }

    const tick = (now: number) => {
      const dur = Math.max(1.5, clip.duration || 4);
      const elapsed = ((now - startMs) / 1000) % dur;
      draw(elapsed);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [clip, height, isHovered, playing, scrubTime, width]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full object-cover block"
    />
  );
}

export function GraphicsLibraryPanel({
  customPresets,
  onAddGraphic,
  onDuplicatePreset,
  onDeletePreset,
}: GraphicsLibraryPanelProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | GraphicCategory>('all');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [previewPreset, setPreviewPreset] = useState<GraphicPreset | null>(null);
  const [modalPlaying, setModalPlaying] = useState(true);
  const [modalTime, setModalTime] = useState(1.0);

  const allPresets = useMemo(
    () => [...customPresets, ...BUILTIN_GRAPHIC_PRESETS],
    [customPresets]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPresets.filter((p) => {
      const catMatch =
        category === 'all'
          ? !p.isCustom
          : category === 'my-templates'
            ? Boolean(p.isCustom)
            : p.category === category && !p.isCustom;
      if (!catMatch) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [allPresets, category, search]);

  const handleDragStart = (e: React.DragEvent, preset: GraphicPreset) => {
    e.dataTransfer.setData(
      'application/x-cutlite-graphic',
      JSON.stringify(preset)
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="flex flex-col h-full p-3 gap-2.5 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#00d4c6]" />
          <span>Graphics Library</span>
        </h2>
        <span className="text-[10px] text-[#6d7382] font-mono">
          {filtered.length} templates
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-[#6d7382] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] outline-none text-xs text-white placeholder:text-[#6d7382]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6d7382] hover:text-white cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Category Filters */}
      <div className="flex flex-wrap gap-1">
        {GRAPHIC_CATEGORIES.map((cat) => {
          const active = category === cat.id;
          const count =
            cat.id === 'my-templates' ? customPresets.length : undefined;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                active
                  ? 'bg-[#00d4c6]/20 text-[#00d4c6] border border-[#00d4c6]/50'
                  : 'bg-[#1e2028] text-[#9aa0ad] border border-[#2a2d36] hover:text-white'
              }`}
            >
              {cat.label}
              {count !== undefined && count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Thumbnail Grid */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-2 text-[#6d7382]">
          <Sparkles className="w-7 h-7 opacity-40" />
          <p className="text-xs text-[#9aa0ad]">
            {category === 'my-templates'
              ? 'No custom presets saved yet'
              : search
                ? 'No matching templates'
                : 'No templates added yet'}
          </p>
          <p className="text-[11px]">
            {category === 'my-templates'
              ? 'Customize any graphic on the timeline and click "Save as Preset" in Properties.'
              : search
                ? 'Try clearing your search or switching categories.'
                : 'Ready to add the templates you specify.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 grid grid-cols-2 gap-2 content-start">
          {filtered.map((preset) => (
            <div
              key={preset.id}
              draggable
              onDragStart={(e) => handleDragStart(e, preset)}
              onMouseEnter={() => setHoveredId(preset.id)}
              onMouseLeave={() =>
                setHoveredId((cur) => (cur === preset.id ? null : cur))
              }
              onDoubleClick={() => onAddGraphic(preset)}
              title={`${preset.name} — ${preset.description}\nDrag to timeline or click +`}
              className="group relative rounded-lg overflow-hidden bg-[#1e2028] border border-[#2a2d36] hover:border-[#00d4c6]/70 transition-colors cursor-grab active:cursor-grabbing"
            >
              <div className="aspect-video bg-black relative overflow-hidden">
                <TemplateCanvasPreview
                  preset={preset}
                  isHovered={hoveredId === preset.id}
                />

                {/* Quick Action Overlay */}
                <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewPreset(preset);
                      setModalPlaying(true);
                      setModalTime(0.8);
                    }}
                    title="Preview template"
                    className="w-6 h-6 rounded-md bg-black/75 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddGraphic(preset);
                    }}
                    title="Add to timeline"
                    className="w-6 h-6 rounded-md bg-[#00d4c6] hover:bg-[#00e8d8] text-[#0e0f12] flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                </div>

                {preset.isCustom && (
                  <div className="absolute bottom-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicatePreset(preset);
                      }}
                      title="Duplicate preset"
                      className="w-5 h-5 rounded bg-black/75 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                    >
                      <Copy className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePreset(preset.id);
                      }}
                      title="Delete preset"
                      className="w-5 h-5 rounded bg-black/75 hover:bg-red-500 text-white flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="px-2 py-1.5">
                <p className="text-[11px] font-medium text-[#e8eaed] truncate">
                  {preset.name}
                </p>
                <p className="text-[9px] text-[#6d7382] truncate">
                  {preset.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewPreset && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewPreset(null)}
        >
          <div
            className="w-full max-w-xl rounded-xl bg-[#16181d] border border-[#2a2d36] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[#262932] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {previewPreset.name}
                </h3>
                <p className="text-[11px] text-[#8c92a0]">
                  {previewPreset.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPreset(null)}
                className="p-1.5 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-video bg-black">
              <TemplateCanvasPreview
                preset={previewPreset}
                width={640}
                height={360}
                playing={modalPlaying}
                scrubTime={modalTime}
              />
            </div>

            <div className="px-4 py-3 bg-[#121419] border-t border-[#262932] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => setModalPlaying((p) => !p)}
                  className="w-7 h-7 rounded-full bg-[#e8eaed] hover:bg-white text-[#0e0f12] flex items-center justify-center cursor-pointer"
                >
                  {modalPlaying ? (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={previewPreset.defaultDuration || 4}
                  step={0.05}
                  value={modalTime}
                  onChange={(e) => {
                    setModalPlaying(false);
                    setModalTime(Number(e.target.value));
                  }}
                  className="editor-slider flex-1"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  onAddGraphic(previewPreset);
                  setPreviewPreset(null);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[#00d4c6] hover:bg-[#00e8d8] text-[#0e0f12] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add to Timeline</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
