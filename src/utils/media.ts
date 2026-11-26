import type { MediaAsset, MediaType } from '../types/editor';
import { transcodeToH264 } from './exporter';
import { uid } from './time';

const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac']);

export function detectMediaType(file: File): MediaType | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

function loadImageMeta(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

function loadVideoMeta(
  url: string
): Promise<{ duration: number; width: number; height: number; thumbnailUrl?: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const cleanup = () => {
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      window.clearTimeout(timer);
    };

    const captureFrame = () => {
      if (settled) return;
      settled = true;
      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 5;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      let thumbnailUrl: string | undefined;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          const canvas = document.createElement('canvas');
          const thumbW = 320;
          const thumbH = Math.round((height / width) * thumbW) || 180;
          canvas.width = thumbW;
          canvas.height = thumbH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, thumbW, thumbH);
            thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
          }
        } catch {
          // ignore canvas taint errors
        }
      }
      cleanup();
      resolve({ duration, width, height, thumbnailUrl });
    };

    const timer = window.setTimeout(() => {
      captureFrame();
    }, 3000);

    video.onloadeddata = () => {
      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 5;
      const targetTime = Math.min(0.25, duration * 0.1);
      if (targetTime <= 0.02) {
        captureFrame();
      } else {
        video.onseeked = () => {
          // Give the compositor one frame to paint the decoded seek target
          requestAnimationFrame(() => captureFrame());
        };
        video.currentTime = targetTime;
      }
    };

    video.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Unsupported video format'));
    };

    video.src = url;
    video.load();
  });
}

function loadAudioMeta(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 10;
      resolve({ duration });
    };
    audio.onerror = () => reject(new Error('Unsupported audio format'));
    audio.src = url;
  });
}

export async function createMediaAsset(
  file: File,
  onTranscodeProgress?: (message: string) => void
): Promise<MediaAsset | null> {
  const type = detectMediaType(file);
  if (!type) return null;

  let workingFile = file;
  let url = URL.createObjectURL(workingFile);

  try {
    if (type === 'image') {
      const meta = await loadImageMeta(url);
      return {
        id: uid('media'),
        name: file.name,
        type,
        file: workingFile,
        url,
        duration: 5,
        width: meta.width,
        height: meta.height,
        thumbnailUrl: url,
        mimeType: file.type || 'image/png',
      };
    }

    if (type === 'video') {
      let meta: {
        duration: number;
        width: number;
        height: number;
        thumbnailUrl?: string;
      } | null = null;

      try {
        meta = await loadVideoMeta(url);
      } catch {
        meta = null;
      }

      // If browser couldn't decode the video stream (e.g. HEVC/H.265), transcode locally to H.264
      if (!meta || !meta.thumbnailUrl) {
        URL.revokeObjectURL(url);
        onTranscodeProgress?.(`Converting ${file.name} for browser preview (0%)...`);
        workingFile = await transcodeToH264(file, (pct) => {
          onTranscodeProgress?.(`Converting ${file.name} for browser preview (${pct}%)...`);
        });
        url = URL.createObjectURL(workingFile);
        meta = await loadVideoMeta(url);
      }

      return {
        id: uid('media'),
        name: file.name,
        type,
        file: workingFile,
        url,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        thumbnailUrl: meta.thumbnailUrl,
        mimeType: workingFile.type || 'video/mp4',
      };
    }

    const meta = await loadAudioMeta(url);
    return {
      id: uid('media'),
      name: file.name,
      type,
      file: workingFile,
      url,
      duration: meta.duration,
      mimeType: file.type || 'audio/mpeg',
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}
