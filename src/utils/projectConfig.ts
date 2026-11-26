import type {
  AspectRatioPreset,
  FrameRateOption,
  ProjectSettings,
  ResolutionPreset,
} from '../types/editor';

export const RESOLUTION_PRESETS: Array<{
  id: ResolutionPreset;
  label: string;
  sublabel: string;
  baseShort: number;
  baseWidth: number;
  baseHeight: number;
}> = [
  { id: '360p', label: '360p', sublabel: '640 × 360', baseShort: 360, baseWidth: 640, baseHeight: 360 },
  { id: '480p', label: '480p', sublabel: '854 × 480', baseShort: 480, baseWidth: 854, baseHeight: 480 },
  { id: '720p', label: '720p HD', sublabel: '1280 × 720', baseShort: 720, baseWidth: 1280, baseHeight: 720 },
  { id: '1080p', label: '1080p Full HD', sublabel: '1920 × 1080', baseShort: 1080, baseWidth: 1920, baseHeight: 1080 },
  { id: '1440p', label: '1440p QHD', sublabel: '2560 × 1440', baseShort: 1440, baseWidth: 2560, baseHeight: 1440 },
  { id: '2160p', label: '2160p 4K', sublabel: '3840 × 2160', baseShort: 2160, baseWidth: 3840, baseHeight: 2160 },
  { id: 'custom', label: 'Custom', sublabel: 'User-defined', baseShort: 1080, baseWidth: 1920, baseHeight: 1080 },
];

export const ASPECT_RATIO_PRESETS: Array<{
  id: AspectRatioPreset;
  label: string;
  description: string;
  ratioW: number;
  ratioH: number;
}> = [
  { id: '16:9', label: '16:9', description: 'YouTube / Landscape', ratioW: 16, ratioH: 9 },
  { id: '9:16', label: '9:16', description: 'Shorts / Reels', ratioW: 9, ratioH: 16 },
  { id: '1:1', label: '1:1', description: 'Square', ratioW: 1, ratioH: 1 },
  { id: '4:5', label: '4:5', description: 'Instagram Portrait', ratioW: 4, ratioH: 5 },
  { id: '21:9', label: '21:9', description: 'Cinematic', ratioW: 21, ratioH: 9 },
  { id: 'custom', label: 'Custom', description: 'Free dimensions', ratioW: 16, ratioH: 9 },
];

export const FRAME_RATES: FrameRateOption[] = [24, 25, 30, 50, 60];

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  resolutionPreset: '1080p',
  aspectRatioPreset: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  locationLabel: 'Documents\\CutLite Projects',
  previewBackground: 'black',
  previewBackgroundColor: '#000000',
};

function makeEven(n: number): number {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function computeDimensions(
  res: ResolutionPreset,
  ar: AspectRatioPreset,
  currentWidth = 1920,
  currentHeight = 1080
): { width: number; height: number } {
  if (res === 'custom' || ar === 'custom') {
    return {
      width: Math.max(128, Math.min(7680, makeEven(currentWidth))),
      height: Math.max(128, Math.min(7680, makeEven(currentHeight))),
    };
  }

  const resMeta = RESOLUTION_PRESETS.find((r) => r.id === res) ?? RESOLUTION_PRESETS[3];
  const arMeta = ASPECT_RATIO_PRESETS.find((a) => a.id === ar) ?? ASPECT_RATIO_PRESETS[0];

  if (ar === '16:9') {
    return { width: resMeta.baseWidth, height: resMeta.baseHeight };
  }

  const shortSide = resMeta.baseShort;
  if (arMeta.ratioW >= arMeta.ratioH) {
    const height = shortSide;
    const width = makeEven((shortSide * arMeta.ratioW) / arMeta.ratioH);
    return { width, height };
  } else {
    const width = shortSide;
    const height = makeEven((shortSide * arMeta.ratioH) / arMeta.ratioW);
    return { width, height };
  }
}

export function formatAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '16:9';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(Math.round(width), Math.round(height));
  const rw = Math.round(width) / d;
  const rh = Math.round(height) / d;
  if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
  return `${(width / height).toFixed(2)}:1`;
}
