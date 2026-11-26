import type { GraphicClip } from '../types/editor';

export interface SfxEntry {
  fileName: string;
  name: string;
  url: string;
}

const FALLBACK_SFX: SfxEntry[] = [
  'pop.mp3',
  'whoosh.mp3',
  'bell.mp3',
  'camera sutter.mp3',
  'camera sutter-1.mp3',
  'keyboard.mp3',
  'mouse click.mp3',
  'punch.mp3',
  'reward.mp3',
  'wrong answer.mp3',
].map((fileName) => ({
  fileName,
  name: fileName.replace(/\.[^.]+$/, ''),
  url: `/sfx/${encodeURIComponent(fileName)}`,
}));

let cachedList: SfxEntry[] | null = null;

export async function fetchSfxList(): Promise<SfxEntry[]> {
  if (cachedList && cachedList.length > 0) return cachedList;
  try {
    const res = await fetch('/api/sfx-list');
    if (res.ok) {
      const data = (await res.json()) as { files?: SfxEntry[] };
      if (data.files && data.files.length > 0) {
        cachedList = data.files;
        return cachedList;
      }
    }
  } catch {
    // Fallback below
  }
  return FALLBACK_SFX;
}

const audioBufferCache = new Map<string, AudioBuffer | null>();

export async function loadSfxAudioBuffer(
  ctx: BaseAudioContext,
  sfxFile: string
): Promise<AudioBuffer | null> {
  if (!sfxFile) return null;
  if (audioBufferCache.has(sfxFile)) {
    return audioBufferCache.get(sfxFile) ?? null;
  }
  try {
    const res = await fetch(`/sfx/${encodeURIComponent(sfxFile)}`);
    if (!res.ok) {
      audioBufferCache.set(sfxFile, null);
      return null;
    }
    const arr = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr);
    audioBufferCache.set(sfxFile, decoded);
    return decoded;
  } catch {
    audioBufferCache.set(sfxFile, null);
    return null;
  }
}

export async function playOneShotSfx(
  ctx: AudioContext,
  sfxFile: string,
  volume = 0.85
): Promise<void> {
  const buf = await loadSfxAudioBuffer(ctx, sfxFile);
  if (!buf) return;
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  const source = ctx.createBufferSource();
  source.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(2, volume));
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

/**
 * Computes relative trigger timestamps (seconds from clip.startTime)
 * for a GraphicClip's SFX based on its triggerMode.
 */
export function getGraphicSfxTriggerOffsets(clip: GraphicClip): number[] {
  const sfx = clip.sfx;
  if (!sfx?.enabled || !sfx.sfxFile) return [];
  const baseDelay = Math.max(0, sfx.delay ?? 0);

  if (sfx.triggerMode === 'on-start') {
    return baseDelay < clip.duration ? [baseDelay] : [];
  }

  if (sfx.triggerMode === 'on-target') {
    const arriveAt = baseDelay + Math.max(0.1, clip.specific.countDuration ?? 2.4);
    return arriveAt < clip.duration - 0.02 ? [arriveAt] : [];
  }

  // 'per-word': fire on each word (or each line in line-by-line mode)
  const mainText =
    clip.layers.find((l) => l.type === 'text' && l.visible)?.text ?? '';
  if (!mainText.trim()) return [baseDelay];

  if (clip.specific.popMode === 'line-by-line') {
    const lines = mainText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return [baseDelay];
    const slot = Math.max(0.35, clip.duration / lines.length);
    return lines
      .map((_, i) => baseDelay + i * slot)
      .filter((t) => t < clip.duration - 0.02);
  }

  const words = mainText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const stagger = Math.max(0.06, clip.animation.stagger || 0.28);
  return words
    .map((_, i) => baseDelay + i * stagger)
    .filter((t) => t < clip.duration - 0.02);
}
