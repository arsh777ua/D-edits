import type {
  AudioClip,
  MediaAsset,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import { clamp, uid } from './time';
import { MIN_CLIP_DURATION } from './timeline';

export interface SilenceRemovalOptions {
  thresholdDb: number; // e.g. -35 (-60 to -10)
  minSilenceSec: number; // e.g. 0.35 (0.1 to 2.0)
  paddingSec: number; // e.g. 0.08 (0 to 0.3)
  rippleCloseGaps: boolean;
}

export interface ActiveAudioSegment {
  /** Timeline-relative start (seconds from clip.startTime) */
  start: number;
  /** Timeline-relative end (seconds from clip.startTime) */
  end: number;
}

export interface SilenceAnalysisResult {
  segments: ActiveAudioSegment[];
  originalDuration: number;
  keptDuration: number;
  removedSeconds: number;
}

const decodedBufferCache = new Map<string, AudioBuffer>();

export async function decodeAssetAudioBuffer(
  asset: MediaAsset
): Promise<AudioBuffer> {
  const cached = decodedBufferCache.get(asset.id);
  if (cached) return cached;

  const arrBuf = await asset.file.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrBuf);
    decodedBufferCache.set(asset.id, decoded);
    return decoded;
  } finally {
    await ctx.close().catch(() => {});
  }
}

export function detectActiveSegments(
  audioBuffer: AudioBuffer,
  clip: VideoClip | AudioClip,
  options: SilenceRemovalOptions
): SilenceAnalysisResult {
  const speed = clip.trackType === 'video' ? clip.speed : 1;
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const windowTimelineSec = 0.02; // 20ms analysis window
  const windowSourceSec = windowTimelineSec * speed;
  const windowSamples = Math.max(1, Math.floor(windowSourceSec * sampleRate));

  const thresholdLinear = Math.pow(10, options.thresholdDb / 20);
  const clipDur = clip.duration;
  const numWindows = Math.max(1, Math.ceil(clipDur / windowTimelineSec));

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  // 1. Classify each 20ms window as active (above threshold) or silent
  const isActive = new Uint8Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const srcTime = clip.sourceStart + w * windowSourceSec;
    const startIdx = Math.floor(srcTime * sampleRate);
    if (startIdx >= audioBuffer.length) break;
    const endIdx = Math.min(audioBuffer.length, startIdx + windowSamples);
    const count = endIdx - startIdx;
    if (count <= 0) continue;

    let sumSq = 0;
    let totalSamples = 0;
    // Stride by 2 for fast scanning on high sample rates
    const step = count > 256 ? 2 : 1;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = channels[ch];
      for (let i = startIdx; i < endIdx; i += step) {
        const v = data[i];
        sumSq += v * v;
        totalSamples++;
      }
    }
    const rms = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;
    if (rms >= thresholdLinear) {
      isActive[w] = 1;
    }
  }

  // 2. Bridge short silent gaps (< minSilenceSec)
  const minSilenceWindows = Math.max(
    1,
    Math.round(options.minSilenceSec / windowTimelineSec)
  );
  let i = 0;
  while (i < numWindows) {
    if (isActive[i] === 0) {
      let j = i;
      while (j < numWindows && isActive[j] === 0) j++;
      const gapLen = j - i;
      const hasBefore = i > 0;
      const hasAfter = j < numWindows;
      if (hasBefore && hasAfter && gapLen < minSilenceWindows) {
        for (let k = i; k < j; k++) isActive[k] = 1;
      }
      i = j;
    } else {
      i++;
    }
  }

  // 3. Extract raw active intervals + apply padding + merge overlaps
  const rawSegments: ActiveAudioSegment[] = [];
  let idx = 0;
  while (idx < numWindows) {
    if (isActive[idx] === 1) {
      let endIdx = idx;
      while (endIdx < numWindows && isActive[endIdx] === 1) endIdx++;
      const s = clamp(idx * windowTimelineSec - options.paddingSec, 0, clipDur);
      const e = clamp(
        endIdx * windowTimelineSec + options.paddingSec,
        0,
        clipDur
      );
      if (e - s >= MIN_CLIP_DURATION) {
        if (
          rawSegments.length > 0 &&
          s <= rawSegments[rawSegments.length - 1].end + 0.02
        ) {
          rawSegments[rawSegments.length - 1].end = Math.max(
            rawSegments[rawSegments.length - 1].end,
            e
          );
        } else {
          rawSegments.push({ start: s, end: e });
        }
      }
      idx = endIdx;
    } else {
      idx++;
    }
  }

  const keptDuration = rawSegments.reduce((acc, s) => acc + (s.end - s.start), 0);
  const removedSeconds = Math.max(0, clipDur - keptDuration);

  return {
    segments: rawSegments,
    originalDuration: clipDur,
    keptDuration,
    removedSeconds,
  };
}

export function buildClipsFromActiveSegments(
  clip: VideoClip | AudioClip,
  segments: ActiveAudioSegment[],
  rippleCloseGaps: boolean
): TimelineClip[] {
  if (segments.length === 0) return [];
  const speed = clip.trackType === 'video' ? clip.speed : 1;
  let cursor = clip.startTime;

  return segments.map((seg) => {
    const dur = seg.end - seg.start;
    const startTime = rippleCloseGaps ? cursor : clip.startTime + seg.start;
    cursor += dur;
    return {
      ...clip,
      id: uid('clip'),
      startTime,
      duration: dur,
      sourceStart: clip.sourceStart + seg.start * speed,
    };
  });
}
