import type {
  GraphicAnimation,
  GraphicCategory,
  GraphicClip,
  GraphicPreset,
  GraphicTransform,
  GraphicVisualStyle,
} from '../types/editor';
import { uid } from './time';

export const GRAPHIC_CATEGORIES: Array<{
  id: 'all' | GraphicCategory;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'cinematic-typography', label: 'Cinematic & Type' },
  { id: 'footage-enhancement', label: 'Footage FX' },
  { id: 'creative-transitions', label: 'Transitions' },
  { id: 'modern-elements', label: 'Modern UI' },
  { id: 'special-creative', label: 'Special 3D' },
  { id: 'my-templates', label: 'My Templates' },
];

export const DEFAULT_VISUAL_STYLE: GraphicVisualStyle = {
  backgroundColor: '#0e1117',
  backgroundOpacity: 0,
  primaryColor: '#00d4c6',
  secondaryColor: '#6366f1',
  gradientEnabled: true,
  gradientAngle: 135,
  strokeColor: '#ffffff',
  strokeWidth: 0,
  borderRadius: 16,
  shadowBlur: 18,
  shadowColor: 'rgba(0, 0, 0, 0.65)',
  glowIntensity: 0,
  opacity: 1,
  blendMode: 'source-over',
  texture: 'none',
};

export const DEFAULT_TRANSFORM: GraphicTransform = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  alignH: 'center',
  alignV: 'middle',
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
};

export const DEFAULT_ANIMATION: GraphicAnimation = {
  entrance: 'fade',
  exit: 'fade',
  loop: 'none',
  entranceDuration: 0.6,
  exitDuration: 0.45,
  delay: 0,
  speed: 1,
  easing: 'ease-out',
  direction: 'up',
  stagger: 0.12,
};

export const BUILTIN_GRAPHIC_PRESETS: GraphicPreset[] = [
  {
    id: 'tpl-moving-grid-pop-text',
    name: 'Moving Grid Pop Text',
    description: 'Complete black background, moving grid & one-line pop-up text.',
    templateId: 'moving-grid-pop-text',
    category: 'cinematic-typography',
    defaultDuration: 4.5,
    layers: [
      {
        id: 'l-grid-pop-text',
        name: 'Pop Text (One Line)',
        type: 'text',
        visible: true,
        text: 'CREATE BOLD VISUALS',
        fontFamily: 'Segoe UI',
        fontWeight: 800,
        fontSize: 60,
        letterSpacing: 3,
        color: '#ffffff',
        x: 0,
        y: 0,
      },
    ],
    visual: {
      ...DEFAULT_VISUAL_STYLE,
      backgroundColor: '#000000',
      backgroundOpacity: 1,
      primaryColor: '#ffffff',
      secondaryColor: '#00d4c6',
      glowIntensity: 0,
      shadowBlur: 0,
    },
    transform: { ...DEFAULT_TRANSFORM },
    animation: {
      ...DEFAULT_ANIMATION,
      entrance: 'scale-pop',
      exit: 'fade',
      loop: 'none',
      entranceDuration: 0.35,
      stagger: 0.28,
      easing: 'back-out',
    },
    specific: {
      gridSize: 48,
      gridSpeed: 1,
      gridOpacity: 0.22,
      popMode: 'word-by-word',
    },
    sfx: {
      enabled: true,
      sfxFile: 'pop.mp3',
      sfxName: 'pop',
      volume: 0.85,
      triggerMode: 'per-word',
      delay: 0,
    },
  },
  {
    id: 'tpl-moving-grid-counter',
    name: 'Moving Grid Counter',
    description:
      'Complete black background, moving grid & number counting up with arrival SFX.',
    templateId: 'moving-grid-counter',
    category: 'cinematic-typography',
    defaultDuration: 4.5,
    layers: [
      {
        id: 'l-counter-num',
        name: 'Counter Number Style',
        type: 'text',
        visible: true,
        text: '1,000',
        fontFamily: 'Segoe UI',
        fontWeight: 900,
        fontSize: 96,
        letterSpacing: 2,
        color: '#ffffff',
        x: 0,
        y: -4,
      },
      {
        id: 'l-counter-label',
        name: 'Counter Label',
        type: 'text',
        visible: true,
        text: 'TOTAL REACHED',
        fontFamily: 'Segoe UI',
        fontWeight: 700,
        fontSize: 20,
        letterSpacing: 6,
        color: '#00d4c6',
        x: 0,
        y: 16,
      },
    ],
    visual: {
      ...DEFAULT_VISUAL_STYLE,
      backgroundColor: '#000000',
      backgroundOpacity: 1,
      primaryColor: '#ffffff',
      secondaryColor: '#00d4c6',
      glowIntensity: 0,
      shadowBlur: 0,
    },
    transform: { ...DEFAULT_TRANSFORM },
    animation: {
      ...DEFAULT_ANIMATION,
      entrance: 'fade',
      exit: 'fade',
      loop: 'none',
      entranceDuration: 0.35,
      easing: 'ease-out',
    },
    specific: {
      gridSize: 48,
      gridSpeed: 1,
      gridOpacity: 0.22,
      countFrom: 0,
      countTo: 1000,
      countDuration: 2.4,
      countPrefix: '',
      countSuffix: '',
      countDecimals: 0,
    },
    sfx: {
      enabled: true,
      sfxFile: 'bell.mp3',
      sfxName: 'bell',
      volume: 0.9,
      triggerMode: 'on-target',
      delay: 0,
    },
  },
];

const CUSTOM_PRESETS_KEY = 'dedits_custom_graphic_presets_v1';

export function loadCustomGraphicPresets(): GraphicPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GraphicPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomGraphicPresets(presets: GraphicPreset[]): void {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Ignore quota errors
  }
}

export function createPresetFromClip(
  clip: GraphicClip,
  customName: string
): GraphicPreset {
  return {
    id: uid('gpreset'),
    name: customName.trim() || `${clip.name} Preset`,
    description: `Custom preset based on ${clip.name}`,
    templateId: clip.templateId,
    category: 'my-templates',
    defaultDuration: clip.duration,
    layers: structuredClone(clip.layers),
    visual: structuredClone(clip.visual),
    transform: structuredClone(clip.transform),
    animation: structuredClone(clip.animation),
    specific: structuredClone(clip.specific),
    sfx: clip.sfx ? structuredClone(clip.sfx) : undefined,
    isCustom: true,
    createdAt: Date.now(),
  };
}

export function instantiateGraphicClip(
  preset: GraphicPreset,
  startTime: number,
  trackIndex = 0
): GraphicClip {
  return {
    id: uid('clip'),
    trackType: 'graphics',
    trackIndex,
    name: preset.name,
    startTime: Math.max(0, startTime),
    duration: preset.defaultDuration || 4,
    sourceStart: 0,
    sourceDuration: 600,
    templateId: preset.templateId,
    category: preset.category,
    presetName: preset.name,
    layers: structuredClone(preset.layers).map((l) => ({
      ...l,
      id: uid('layer'),
    })),
    visual: structuredClone(preset.visual),
    transform: structuredClone(preset.transform),
    animation: structuredClone(preset.animation),
    specific: structuredClone(preset.specific),
    sfx: preset.sfx ? structuredClone(preset.sfx) : undefined,
  };
}
