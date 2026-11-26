import {
  BookmarkPlus,
  Check,
  Eye,
  EyeOff,
  Layers,
  Palette,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
  Move,
  Volume2,
  Play,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  GraphicAnimation,
  GraphicBlendMode,
  GraphicClip,
  GraphicEasing,
  GraphicEntranceAnim,
  GraphicExitAnim,
  GraphicIconName,
  GraphicLayer,
  GraphicLoopAnim,
  GraphicSfxSettings,
  GraphicSpecificProps,
  GraphicTexture,
  GraphicTransform,
  GraphicVisualStyle,
  MediaAsset,
} from '../types/editor';
import { fetchSfxList, playOneShotSfx, type SfxEntry } from '../utils/sfx';
import { useSystemFonts } from '../utils/systemFonts';
import { uid } from '../utils/time';

interface GraphicPropertiesProps {
  clip: GraphicClip;
  mediaAssets: MediaAsset[];
  onUpdate: (patch: Partial<GraphicClip>, recordHistory?: boolean) => void;
  onSavePreset: (clip: GraphicClip, name: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

type SectionTab = 'content' | 'visual' | 'transform' | 'animation' | 'special' | 'sfx';

const DOODLE_ICONS: GraphicIconName[] = [
  'arrow',
  'circle',
  'sparkle',
  'star',
  'check',
  'crosshair',
  'scribble',
  'underline',
  'bolt',
];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (v: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#9aa0ad]">{label}</span>
        <span className="font-mono text-[#e8eaed] tabular-nums">
          {display ?? value}
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

export function GraphicProperties({
  clip,
  mediaAssets,
  onUpdate,
  onSavePreset,
  onDragStart,
  onDragEnd,
}: GraphicPropertiesProps) {
  const [section, setSection] = useState<SectionTab>('content');
  const [selectedLayerId, setSelectedLayerId] = useState<string>(
    clip.layers[0]?.id ?? ''
  );
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState(`${clip.name} Custom`);
  const [savedToast, setSavedToast] = useState(false);
  const [sfxList, setSfxList] = useState<SfxEntry[]>([]);
  const systemFonts = useSystemFonts();

  useEffect(() => {
    let active = true;
    fetchSfxList().then((list) => {
      if (active) setSfxList(list);
    });
    return () => {
      active = false;
    };
  }, []);

  const currentSfx: GraphicSfxSettings = clip.sfx ?? {
    enabled: false,
    sfxFile: sfxList[0]?.fileName ?? 'pop.mp3',
    sfxName: sfxList[0]?.name ?? 'pop',
    volume: 0.85,
    triggerMode: 'on-start',
    delay: 0,
  };

  const updateSfx = (patch: Partial<GraphicSfxSettings>, record = true) => {
    onUpdate({ sfx: { ...currentSfx, ...patch } }, record);
  };

  const activeLayer =
    clip.layers.find((l) => l.id === selectedLayerId) ?? clip.layers[0];

  const updateLayer = (
    layerId: string,
    patch: Partial<GraphicLayer>,
    record = true
  ) => {
    const nextLayers = clip.layers.map((l) =>
      l.id === layerId ? { ...l, ...patch } : l
    );
    if (
      clip.templateId === 'moving-grid-counter' &&
      patch.text !== undefined &&
      clip.layers[0]?.id === layerId
    ) {
      const parsed = Number(patch.text.replace(/,/g, '').trim());
      if (Number.isFinite(parsed) && patch.text.trim() !== '') {
        onUpdate(
          {
            layers: nextLayers,
            specific: { ...clip.specific, countTo: parsed },
          },
          record
        );
        return;
      }
    }
    onUpdate({ layers: nextLayers }, record);
  };

  const updateVisual = (
    patch: Partial<GraphicVisualStyle>,
    record = true
  ) => {
    onUpdate({ visual: { ...clip.visual, ...patch } }, record);
  };

  const updateTransform = (
    patch: Partial<GraphicTransform>,
    record = true
  ) => {
    onUpdate({ transform: { ...clip.transform, ...patch } }, record);
  };

  const updateAnim = (patch: Partial<GraphicAnimation>, record = true) => {
    onUpdate({ animation: { ...clip.animation, ...patch } }, record);
  };

  const updateSpecific = (
    patch: Partial<GraphicSpecificProps>,
    record = true
  ) => {
    onUpdate({ specific: { ...clip.specific, ...patch } }, record);
  };

  const handleAddTextLayer = () => {
    const newLayer: GraphicLayer = {
      id: uid('layer'),
      name: `Text ${clip.layers.length + 1}`,
      type: 'text',
      visible: true,
      text: 'New Layer',
      fontFamily: 'Inter, sans-serif',
      fontWeight: 700,
      fontSize: 32,
      color: '#ffffff',
      x: 0,
      y: 20,
    };
    onUpdate({ layers: [...clip.layers, newLayer] }, true);
    setSelectedLayerId(newLayer.id);
  };

  const handleDeleteLayer = (id: string) => {
    if (clip.layers.length <= 1) return;
    const next = clip.layers.filter((l) => l.id !== id);
    onUpdate({ layers: next }, true);
    if (selectedLayerId === id && next[0]) setSelectedLayerId(next[0].id);
  };

  const visualMediaAssets = mediaAssets.filter(
    (a) => a.type === 'image' || a.type === 'video'
  );

  return (
    <div className="space-y-4">
      {/* Save as Custom Preset */}
      <div className="p-2.5 rounded-lg bg-[#1c1f27] border border-[#2a2d36] space-y-2">
        {!savingPreset ? (
          <button
            type="button"
            onClick={() => {
              setPresetName(`${clip.name} Custom`);
              setSavingPreset(true);
            }}
            className="w-full py-1.5 px-2.5 rounded-md bg-[#00d4c6]/15 hover:bg-[#00d4c6]/25 border border-[#00d4c6]/40 text-[#00d4c6] text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {savedToast ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Saved to My Templates!</span>
              </>
            ) : (
              <>
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Save as Custom Preset</span>
              </>
            )}
          </button>
        ) : (
          <div className="space-y-1.5">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name..."
              className="w-full px-2 py-1 rounded bg-[#121419] border border-[#2c303a] text-xs text-white outline-none focus:border-[#00d4c6]"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onSavePreset(clip, presetName);
                  setSavingPreset(false);
                  setSavedToast(true);
                  setTimeout(() => setSavedToast(false), 2000);
                }}
                className="flex-1 py-1 rounded bg-[#00d4c6] text-[#0e0f12] text-[11px] font-semibold cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setSavingPreset(false)}
                className="px-2.5 py-1 rounded bg-[#232630] text-[#9aa0ad] text-[11px] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section Switcher */}
      <div className="grid grid-cols-6 gap-1 bg-[#121419] p-1 rounded-lg border border-[#262932]">
        {(
          [
            { id: 'content', label: 'Layers', icon: Layers },
            { id: 'visual', label: 'Style', icon: Palette },
            { id: 'transform', label: 'Pos', icon: Move },
            { id: 'animation', label: 'Anim', icon: Sparkles },
            { id: 'sfx', label: 'SFX', icon: Volume2 },
            { id: 'special', label: 'FX', icon: Sliders },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`py-1.5 rounded-md flex flex-col items-center gap-0.5 text-[9px] font-medium cursor-pointer transition-colors ${
                active
                  ? 'bg-[#00d4c6]/20 text-[#00d4c6]'
                  : 'text-[#8c92a0] hover:text-white'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. CONTENT & LAYERS */}
      {section === 'content' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-white">
              Editable Layers ({clip.layers.length})
            </h3>
            <button
              type="button"
              onClick={handleAddTextLayer}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#232630] hover:bg-[#2d313d] text-[10px] text-[#00d4c6] cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add Text</span>
            </button>
          </div>

          <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
            {clip.layers.map((layer) => {
              const isSel = activeLayer?.id === layer.id;
              return (
                <div
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-md border text-[11px] cursor-pointer ${
                    isSel
                      ? 'bg-[#00d4c6]/10 border-[#00d4c6]/60 text-white'
                      : 'bg-[#1e2028] border-[#2a2d36] text-[#9aa0ad] hover:text-white'
                  }`}
                >
                  <span className="truncate">{layer.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateLayer(layer.id, { visible: !layer.visible });
                      }}
                      className="p-0.5 hover:text-white cursor-pointer"
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                      {layer.visible ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3 opacity-50" />
                      )}
                    </button>
                    {clip.layers.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteLayer(layer.id);
                        }}
                        className="p-0.5 hover:text-red-400 cursor-pointer"
                        title="Remove layer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activeLayer && (
            <div className="pt-2 border-t border-[#262932] space-y-3">
              {(activeLayer.type === 'text' || activeLayer.type === 'window') && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[#9aa0ad]">Text Content</label>
                    <textarea
                      rows={2}
                      value={activeLayer.text ?? ''}
                      onChange={(e) =>
                        updateLayer(activeLayer.id, { text: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 rounded-md bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] outline-none text-xs text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#9aa0ad]">Font</label>
                      <select
                        value={(activeLayer.fontFamily ?? 'Segoe UI').split(',')[0].replace(/['"]/g, '').trim()}
                        onChange={(e) =>
                          updateLayer(activeLayer.id, { fontFamily: e.target.value })
                        }
                        className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
                      >
                        {systemFonts.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#9aa0ad]">Weight</label>
                      <select
                        value={activeLayer.fontWeight ?? 700}
                        onChange={(e) =>
                          updateLayer(activeLayer.id, {
                            fontWeight: Number(e.target.value),
                          })
                        }
                        className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
                      >
                        <option value={400}>Regular (400)</option>
                        <option value={600}>SemiBold (600)</option>
                        <option value={700}>Bold (700)</option>
                        <option value={900}>Black (900)</option>
                      </select>
                    </div>
                  </div>
                  <Slider
                    label="Font Size"
                    value={activeLayer.fontSize ?? 36}
                    min={12}
                    max={160}
                    display={`${activeLayer.fontSize ?? 36}px`}
                    onChange={(v) =>
                      updateLayer(activeLayer.id, { fontSize: v }, false)
                    }
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                  <Slider
                    label="Letter Spacing"
                    value={activeLayer.letterSpacing ?? 0}
                    min={-4}
                    max={24}
                    display={`${activeLayer.letterSpacing ?? 0}px`}
                    onChange={(v) =>
                      updateLayer(activeLayer.id, { letterSpacing: v }, false)
                    }
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#9aa0ad]">Text Color</span>
                    <input
                      type="color"
                      value={activeLayer.color ?? '#ffffff'}
                      onChange={(e) =>
                        updateLayer(activeLayer.id, { color: e.target.value })
                      }
                      className="w-7 h-6 rounded bg-transparent cursor-pointer"
                    />
                  </div>
                </>
              )}

              {activeLayer.type === 'media' && (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-[#9aa0ad]">
                    Replace Slot Media
                  </label>
                  <select
                    value={activeLayer.mediaId ?? ''}
                    onChange={(e) =>
                      updateLayer(activeLayer.id, {
                        mediaId: e.target.value || undefined,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                  >
                    <option value="">Default / Studio Placeholder</option>
                    {visualMediaAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(activeLayer.type === 'doodle' || activeLayer.type === 'icon') && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[#9aa0ad]">
                      Doodle / Icon Shape
                    </label>
                    <select
                      value={activeLayer.iconName ?? 'arrow'}
                      onChange={(e) =>
                        updateLayer(activeLayer.id, {
                          iconName: e.target.value as GraphicIconName,
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                    >
                      {DOODLE_ICONS.map((ic) => (
                        <option key={ic} value={ic}>
                          {ic}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#9aa0ad]">Element Color</span>
                    <input
                      type="color"
                      value={activeLayer.color ?? '#fde047'}
                      onChange={(e) =>
                        updateLayer(activeLayer.id, { color: e.target.value })
                      }
                      className="w-7 h-6 rounded bg-transparent cursor-pointer"
                    />
                  </div>
                </>
              )}

              <Slider
                label="Layer X"
                value={activeLayer.x ?? 0}
                min={-50}
                max={50}
                display={`${activeLayer.x ?? 0}%`}
                onChange={(v) => updateLayer(activeLayer.id, { x: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Layer Y"
                value={activeLayer.y ?? 0}
                min={-50}
                max={50}
                display={`${activeLayer.y ?? 0}%`}
                onChange={(v) => updateLayer(activeLayer.id, { y: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </div>
          )}
        </div>
      )}

      {/* 2. VISUAL STYLE */}
      {section === 'visual' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-[10px] text-[#9aa0ad]">
            <label className="flex flex-col items-center gap-1">
              <span>Primary</span>
              <input
                type="color"
                value={clip.visual.primaryColor}
                onChange={(e) => updateVisual({ primaryColor: e.target.value })}
                className="w-8 h-6 rounded cursor-pointer"
              />
            </label>
            <label className="flex flex-col items-center gap-1">
              <span>Secondary</span>
              <input
                type="color"
                value={clip.visual.secondaryColor}
                onChange={(e) => updateVisual({ secondaryColor: e.target.value })}
                className="w-8 h-6 rounded cursor-pointer"
              />
            </label>
            <label className="flex flex-col items-center gap-1">
              <span>Backdrop</span>
              <input
                type="color"
                value={clip.visual.backgroundColor}
                onChange={(e) =>
                  updateVisual({ backgroundColor: e.target.value })
                }
                className="w-8 h-6 rounded cursor-pointer"
              />
            </label>
          </div>

          <Slider
            label="Background Opacity"
            value={clip.visual.backgroundOpacity}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(clip.visual.backgroundOpacity * 100)}%`}
            onChange={(v) => updateVisual({ backgroundOpacity: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Opacity"
            value={clip.visual.opacity}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(clip.visual.opacity * 100)}%`}
            onChange={(v) => updateVisual({ opacity: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Border Radius"
            value={clip.visual.borderRadius}
            min={0}
            max={48}
            display={`${clip.visual.borderRadius}px`}
            onChange={(v) => updateVisual({ borderRadius: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Glow Intensity"
            value={clip.visual.glowIntensity}
            min={0}
            max={40}
            display={`${clip.visual.glowIntensity}`}
            onChange={(v) => updateVisual({ glowIntensity: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Shadow Blur"
            value={clip.visual.shadowBlur}
            min={0}
            max={40}
            display={`${clip.visual.shadowBlur}px`}
            onChange={(v) => updateVisual({ shadowBlur: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0ad]">Blend Mode</label>
              <select
                value={clip.visual.blendMode}
                onChange={(e) =>
                  updateVisual({ blendMode: e.target.value as GraphicBlendMode })
                }
                className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                <option value="source-over">Normal</option>
                <option value="screen">Screen</option>
                <option value="multiply">Multiply</option>
                <option value="overlay">Overlay</option>
                <option value="lighten">Lighten</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0ad]">Texture</label>
              <select
                value={clip.visual.texture}
                onChange={(e) =>
                  updateVisual({ texture: e.target.value as GraphicTexture })
                }
                className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                <option value="none">None</option>
                <option value="grain">Film Grain</option>
                <option value="scanlines">Scanlines</option>
                <option value="grid">Grid</option>
                <option value="halftone">Halftone</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 3. TRANSFORM */}
      {section === 'transform' && (
        <div className="space-y-3">
          <Slider
            label="Position X"
            value={clip.transform.x}
            min={-100}
            max={100}
            display={`${clip.transform.x}%`}
            onChange={(v) => updateTransform({ x: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Position Y"
            value={clip.transform.y}
            min={-100}
            max={100}
            display={`${clip.transform.y}%`}
            onChange={(v) => updateTransform({ y: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Scale X"
            value={clip.transform.scaleX}
            min={0.2}
            max={2.5}
            step={0.05}
            display={`${Math.round(clip.transform.scaleX * 100)}%`}
            onChange={(v) => updateTransform({ scaleX: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Scale Y"
            value={clip.transform.scaleY}
            min={0.2}
            max={2.5}
            step={0.05}
            display={`${Math.round(clip.transform.scaleY * 100)}%`}
            onChange={(v) => updateTransform({ scaleY: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Rotation"
            value={clip.transform.rotation}
            min={-180}
            max={180}
            display={`${clip.transform.rotation}°`}
            onChange={(v) => updateTransform({ rotation: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
      )}

      {/* 4. ANIMATION */}
      {section === 'animation' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0ad]">Entrance</label>
              <select
                value={clip.animation.entrance}
                onChange={(e) =>
                  updateAnim({
                    entrance: e.target.value as GraphicEntranceAnim,
                  })
                }
                className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                <option value="none">None</option>
                <option value="fade">Fade</option>
                <option value="scale-pop">Scale Pop</option>
                <option value="slide-up">Slide Up</option>
                <option value="slide-down">Slide Down</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="blur-in">Blur In</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0ad]">Exit</label>
              <select
                value={clip.animation.exit}
                onChange={(e) =>
                  updateAnim({ exit: e.target.value as GraphicExitAnim })
                }
                className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                <option value="none">None</option>
                <option value="fade">Fade</option>
                <option value="scale-down">Scale Down</option>
                <option value="slide-up">Slide Up</option>
                <option value="slide-down">Slide Down</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="blur-out">Blur Out</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0ad]">Loop Motion</label>
              <select
                value={clip.animation.loop}
                onChange={(e) =>
                  updateAnim({ loop: e.target.value as GraphicLoopAnim })
                }
                className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                <option value="none">None</option>
                <option value="float">Float</option>
                <option value="pulse">Pulse</option>
                <option value="orbit">Orbit</option>
                <option value="breathe">Breathe</option>
                <option value="shimmer">Shimmer</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#9aa0ad]">Easing</label>
              <select
                value={clip.animation.easing}
                onChange={(e) =>
                  updateAnim({ easing: e.target.value as GraphicEasing })
                }
                className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                <option value="linear">Linear</option>
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In-Out</option>
                <option value="back-out">Back Overshoot</option>
                <option value="elastic">Elastic</option>
              </select>
            </div>
          </div>

          <Slider
            label="Animation Speed"
            value={clip.animation.speed}
            min={0.25}
            max={3}
            step={0.05}
            display={`${clip.animation.speed}x`}
            onChange={(v) => updateAnim({ speed: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Entrance Duration"
            value={clip.animation.entranceDuration}
            min={0.1}
            max={2.5}
            step={0.05}
            display={`${clip.animation.entranceDuration}s`}
            onChange={(v) => updateAnim({ entranceDuration: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="Stagger Timing"
            value={clip.animation.stagger}
            min={0}
            max={0.5}
            step={0.02}
            display={`${clip.animation.stagger}s`}
            onChange={(v) => updateAnim({ stagger: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
      )}

      {/* 5. SFX SETTINGS */}
      {section === 'sfx' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">
              Sound Effect
            </span>
            <button
              type="button"
              onClick={() => updateSfx({ enabled: !currentSfx.enabled })}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer transition-colors ${
                currentSfx.enabled
                  ? 'bg-[#00d4c6]/20 text-[#00d4c6] border border-[#00d4c6]/50'
                  : 'bg-[#1e2028] text-[#8c92a0] border border-[#2a2d36]'
              }`}
            >
              {currentSfx.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#9aa0ad]">
              SFX File (custom assets/sfx)
            </label>
            <div className="flex items-center gap-1.5">
              <select
                value={currentSfx.sfxFile}
                onChange={(e) => {
                  const chosen = sfxList.find((s) => s.fileName === e.target.value);
                  updateSfx({
                    enabled: true,
                    sfxFile: e.target.value,
                    sfxName: chosen?.name ?? e.target.value,
                  });
                }}
                className="flex-1 min-w-0 px-2 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
              >
                {sfxList.map((s) => (
                  <option key={s.fileName} value={s.fileName}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Preview sound effect"
                onClick={() => {
                  const ctx = new AudioContext();
                  void playOneShotSfx(ctx, currentSfx.sfxFile, currentSfx.volume);
                }}
                className="p-1.5 rounded bg-[#00d4c6] hover:bg-[#00e8d8] text-[#0e0f12] cursor-pointer shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#9aa0ad]">Trigger Mode</label>
            <select
              value={currentSfx.triggerMode}
              onChange={(e) =>
                updateSfx({
                  triggerMode: e.target.value as 'on-start' | 'per-word' | 'on-target',
                })
              }
              className="w-full px-2 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-[11px] text-white"
            >
              <option value="per-word">Per Word / Line Pop</option>
              <option value="on-target">When Target Number Arrives</option>
              <option value="on-start">Once on Clip Start</option>
            </select>
          </div>

          <Slider
            label="SFX Volume"
            value={currentSfx.volume}
            min={0}
            max={2}
            step={0.05}
            display={`${Math.round(currentSfx.volume * 100)}%`}
            onChange={(v) => updateSfx({ volume: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <Slider
            label="SFX Delay"
            value={currentSfx.delay ?? 0}
            min={0}
            max={2}
            step={0.05}
            display={`${currentSfx.delay ?? 0}s`}
            onChange={(v) => updateSfx({ delay: v }, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
      )}

      {/* 6. TEMPLATE-SPECIFIC CONTROLS */}
      {section === 'special' && (
        <div className="space-y-3">
          {clip.templateId === 'cinematic-title-reveal' && (
            <>
              <Slider
                label="Letterbox Bars"
                value={clip.specific.letterboxBars ?? 10}
                min={0}
                max={22}
                display={`${clip.specific.letterboxBars ?? 10}%`}
                onChange={(v) => updateSpecific({ letterboxBars: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Flare Intensity"
                value={clip.specific.flareIntensity ?? 0.7}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(v) => updateSpecific({ flareIntensity: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </>
          )}
          {clip.templateId === 'text-behind-subject' && (
            <Slider
              label="Text Depth Opacity"
              value={clip.specific.textDepth ?? 0.85}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(v) => updateSpecific({ textDepth: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {(clip.templateId === 'floating-3d-text' ||
            clip.templateId === 'perspective-caption') && (
            <Slider
              label="3D Extrusion Depth"
              value={
                clip.specific.depth3D ?? clip.specific.extrusionDepth ?? 14
              }
              min={2}
              max={32}
              onChange={(v) =>
                updateSpecific({ depth3D: v, extrusionDepth: v }, false)
              }
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'kinetic-typography' && (
            <div className="space-y-1">
              <label className="text-[11px] text-[#9aa0ad]">Kinetic Mode</label>
              <select
                value={clip.specific.kineticMode ?? 'word'}
                onChange={(e) =>
                  updateSpecific({
                    kineticMode: e.target.value as 'word' | 'character',
                  })
                }
                className="w-full px-2 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
              >
                <option value="word">Word by Word</option>
                <option value="character">Character by Character</option>
              </select>
            </div>
          )}
          {clip.templateId === 'subject-pop-out' && (
            <>
              <Slider
                label="Outline Width"
                value={clip.specific.outlineWidth ?? 6}
                min={0}
                max={16}
                onChange={(v) => updateSpecific({ outlineWidth: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Shadow Offset"
                value={clip.specific.shadowDistance ?? 16}
                min={0}
                max={40}
                onChange={(v) => updateSpecific({ shadowDistance: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </>
          )}
          {clip.templateId === 'magnified-detail' && (
            <>
              <Slider
                label="Zoom Amount"
                value={clip.specific.zoomAmount ?? 2.4}
                min={1.2}
                max={5}
                step={0.1}
                display={`${clip.specific.zoomAmount ?? 2.4}x`}
                onChange={(v) => updateSpecific({ zoomAmount: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Target X"
                value={clip.specific.targetX ?? -12}
                min={-40}
                max={40}
                onChange={(v) => updateSpecific({ targetX: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </>
          )}
          {clip.templateId === 'motion-echo' && (
            <>
              <Slider
                label="Echo Count"
                value={clip.specific.echoCount ?? 5}
                min={2}
                max={10}
                onChange={(v) => updateSpecific({ echoCount: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Echo Spacing"
                value={clip.specific.echoSpacing ?? 22}
                min={6}
                max={50}
                onChange={(v) => updateSpecific({ echoSpacing: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </>
          )}
          {clip.templateId === 'spotlight-focus' && (
            <>
              <Slider
                label="Spotlight Radius"
                value={clip.specific.spotlightRadius ?? 24}
                min={8}
                max={50}
                onChange={(v) => updateSpecific({ spotlightRadius: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Edge Feather"
                value={clip.specific.spotlightFeather ?? 45}
                min={5}
                max={90}
                onChange={(v) => updateSpecific({ spotlightFeather: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </>
          )}
          {clip.templateId === 'film-strip' && (
            <Slider
              label="Scroll Speed"
              value={clip.specific.scrollSpeed ?? 1}
              min={0}
              max={3}
              step={0.1}
              onChange={(v) => updateSpecific({ scrollSpeed: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'paper-tear-reveal' && (
            <Slider
              label="Tear Roughness"
              value={clip.specific.edgeRoughness ?? 18}
              min={4}
              max={40}
              onChange={(v) => updateSpecific({ edgeRoughness: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'sliding-film-panels' && (
            <Slider
              label="Panel Count"
              value={clip.specific.panelCount ?? 4}
              min={2}
              max={8}
              onChange={(v) => updateSpecific({ panelCount: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'infinite-frame' && (
            <Slider
              label="Nested Frames"
              value={clip.specific.nestedCount ?? 6}
              min={2}
              max={12}
              onChange={(v) => updateSpecific({ nestedCount: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'snapshot-explosion' && (
            <Slider
              label="Photo Count"
              value={clip.specific.photoCount ?? 5}
              min={2}
              max={9}
              onChange={(v) => updateSpecific({ photoCount: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'liquid-shape-reveal' && (
            <Slider
              label="Blob Complexity"
              value={clip.specific.blobComplexity ?? 6}
              min={3}
              max={12}
              onChange={(v) => updateSpecific({ blobComplexity: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'floating-glass-panels' && (
            <Slider
              label="Glass Opacity"
              value={clip.specific.glassOpacity ?? 0.18}
              min={0.05}
              max={0.6}
              step={0.02}
              onChange={(v) => updateSpecific({ glassOpacity: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'neon-line-composition' && (
            <Slider
              label="Neon Glow"
              value={clip.specific.neonGlow ?? 22}
              min={0}
              max={45}
              onChange={(v) => updateSpecific({ neonGlow: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'tracking-hud' && (
            <Slider
              label="Bracket Size"
              value={clip.specific.bracketSize ?? 22}
              min={10}
              max={45}
              onChange={(v) => updateSpecific({ bracketSize: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'flip-card-3d' && (
            <div className="space-y-1">
              <label className="text-[11px] text-[#9aa0ad]">Back Card Title</label>
              <input
                type="text"
                value={clip.specific.backTitle ?? 'AFTER'}
                onChange={(e) => updateSpecific({ backTitle: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
              />
            </div>
          )}
          {clip.templateId === 'pixel-disintegration' && (
            <Slider
              label="Particle Quantity"
              value={clip.specific.particleQuantity ?? 90}
              min={20}
              max={240}
              step={10}
              onChange={(v) => updateSpecific({ particleQuantity: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'rgb-split-entrance' && (
            <Slider
              label="Channel Offset"
              value={clip.specific.channelOffset ?? 16}
              min={2}
              max={40}
              onChange={(v) => updateSpecific({ channelOffset: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {clip.templateId === 'floating-object-showcase' && (
            <Slider
              label="Float Depth"
              value={clip.specific.floatDepth ?? 16}
              min={0}
              max={40}
              onChange={(v) => updateSpecific({ floatDepth: v }, false)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {(clip.templateId === 'moving-grid-pop-text' ||
            clip.templateId === 'moving-grid-counter') && (
            <>
              {clip.templateId === 'moving-grid-counter' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#9aa0ad]">Start Number</label>
                      <input
                        type="number"
                        value={clip.specific.countFrom ?? 0}
                        onChange={(e) =>
                          updateSpecific({ countFrom: Number(e.target.value) })
                        }
                        className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#9aa0ad]">Target Number</label>
                      <input
                        type="number"
                        value={clip.specific.countTo ?? 1000}
                        onChange={(e) => {
                          const nextNum = Number(e.target.value);
                          if (!Number.isFinite(nextNum)) return;
                          const nextLayers = clip.layers.map((l, idx) =>
                            idx === 0 ? { ...l, text: String(nextNum) } : l
                          );
                          onUpdate({
                            layers: nextLayers,
                            specific: { ...clip.specific, countTo: nextNum },
                          });
                        }}
                        className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#9aa0ad]">Prefix</label>
                      <input
                        type="text"
                        value={clip.specific.countPrefix ?? ''}
                        placeholder="$"
                        onChange={(e) =>
                          updateSpecific({ countPrefix: e.target.value })
                        }
                        className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#9aa0ad]">Suffix</label>
                      <input
                        type="text"
                        value={clip.specific.countSuffix ?? ''}
                        placeholder="e.g. % or K"
                        onChange={(e) =>
                          updateSpecific({ countSuffix: e.target.value })
                        }
                        className="w-full px-2 py-1 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                      />
                    </div>
                  </div>
                  <Slider
                    label="Count Duration"
                    value={clip.specific.countDuration ?? 2.4}
                    min={0.3}
                    max={10}
                    step={0.1}
                    display={`${clip.specific.countDuration ?? 2.4}s`}
                    onChange={(v) => updateSpecific({ countDuration: v }, false)}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                  <Slider
                    label="Decimals"
                    value={clip.specific.countDecimals ?? 0}
                    min={0}
                    max={3}
                    onChange={(v) => updateSpecific({ countDecimals: v }, false)}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                </>
              )}
              {clip.templateId === 'moving-grid-pop-text' && (
                <div className="space-y-1">
                  <label className="text-[11px] text-[#9aa0ad]">Pop Mode</label>
                  <select
                    value={clip.specific.popMode ?? 'word-by-word'}
                    onChange={(e) =>
                      updateSpecific({
                        popMode: e.target.value as 'word-by-word' | 'line-by-line',
                      })
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#1e2028] border border-[#2a2d36] text-xs text-white"
                  >
                    <option value="word-by-word">Word by Word (One Line)</option>
                    <option value="line-by-line">Line by Line (One Line)</option>
                  </select>
                </div>
              )}
              <Slider
                label="Grid Speed"
                value={clip.specific.gridSpeed ?? 1}
                min={0}
                max={4}
                step={0.1}
                display={`${clip.specific.gridSpeed ?? 1}x`}
                onChange={(v) => updateSpecific({ gridSpeed: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Grid Size"
                value={clip.specific.gridSize ?? 48}
                min={20}
                max={120}
                display={`${clip.specific.gridSize ?? 48}px`}
                onChange={(v) => updateSpecific({ gridSize: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
              <Slider
                label="Grid Opacity"
                value={clip.specific.gridOpacity ?? 0.22}
                min={0.05}
                max={0.8}
                step={0.02}
                display={`${Math.round((clip.specific.gridOpacity ?? 0.22) * 100)}%`}
                onChange={(v) => updateSpecific({ gridOpacity: v }, false)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
