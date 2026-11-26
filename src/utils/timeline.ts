import type { AudioClip, TimelineClip, TrackType } from '../types/editor';
import { clamp, uid } from './time';

export const MIN_CLIP_DURATION = 0.2;

export function getProjectDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 0;
  return clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
}

export function getTrackEndTime(
  clips: TimelineClip[],
  trackType: TrackType,
  trackIndex = 0
): number {
  return clips
    .filter((c) => c.trackType === trackType && (c.trackIndex ?? 0) === trackIndex)
    .reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
}

export function findActiveClipsAtTime<T extends TimelineClip>(
  clips: TimelineClip[],
  trackType: TrackType,
  time: number
): T[] {
  return (
    clips.filter(
      (c) =>
        c.trackType === trackType &&
        time >= c.startTime - 0.0005 &&
        time < c.startTime + c.duration - 0.0005
    ) as T[]
  ).sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
}

export function findActiveClipAtTime<T extends TimelineClip>(
  clips: TimelineClip[],
  trackType: TrackType,
  time: number
): T | undefined {
  return findActiveClipsAtTime<T>(clips, trackType, time)[0];
}

/**
 * Splits a clip at `splitTime` (timeline seconds) into two adjacent clips.
 */
export function splitClipAtTime(clips: TimelineClip[], clipId: string, splitTime: number): TimelineClip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return clips;

  const relative = splitTime - target.startTime;
  if (relative <= MIN_CLIP_DURATION || target.duration - relative <= MIN_CLIP_DURATION) {
    return clips;
  }

  const speed = target.trackType === 'video' ? target.speed : 1;
  const first: TimelineClip = {
    ...target,
    duration: relative,
  };

  const second: TimelineClip = {
    ...target,
    id: uid('clip'),
    startTime: splitTime,
    duration: target.duration - relative,
    sourceStart: target.sourceStart + relative * speed,
  };

  return clips.map((c) => (c.id === clipId ? first : c)).concat(second);
}

/**
 * Q: Split the clip at `splitTime`, delete the portion before `splitTime`,
 * keep the portion after `splitTime`, and ripple subsequent clips on the same track left.
 */
export function rippleDeleteLeftAtTime(
  clips: TimelineClip[],
  clipId: string,
  splitTime: number
): { clips: TimelineClip[]; nextPlayhead: number } | null {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return null;

  const relative = splitTime - target.startTime;
  if (relative <= MIN_CLIP_DURATION || target.duration - relative <= MIN_CLIP_DURATION) {
    return null;
  }

  const speed = target.trackType === 'video' ? target.speed : 1;
  const origEnd = target.startTime + target.duration;

  const updatedClips = clips.map((c) => {
    if (c.id === clipId) {
      return {
        ...c,
        duration: c.duration - relative,
        sourceStart: c.sourceStart + relative * speed,
      };
    }
    if (
      c.trackType === target.trackType &&
      (c.trackIndex ?? 0) === (target.trackIndex ?? 0) &&
      c.startTime >= origEnd - 0.001
    ) {
      return {
        ...c,
        startTime: Math.max(0, c.startTime - relative),
      };
    }
    return c;
  });

  return { clips: updatedClips, nextPlayhead: target.startTime };
}

/**
 * W: Split the clip at `splitTime`, delete the portion after `splitTime`,
 * keep the portion before `splitTime`, and ripple subsequent clips on the same track left.
 */
export function rippleDeleteRightAtTime(
  clips: TimelineClip[],
  clipId: string,
  splitTime: number
): TimelineClip[] | null {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return null;

  const relative = splitTime - target.startTime;
  if (relative <= MIN_CLIP_DURATION || target.duration - relative <= MIN_CLIP_DURATION) {
    return null;
  }

  const removedDuration = target.duration - relative;
  const origEnd = target.startTime + target.duration;

  return clips.map((c) => {
    if (c.id === clipId) {
      return {
        ...c,
        duration: relative,
      };
    }
    if (
      c.trackType === target.trackType &&
      (c.trackIndex ?? 0) === (target.trackIndex ?? 0) &&
      c.startTime >= origEnd - 0.001
    ) {
      return {
        ...c,
        startTime: Math.max(0, c.startTime - removedDuration),
      };
    }
    return c;
  });
}

/**
 * Prevent a moved clip from overlapping other clips on the same track,
 * snapping cleanly to adjacent clip edges or playhead when close.
 */
export function snapTime(
  candidate: number,
  clips: TimelineClip[],
  ignoreClipId: string,
  playhead: number,
  pixelsPerSecond: number
): number {
  const thresholdSec = 8 / pixelsPerSecond;
  const snapPoints = [0, playhead];
  for (const c of clips) {
    if (c.id === ignoreClipId) continue;
    snapPoints.push(c.startTime, c.startTime + c.duration);
  }
  let best = candidate;
  let bestDist = thresholdSec;
  for (const pt of snapPoints) {
    const dist = Math.abs(candidate - pt);
    if (dist < bestDist) {
      bestDist = dist;
      best = pt;
    }
  }
  return Math.max(0, best);
}

export function computeAudioClipGain(clip: AudioClip, time: number): number {
  const localTime = time - clip.startTime;
  if (localTime < 0 || localTime > clip.duration) return 0;

  let factor = 1;
  if (clip.fadeIn > 0 && localTime < clip.fadeIn) {
    factor = Math.min(factor, clamp(localTime / clip.fadeIn, 0, 1));
  }
  if (clip.fadeOut > 0 && clip.duration - localTime < clip.fadeOut) {
    factor = Math.min(factor, clamp((clip.duration - localTime) / clip.fadeOut, 0, 1));
  }
  return clamp(clip.volume * factor, 0, 10);
}
