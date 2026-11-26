import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type {
  AudioClip,
  ExportProgress,
  ExportSettings,
  GraphicClip,
  MediaAsset,
  TextClip,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import { evaluateCaptionAnimation } from './captions';
import {
  renderGraphicToCanvas,
  type MediaElementSource,
} from './graphicsRenderer';
import {
  getGraphicSfxTriggerOffsets,
  loadSfxAudioBuffer,
} from './sfx';
import {
  computeAudioClipGain,
  findActiveClipsAtTime,
  getProjectDuration,
} from './timeline';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } catch (err) {
    ffmpegLoadPromise = null;
    throw err;
  }
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = reject;
    v.src = url;
  });
}

function drawOverlaysToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  clips: TimelineClip[],
  videoElements?: Map<string, HTMLVideoElement>,
  imageElements?: Map<string, HTMLImageElement>
) {
  // Creative Graphics Overlay Layers
  const gClips = findActiveClipsAtTime<GraphicClip>(clips, 'graphics', time);
  if (gClips.length > 0) {
    const mediaSources = new Map<string, MediaElementSource>();
    if (videoElements) {
      for (const [id, ve] of videoElements) mediaSources.set(id, ve);
    }
    if (imageElements) {
      for (const [id, ie] of imageElements) mediaSources.set(id, ie);
    }
    for (const gClip of gClips) {
      renderGraphicToCanvas({
        ctx,
        width,
        height,
        time,
        clip: gClip,
        mediaSources,
        backdropCanvas: ctx.canvas,
      });
    }
  }

  // Text & Caption overlays (multilayer + animated templates)
  const tClips = [
    ...findActiveClipsAtTime<TextClip>(clips, 'text', time),
    ...findActiveClipsAtTime<TextClip>(clips, 'captions', time),
  ];
  for (const tClip of tClips) {
    if (!tClip.text) continue;
    const anim = evaluateCaptionAnimation(tClip, time);
    ctx.save();
    const resScale = height / 720;
    const scaledFontSize = tClip.fontSize * resScale;
    const weight = tClip.bold === false ? 400 : 700;
    ctx.font = `${weight} ${scaledFontSize}px ${tClip.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = anim.opacity;

    const tx = width / 2 + (tClip.x / 100) * width;
    const ty =
      height / 2 + (tClip.y / 100) * height + anim.translateY * resScale;

    ctx.translate(tx, ty);
    ctx.scale(anim.scale, anim.scale);

    const lines = tClip.text.split('\n');
    const lineHeight = scaledFontSize * 1.25;
    const maxLineW = Math.max(
      ...lines.map((l) => ctx.measureText(l).width),
      scaledFontSize
    );
    const totalH = lines.length * lineHeight;

    // Optional background pill
    const bgAlpha = tClip.bgOpacity ?? (anim.hasBackground ? 0.78 : 0);
    if (bgAlpha > 0) {
      const clean = (tClip.bgColor ?? '#000000').replace('#', '');
      const r = parseInt(clean.slice(0, 2) || '00', 16);
      const g = parseInt(clean.slice(2, 4) || '00', 16);
      const b = parseInt(clean.slice(4, 6) || '00', 16);
      const padX = 16 * resScale;
      const padY = 8 * resScale;
      const boxW = maxLineW + padX * 2;
      const boxH = totalH + padY * 2;
      const rad = 10 * resScale;

      ctx.save();
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bgAlpha})`;
      ctx.beginPath();
      ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, rad);
      ctx.fill();
      ctx.restore();
    }

    const shadowBlur = (tClip.shadowBlur ?? 6) * resScale;
    if (anim.isNeon) {
      ctx.shadowColor = tClip.color;
      ctx.shadowBlur = 18 * resScale;
    } else if (shadowBlur > 0) {
      ctx.shadowColor = tClip.shadowColor ?? 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetY = 2 * resScale;
    }

    const outlineW = (tClip.outlineWidth ?? 0) * resScale;
    if (outlineW > 0) {
      ctx.lineWidth = outlineW * 2;
      ctx.strokeStyle = tClip.outlineColor ?? '#000000';
      ctx.lineJoin = 'round';
    }

    const startY = -((lines.length - 1) * lineHeight) / 2;

    if (anim.isHighlightTemplate) {
      const tokens = tClip.text.trim().split(/\s+/).filter(Boolean);
      const spaceW = ctx.measureText(' ').width;
      const widths = tokens.map((tok) => ctx.measureText(tok).width);
      const totalLineW =
        widths.reduce((a, b) => a + b, 0) +
        Math.max(0, tokens.length - 1) * spaceW;
      let cursorX = -totalLineW / 2;
      const highlightCol = tClip.highlightColor ?? '#fde047';

      tokens.forEach((tok, idx) => {
        const w = widths[idx];
        const isActive = idx === anim.activeWordIndex;
        const isFuture = anim.isSequentialReveal && idx > anim.activeWordIndex;
        ctx.save();
        ctx.globalAlpha = anim.opacity * (isFuture ? 0.18 : 1);
        ctx.fillStyle = isActive ? highlightCol : tClip.color;
        const cx = cursorX + w / 2;
        if (outlineW > 0) ctx.strokeText(tok, cx, 0);
        ctx.fillText(tok, cx, 0);
        ctx.restore();
        cursorX += w + spaceW;
      });
    } else {
      ctx.fillStyle = tClip.color;
      lines.forEach((line, idx) => {
        const ly = startY + idx * lineHeight;
        if (outlineW > 0) ctx.strokeText(line, 0, ly);
        ctx.fillText(line, 0, ly);
      });
    }
    ctx.restore();
  }
}

function drawFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  clips: TimelineClip[],
  videoElements: Map<string, HTMLVideoElement>,
  imageElements: Map<string, HTMLImageElement>,
  syncVideoForPlayback: boolean
) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const vClips = findActiveClipsAtTime<VideoClip>(clips, 'video', time);
  for (const vClip of vClips) {
    let sourceEl: HTMLVideoElement | HTMLImageElement | undefined;
    let srcW = width;
    let srcH = height;

    if (vClip.mediaType === 'video') {
      const ve = videoElements.get(vClip.mediaId);
      if (ve) {
        const expectedTime =
          vClip.sourceStart + (time - vClip.startTime) * vClip.speed;
        if (syncVideoForPlayback) {
          ve.playbackRate = vClip.speed;
          if (!ve.seeking && Math.abs(ve.currentTime - expectedTime) > 0.14) {
            ve.currentTime = Math.max(0, expectedTime);
          }
          if (ve.paused && ve.readyState >= 2) {
            ve.play().catch(() => {});
          }
        }
        sourceEl = ve;
        srcW = ve.videoWidth || width;
        srcH = ve.videoHeight || height;
      }
    } else {
      const ie = imageElements.get(vClip.mediaId);
      if (ie) {
        sourceEl = ie;
        srcW = ie.naturalWidth || width;
        srcH = ie.naturalHeight || height;
      }
    }

    if (sourceEl) {
      ctx.save();
      if (vClip.brightness !== 1 || vClip.contrast !== 1) {
        ctx.filter = `brightness(${vClip.brightness}) contrast(${vClip.contrast})`;
      }

      const fitScale = Math.min(width / srcW, height / srcH);
      const drawW = srcW * fitScale;
      const drawH = srcH * fitScale;

      ctx.translate(
        width / 2 + (vClip.x / 100) * width,
        height / 2 + (vClip.y / 100) * height
      );
      ctx.rotate((vClip.rotate * Math.PI) / 180);
      ctx.scale(vClip.scale, vClip.scale);

      const cropL = (vClip.cropLeft / 100) * drawW;
      const cropR = (vClip.cropRight / 100) * drawW;
      const cropT = (vClip.cropTop / 100) * drawH;
      const cropB = (vClip.cropBottom / 100) * drawH;

      if (cropL > 0 || cropR > 0 || cropT > 0 || cropB > 0) {
        ctx.beginPath();
        ctx.rect(
          -drawW / 2 + cropL,
          -drawH / 2 + cropT,
          Math.max(1, drawW - cropL - cropR),
          Math.max(1, drawH - cropT - cropB)
        );
        ctx.clip();
      }

      ctx.drawImage(sourceEl, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }

  // Pause inactive videos
  if (syncVideoForPlayback) {
    const activeIds = new Set(vClips.map((c) => c.mediaId));
    for (const [id, ve] of videoElements) {
      if (!activeIds.has(id) && !ve.paused) {
        ve.pause();
      }
    }
  }

  drawOverlaysToCanvas(ctx, width, height, time, clips, videoElements, imageElements);
}

function pickSupportedRecorderMime(): { mimeType: string; isMp4: boolean; isH264: boolean } | null {
  if (typeof MediaRecorder === 'undefined') return null;

  const candidates = [
    // Prefer High Profile H.264 MP4 for crisp quality without Baseline blockiness
    { mimeType: 'video/mp4;codecs=avc1.640032,mp4a.40.2', isMp4: true, isH264: true },
    { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', isMp4: true, isH264: true },
    { mimeType: 'video/mp4;codecs=avc1.4D4028,mp4a.40.2', isMp4: true, isH264: true },
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', isMp4: true, isH264: true },
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', isMp4: true, isH264: true },
    { mimeType: 'video/mp4', isMp4: true, isH264: true },
    { mimeType: 'video/webm;codecs=h264,opus', isMp4: false, isH264: true },
    { mimeType: 'video/webm;codecs=vp9,opus', isMp4: false, isH264: false },
    { mimeType: 'video/webm', isMp4: false, isH264: false },
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return null;
}

function getTargetBitrates(
  width: number,
  height: number,
  fps: number,
  quality: ExportSettings['quality'],
  customBitrateMbps?: number
): { videoBps: number; audioBps: number } {
  if (customBitrateMbps && customBitrateMbps > 0) {
    return {
      videoBps: Math.round(customBitrateMbps * 1_000_000),
      audioBps: 320_000,
    };
  }
  const pixels = width * height;
  const resScale = pixels / (1920 * 1080); // 1.0 for 1080p, 4.0 for 4K
  const fpsScale = fps >= 50 ? 1.35 : 1.0;

  const baseMbps =
    quality === 'ultra' ? 60 : quality === 'high' ? 35 : 16;
  const videoBps = Math.round(
    Math.max(8_000_000, baseMbps * 1_000_000 * resScale * fpsScale)
  );
  const audioBps = quality === 'standard' ? 192_000 : 320_000;
  return { videoBps, audioBps };
}

/**
 * Schedules all timeline audio into a live AudioContext destination node
 * for real-time MediaRecorder capture.
 */
async function scheduleLiveAudio(
  audioCtx: AudioContext,
  dest: MediaStreamAudioDestinationNode,
  clips: TimelineClip[],
  assetMap: Map<string, MediaAsset>,
  baseTime: number
): Promise<boolean> {
  const audioSources = clips.filter(
    (c) =>
      (c.trackType === 'audio' && c.volume > 0) ||
      (c.trackType === 'video' && c.mediaType === 'video' && c.volume > 0)
  );
  if (audioSources.length === 0) return false;

  const decodedCache = new Map<string, AudioBuffer | null>();
  let hasAnyAudio = false;

  for (const clip of audioSources) {
    const mediaId = 'mediaId' in clip ? clip.mediaId : '';
    const asset = assetMap.get(mediaId);
    if (!asset) continue;

    let audioBuffer = decodedCache.get(asset.id);
    if (audioBuffer === undefined) {
      try {
        const arrBuf = await asset.file.arrayBuffer();
        audioBuffer = await audioCtx.decodeAudioData(arrBuf);
      } catch {
        audioBuffer = null;
      }
      decodedCache.set(asset.id, audioBuffer);
    }
    if (!audioBuffer) continue;

    hasAnyAudio = true;
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    const speed = clip.trackType === 'video' ? clip.speed : 1;
    source.playbackRate.value = speed;

    const gainNode = audioCtx.createGain();
    const start = baseTime + clip.startTime;
    const end = start + clip.duration;

    if (clip.trackType === 'audio') {
      const aClip = clip as AudioClip;
      gainNode.gain.setValueAtTime(
        aClip.fadeIn > 0 ? 0.0001 : aClip.volume,
        start
      );
      if (aClip.fadeIn > 0) {
        gainNode.gain.linearRampToValueAtTime(
          aClip.volume,
          Math.min(end, start + aClip.fadeIn)
        );
      }
      if (aClip.fadeOut > 0) {
        const fadeOutStart = Math.max(start, end - aClip.fadeOut);
        gainNode.gain.setValueAtTime(aClip.volume, fadeOutStart);
        gainNode.gain.linearRampToValueAtTime(0.0001, end);
      }
    } else {
      gainNode.gain.setValueAtTime((clip as VideoClip).volume, start);
    }

    source.connect(gainNode);
    gainNode.connect(dest);
    source.start(start, clip.sourceStart, clip.duration * speed);
  }

  // Also schedule SFX from GraphicClips
  const graphicSfxClips = clips.filter(
    (c): c is GraphicClip =>
      c.trackType === 'graphics' && Boolean(c.sfx?.enabled && c.sfx.sfxFile)
  );
  for (const gClip of graphicSfxClips) {
    if (!gClip.sfx) continue;
    const buf = await loadSfxAudioBuffer(audioCtx, gClip.sfx.sfxFile);
    if (!buf) continue;
    const offsets = getGraphicSfxTriggerOffsets(gClip);
    for (const off of offsets) {
      hasAnyAudio = true;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(
        Math.max(0, Math.min(2, gClip.sfx.volume)),
        baseTime + gClip.startTime + off
      );
      src.connect(gainNode);
      gainNode.connect(dest);
      src.start(baseTime + gClip.startTime + off);
    }
  }

  return hasAnyAudio;
}

async function seekVideoElement(
  video: HTMLVideoElement,
  t: number
): Promise<void> {
  const target = Math.max(0, t);
  if (Math.abs(video.currentTime - target) < 0.005) return;
  await new Promise<void>((resolve) => {
    const onSeeked = () => resolve();
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
  });
}

async function renderMixedAudioBuffer(
  clips: TimelineClip[],
  assetMap: Map<string, MediaAsset>,
  duration: number
): Promise<AudioBuffer | null> {
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(duration * sampleRate)),
    sampleRate
  );
  const hasOfflineAudio = await scheduleLiveAudio(
    offlineCtx as unknown as AudioContext,
    offlineCtx.destination as unknown as MediaStreamAudioDestinationNode,
    clips,
    assetMap,
    0
  );
  if (!hasOfflineAudio) return null;
  return offlineCtx.startRendering();
}

function audioBufferToWavBytes(renderedAudio: AudioBuffer): Uint8Array {
  const sampleRate = renderedAudio.sampleRate;
  const numCh = renderedAudio.numberOfChannels;
  const len = renderedAudio.length * numCh * 2;
  const wav = new ArrayBuffer(44 + len);
  const view = new DataView(wav);
  const writeStr = (off: number, s: string) => {
    for (let k = 0; k < s.length; k++) view.setUint8(off + k, s.charCodeAt(k));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, len, true);

  const pcm = new Int16Array(wav, 44);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    chans.push(renderedAudio.getChannelData(c));
  }
  let pIdx = 0;
  for (let i = 0; i < renderedAudio.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = chans[c][i];
      const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
      pcm[pIdx++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
  }
  return new Uint8Array(wav);
}

async function renderMixedAudioWav(
  clips: TimelineClip[],
  assetMap: Map<string, MediaAsset>,
  duration: number
): Promise<Uint8Array | null> {
  const renderedAudio = await renderMixedAudioBuffer(clips, assetMap, duration);
  if (!renderedAudio) return null;
  return audioBufferToWavBytes(renderedAudio);
}

async function pickWebCodecsH264Config(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  annexb = false
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }
  const codecs = ['avc1.640033', 'avc1.64002a', 'avc1.4d002a', 'avc1.42001f'];
  for (const codec of codecs) {
    const cfg: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      bitrateMode: 'variable',
      ...(annexb ? { avc: { format: 'annexb' } } : {}),
    } as VideoEncoderConfig;
    try {
      const support = await VideoEncoder.isConfigSupported(cfg);
      if (support.supported) return cfg;
    } catch {
      // Try next codec
    }
  }
  return null;
}

async function isAacAudioEncoderSupported(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return false;
  }
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitrate: 256_000,
    });
    return Boolean(support.supported);
  } catch {
    return false;
  }
}

export async function exportProjectToMp4(
  clips: TimelineClip[],
  mediaAssets: MediaAsset[],
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const duration = getProjectDuration(clips);
  if (duration <= 0) {
    throw new Error('Timeline is empty.');
  }

  const rawW =
    settings.width ?? (settings.resolution === '1080p' ? 1920 : 1280);
  const rawH =
    settings.height ?? (settings.resolution === '1080p' ? 1080 : 720);
  const width = rawW & ~1;
  const height = rawH & ~1;
  const fps = settings.fps;

  const assetMap = new Map<string, MediaAsset>();
  for (const a of mediaAssets) assetMap.set(a.id, a);

  onProgress({
    status: 'preparing',
    progress: 5,
    message: 'Preparing media assets...',
  });

  // 0. Try Native Out-of-Browser FFmpeg Backend (GPU NVENC / QSV / AMF / CPU x264)
  try {
    const statusRes = await fetch('/api/native-export/status');
    if (statusRes.ok) {
      const statusData = (await statusRes.json()) as {
        available?: boolean;
        encoder?: { codec: string; label: string };
      };
      // Render ALL timelines (video, audio, captions, text, graphics) 100% outside the browser in Native FFmpeg!
      if (statusData.available) {
        const encLabel = statusData.encoder?.label || 'Native FFmpeg';
        onProgress({
          status: 'preparing',
          progress: 8,
          message: `Syncing media to ${encLabel}...`,
        });

        const mediaIdsUsed = new Set(
          clips
            .filter(
              (c): c is VideoClip | AudioClip =>
                c.trackType === 'video' || c.trackType === 'audio'
            )
            .map((c) => c.mediaId)
        );
        for (const assetId of mediaIdsUsed) {
          if (abortSignal?.aborted) throw new Error('Export cancelled');
          const asset = assetMap.get(assetId);
          if (!asset) continue;
          const existsRes = await fetch(
            `/api/native-export/has-asset/${encodeURIComponent(asset.id)}`
          );
          const existsData = (await existsRes.json()) as { exists?: boolean };
          if (!existsData.exists) {
            const ext = asset.name.split('.').pop() || 'mp4';
            await fetch(
              `/api/native-export/upload-asset/${encodeURIComponent(asset.id)}__ext__${encodeURIComponent(ext)}`,
              {
                method: 'POST',
                body: asset.file,
              }
            );
          }
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const startRes = await fetch('/api/native-export/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            width,
            height,
            fps,
            duration,
            quality: settings.quality,
            customBitrateMbps: settings.customBitrateMbps,
            clips,
          }),
        });
        if (!startRes.ok) {
          throw new Error('Failed to start native FFmpeg job');
        }

        while (true) {
          if (abortSignal?.aborted) throw new Error('Export cancelled');
          await new Promise((r) => setTimeout(r, 250));
          const progRes = await fetch(
            `/api/native-export/progress/${encodeURIComponent(jobId)}`
          );
          if (!progRes.ok) throw new Error('Lost connection to native export job');
          const prog = (await progRes.json()) as {
            status: string;
            progress: number;
            message: string;
            error?: string;
          };
          if (prog.status === 'error') {
            throw new Error(prog.error || 'Native FFmpeg render error');
          }
          onProgress({
            status: prog.status === 'done' ? 'encoding' : 'rendering',
            progress: Math.min(98, prog.progress),
            message: prog.message,
          });
          if (prog.status === 'done') break;
        }

        const dlRes = await fetch(
          `/api/native-export/download/${encodeURIComponent(jobId)}`
        );
        if (!dlRes.ok) throw new Error('Failed to download rendered MP4');
        const outBlob = await dlRes.blob();
        const outUrl = URL.createObjectURL(outBlob);
        onProgress({
          status: 'done',
          progress: 100,
          message: `Export complete (${encLabel})!`,
          outputUrl: outUrl,
        });
        return outUrl;
      }
    }
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    // Fall back seamlessly to GPU WebCodecs + mp4-muxer if native backend unavailable
  }

  const videoElements = new Map<string, HTMLVideoElement>();
  const imageElements = new Map<string, HTMLImageElement>();

  for (const clip of clips) {
    if (clip.trackType === 'video') {
      const asset = assetMap.get(clip.mediaId);
      if (!asset) continue;
      if (clip.mediaType === 'video' && !videoElements.has(asset.id)) {
        videoElements.set(asset.id, await loadVideoElement(asset.url));
      } else if (clip.mediaType === 'image' && !imageElements.has(asset.id)) {
        imageElements.set(asset.id, await loadImageElement(asset.url));
      }
    } else if (clip.trackType === 'graphics') {
      for (const layer of clip.layers) {
        if (!layer.mediaId) continue;
        const asset = assetMap.get(layer.mediaId);
        if (!asset) continue;
        if (asset.type === 'video' && !videoElements.has(asset.id)) {
          videoElements.set(asset.id, await loadVideoElement(asset.url));
        } else if (asset.type === 'image' && !imageElements.has(asset.id)) {
          imageElements.set(asset.id, await loadImageElement(asset.url));
        }
      }
    }
  }

  if (abortSignal?.aborted) throw new Error('Export cancelled');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // GPU WebCodecs VideoEncoder path (works even when AudioEncoder AAC is unsupported by muxing audio via Native FFmpeg)
  {
    const { videoBps } = getTargetBitrates(
      width,
      height,
      fps,
      settings.quality,
      settings.customBitrateMbps
    );
    const aacOk = await isAacAudioEncoderSupported();
    const wcConfig = await pickWebCodecsH264Config(
      width,
      height,
      fps,
      videoBps,
      !aacOk
    );
    if (wcConfig) {
      const totalFrames = Math.max(1, Math.ceil(duration * fps));
      onProgress({
        status: 'preparing',
        progress: 8,
        message: 'Initializing GPU WebCodecs H.264 encoder...',
      });

      const audioBuf = await renderMixedAudioBuffer(clips, assetMap, duration);
      const hasAudioTrack = Boolean(audioBuf && audioBuf.length > 0);

      if (aacOk) {
        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: { codec: 'avc', width, height },
          audio: hasAudioTrack
            ? { codec: 'aac', numberOfChannels: 2, sampleRate: 44100 }
            : undefined,
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        });

        let encodeError: Error | null = null;
        const vEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (err) => {
            encodeError = err instanceof Error ? err : new Error(String(err));
          },
        });
        vEncoder.configure(wcConfig);

        const frameDurationUs = Math.round(1_000_000 / fps);
        const keyInterval = Math.max(15, fps * 2);

        for (let i = 0; i < totalFrames; i++) {
          if (abortSignal?.aborted) {
            vEncoder.close();
            throw new Error('Export cancelled');
          }
          if (encodeError) {
            vEncoder.close();
            throw encodeError;
          }
          const time = i / fps;
          const activeV = findActiveClipsAtTime<VideoClip>(clips, 'video', time);
          if (activeV.length > 0) {
            await Promise.all(
              activeV.map((vClip) => {
                if (vClip.mediaType !== 'video') return Promise.resolve();
                const ve = videoElements.get(vClip.mediaId);
                if (!ve) return Promise.resolve();
                return seekVideoElement(
                  ve,
                  vClip.sourceStart + (time - vClip.startTime) * vClip.speed
                );
              })
            );
          }
          drawFrameToCanvas(
            ctx,
            width,
            height,
            time,
            clips,
            videoElements,
            imageElements,
            false
          );

          const vf = new VideoFrame(canvas, {
            timestamp: i * frameDurationUs,
            duration: frameDurationUs,
          });
          vEncoder.encode(vf, { keyFrame: i % keyInterval === 0 });
          vf.close();

          if (vEncoder.encodeQueueSize > 32) {
            await vEncoder.flush();
          }

          if (i % 10 === 0 || i === totalFrames - 1) {
            onProgress({
              status: 'rendering',
              progress: 10 + Math.round(((i + 1) / totalFrames) * 75),
              message: `GPU encoding frame ${i + 1}/${totalFrames}...`,
            });
          }
        }

        await vEncoder.flush();
        vEncoder.close();

        if (hasAudioTrack && audioBuf) {
          onProgress({
            status: 'encoding',
            progress: 88,
            message: 'Encoding AAC audio & finalizing MP4...',
          });
          const aEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (err) => {
              encodeError = err instanceof Error ? err : new Error(String(err));
            },
          });
          aEncoder.configure({
            codec: 'mp4a.40.2',
            sampleRate: 44100,
            numberOfChannels: 2,
            bitrate: 256_000,
          });

          const ch0 = audioBuf.getChannelData(0);
          const ch1 =
            audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : ch0;
          const totalSamples = audioBuf.length;
          const chunkFrames = 1024;

          for (let off = 0; off < totalSamples; off += chunkFrames) {
            const count = Math.min(chunkFrames, totalSamples - off);
            const planar = new Float32Array(count * 2);
            planar.set(ch0.subarray(off, off + count), 0);
            planar.set(ch1.subarray(off, off + count), count);
            const audioData = new AudioData({
              format: 'f32-planar',
              sampleRate: 44100,
              numberOfFrames: count,
              numberOfChannels: 2,
              timestamp: Math.round((off / 44100) * 1_000_000),
              data: planar,
            });
            aEncoder.encode(audioData);
            audioData.close();
          }

          await aEncoder.flush();
          aEncoder.close();
        }

        muxer.finalize();
        const outUrl = URL.createObjectURL(
          new Blob([target.buffer], { type: 'video/mp4' })
        );

        onProgress({
          status: 'done',
          progress: 100,
          message: 'Export complete!',
          outputUrl: outUrl,
        });
        return outUrl;
      }

      // AudioEncoder AAC not supported (common on Windows Chromium): encode video on GPU WebCodecs + mux audio via Native FFmpeg!
      const h264Chunks: Uint8Array[] = [];
      let encodeError: Error | null = null;
      const vEncoder = new VideoEncoder({
        output: (chunk) => {
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          h264Chunks.push(buf);
        },
        error: (err) => {
          encodeError = err instanceof Error ? err : new Error(String(err));
        },
      });
      vEncoder.configure(wcConfig);

      const frameDurationUs = Math.round(1_000_000 / fps);
      const keyInterval = Math.max(15, fps * 2);

      for (let i = 0; i < totalFrames; i++) {
        if (abortSignal?.aborted) {
          vEncoder.close();
          throw new Error('Export cancelled');
        }
        if (encodeError) {
          vEncoder.close();
          throw encodeError;
        }
        const time = i / fps;
        const activeV = findActiveClipsAtTime<VideoClip>(clips, 'video', time);
        if (activeV.length > 0) {
          await Promise.all(
            activeV.map((vClip) => {
              if (vClip.mediaType !== 'video') return Promise.resolve();
              const ve = videoElements.get(vClip.mediaId);
              if (!ve) return Promise.resolve();
              return seekVideoElement(
                ve,
                vClip.sourceStart + (time - vClip.startTime) * vClip.speed
              );
            })
          );
        }
        drawFrameToCanvas(
          ctx,
          width,
          height,
          time,
          clips,
          videoElements,
          imageElements,
          false
        );

        const vf = new VideoFrame(canvas, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });
        vEncoder.encode(vf, { keyFrame: i % keyInterval === 0 });
        vf.close();

        if (vEncoder.encodeQueueSize > 32) {
          await vEncoder.flush();
        }

        if (i % 10 === 0 || i === totalFrames - 1) {
          onProgress({
            status: 'rendering',
            progress: 10 + Math.round(((i + 1) / totalFrames) * 75),
            message: `GPU encoding frame ${i + 1}/${totalFrames}...`,
          });
        }
      }

      await vEncoder.flush();
      vEncoder.close();

      let totalBytes = 0;
      for (const c of h264Chunks) totalBytes += c.byteLength;
      const h264Stream = new Uint8Array(totalBytes);
      let writeOff = 0;
      for (const c of h264Chunks) {
        h264Stream.set(c, writeOff);
        writeOff += c.byteLength;
      }

      onProgress({
        status: 'encoding',
        progress: 88,
        message: 'Muxing GPU H.264 + AAC via Native FFmpeg...',
      });

      const wavBytes = audioBuf ? audioBufferToWavBytes(audioBuf) : null;
      const jobId = `mux_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      await fetch(
        `/api/native-export/upload-job-file/${encodeURIComponent(jobId)}/video.h264`,
        { method: 'POST', body: h264Stream.buffer as ArrayBuffer }
      );
      if (wavBytes) {
        await fetch(
          `/api/native-export/upload-job-file/${encodeURIComponent(jobId)}/audio.wav`,
          { method: 'POST', body: wavBytes.buffer as ArrayBuffer }
        );
      }

      const muxRes = await fetch('/api/native-export/mux-h264', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, fps, hasAudioWav: Boolean(wavBytes) }),
      });
      if (!muxRes.ok) {
        throw new Error('Native FFmpeg muxing failed');
      }

      const dlRes = await fetch(
        `/api/native-export/download/${encodeURIComponent(jobId)}`
      );
      const outBlob = await dlRes.blob();
      const outUrl = URL.createObjectURL(outBlob);

      onProgress({
        status: 'done',
        progress: 100,
        message: 'Export complete!',
        outputUrl: outUrl,
      });
      return outUrl;
    }
  }

  // High-Quality FFmpeg.wasm frame-by-frame path (when user selects "Best Quality")
  if (settings.encoder === 'hq') {
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    onProgress({
      status: 'preparing',
      progress: 8,
      message: 'Loading FFmpeg.wasm high-quality encoder...',
    });
    const ffmpeg = await getFFmpeg();
    if (abortSignal?.aborted) throw new Error('Export cancelled');

    for (let i = 0; i < totalFrames; i++) {
      if (abortSignal?.aborted) throw new Error('Export cancelled');
      const time = i / fps;
      for (const vClip of findActiveClipsAtTime<VideoClip>(clips, 'video', time)) {
        if (vClip.mediaType === 'video') {
          const ve = videoElements.get(vClip.mediaId);
          if (ve) {
            await seekVideoElement(
              ve,
              vClip.sourceStart + (time - vClip.startTime) * vClip.speed
            );
          }
        }
      }
      drawFrameToCanvas(
        ctx,
        width,
        height,
        time,
        clips,
        videoElements,
        imageElements,
        false
      );
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', 0.98)
      );
      if (blob) {
        await ffmpeg.writeFile(
          `frame_${String(i).padStart(5, '0')}.jpg`,
          new Uint8Array(await blob.arrayBuffer())
        );
      }
      if (i % 4 === 0 || i === totalFrames - 1) {
        onProgress({
          status: 'rendering',
          progress: 10 + Math.round(((i + 1) / totalFrames) * 65),
          message: `Rendering HQ frame ${i + 1}/${totalFrames}...`,
        });
      }
    }

    const wavBytes = await renderMixedAudioWav(clips, assetMap, duration);
    if (wavBytes) {
      await ffmpeg.writeFile('hq_audio.wav', wavBytes);
    }

    onProgress({
      status: 'encoding',
      progress: 82,
      message: 'Encoding high-quality H.264 MP4...',
    });

    const crf =
      settings.quality === 'ultra' ? '13' : settings.quality === 'high' ? '16' : '19';
    await ffmpeg.exec([
      '-framerate',
      String(fps),
      '-i',
      'frame_%05d.jpg',
      ...(wavBytes ? ['-i', 'hq_audio.wav'] : []),
      '-c:v',
      'libx264',
      '-crf',
      crf,
      '-preset',
      'ultrafast',
      '-tune',
      'fastdecode',
      '-threads',
      '0',
      '-pix_fmt',
      'yuv420p',
      ...(wavBytes ? ['-c:a', 'aac', '-b:a', '320k', '-shortest'] : []),
      '-movflags',
      '+faststart',
      '-y',
      'output.mp4',
    ]);

    const outData = await ffmpeg.readFile('output.mp4');
    const outBytes =
      outData instanceof Uint8Array
        ? new Uint8Array(outData)
        : new TextEncoder().encode(outData);
    const outUrl = URL.createObjectURL(new Blob([outBytes], { type: 'video/mp4' }));

    for (let i = 0; i < totalFrames; i++) {
      await ffmpeg.deleteFile(`frame_${String(i).padStart(5, '0')}.jpg`).catch(() => {});
    }
    if (wavBytes) await ffmpeg.deleteFile('hq_audio.wav').catch(() => {});
    await ffmpeg.deleteFile('output.mp4').catch(() => {});

    onProgress({
      status: 'done',
      progress: 100,
      message: 'Export complete!',
      outputUrl: outUrl,
    });
    return outUrl;
  }

  const recorderOption = pickSupportedRecorderMime();
  if (!recorderOption) {
    throw new Error('Your browser does not support MediaRecorder video export.');
  }

  const { videoBps, audioBps } = getTargetBitrates(
    width,
    height,
    fps,
    settings.quality,
    settings.customBitrateMbps
  );

  // Pre-seek initial video frames at t = 0 before starting MediaRecorder
  for (const vClip of findActiveClipsAtTime<VideoClip>(clips, 'video', 0)) {
    if (vClip.mediaType === 'video') {
      const ve = videoElements.get(vClip.mediaId);
      if (ve && Math.abs(ve.currentTime - vClip.sourceStart) > 0.02) {
        await new Promise<void>((resolve) => {
          ve.addEventListener('seeked', () => resolve(), { once: true });
          ve.currentTime = Math.max(0, vClip.sourceStart);
        });
      }
    }
  }

  const canvasStream = canvas.captureStream(fps);
  const videoTrack = canvasStream.getVideoTracks()[0] as
    | (MediaStreamTrack & { requestFrame?: () => void })
    | undefined;
  const audioCtx = new AudioContext();
  const audioDest = audioCtx.createMediaStreamDestination();
  const hasAudio = await scheduleLiveAudio(
    audioCtx,
    audioDest,
    clips,
    assetMap,
    audioCtx.currentTime + 0.05
  );

  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(hasAudio ? audioDest.stream.getAudioTracks() : []),
  ]);

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: recorderOption.mimeType,
    bitsPerSecond: videoBps + audioBps,
    videoBitsPerSecond: videoBps,
    audioBitsPerSecond: audioBps,
  });

  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const recordingDone = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorderOption.mimeType }));
    };
    recorder.onerror = () => reject(new Error('MediaRecorder encoding error'));
  });

  // Draw initial frame before starting recorder
  drawFrameToCanvas(
    ctx,
    width,
    height,
    0,
    clips,
    videoElements,
    imageElements,
    true
  );

  recorder.start(250);
  const startPerf = performance.now();

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (abortSignal?.aborted) {
        recorder.stop();
        reject(new Error('Export cancelled'));
        return;
      }

      const elapsed = (performance.now() - startPerf) / 1000;
      const current = Math.min(elapsed, duration);

      drawFrameToCanvas(
        ctx,
        width,
        height,
        current,
        clips,
        videoElements,
        imageElements,
        true
      );
      videoTrack?.requestFrame?.();

      const pct = Math.min(
        recorderOption.isMp4 ? 95 : 85,
        10 + Math.round((current / duration) * (recorderOption.isMp4 ? 85 : 75))
      );
      onProgress({
        status: 'rendering',
        progress: pct,
        message: `Exporting video (${current.toFixed(1)}s / ${duration.toFixed(1)}s)...`,
      });

      if (elapsed >= duration) {
        for (const ve of videoElements.values()) ve.pause();
        recorder.stop();
        resolve();
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });

  const recordedBlob = await recordingDone;
  await audioCtx.close().catch(() => {});

  // Keep lint clean for unused helper
  void computeAudioClipGain;

  // If browser recorded directly to MP4 (Chrome/Edge), we are done immediately!
  if (recorderOption.isMp4) {
    const outputUrl = URL.createObjectURL(recordedBlob);
    onProgress({
      status: 'done',
      progress: 100,
      message: 'Export complete!',
      outputUrl,
    });
    return outputUrl;
  }

  // Otherwise remux/convert WebM -> MP4 via FFmpeg.wasm
  onProgress({
    status: 'encoding',
    progress: 88,
    message: 'Finalizing MP4 container...',
  });

  const ffmpeg = await getFFmpeg();
  const inBytes = new Uint8Array(await recordedBlob.arrayBuffer());
  await ffmpeg.writeFile('recorded.webm', inBytes);

  const ffmpegArgs = recorderOption.isH264
    ? ['-i', 'recorded.webm', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-y', 'output.mp4']
    : ['-i', 'recorded.webm', '-c:v', 'libx264', '-crf', '15', '-preset', 'superfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-y', 'output.mp4'];

  await ffmpeg.exec(ffmpegArgs);

  const outputData = await ffmpeg.readFile('output.mp4');
  const outputBytes =
    outputData instanceof Uint8Array
      ? outputData
      : new TextEncoder().encode(outputData);
  const outputBlob = new Blob([new Uint8Array(outputBytes)], {
    type: 'video/mp4',
  });
  const outputUrl = URL.createObjectURL(outputBlob);

  await ffmpeg.deleteFile('recorded.webm').catch(() => {});
  await ffmpeg.deleteFile('output.mp4').catch(() => {});

  onProgress({
    status: 'done',
    progress: 100,
    message: 'Export complete!',
    outputUrl,
  });

  return outputUrl;
}

/**
 * Transcodes browser-incompatible video codecs (e.g. HEVC/H.265, ProRes)
 * locally to H.264 MP4 so HTML5 <video> can preview and scrub them.
 */
export async function transcodeToH264(
  file: File,
  onProgress?: (pct: number) => void
): Promise<File> {
  const ffmpeg = await getFFmpeg();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const inputName = `transcode_in.${ext}`;
  const outputName = 'transcode_out.mp4';

  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) {
      onProgress(Math.min(99, Math.max(1, Math.round(progress * 100))));
    }
  };
  ffmpeg.on('progress', progressHandler);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inputName, bytes);

    await ffmpeg.exec([
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-y',
      outputName,
    ]);

    const outData = await ffmpeg.readFile(outputName);
    const outBytes =
      outData instanceof Uint8Array
        ? new Uint8Array(outData)
        : new TextEncoder().encode(outData);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([outBytes], `${baseName}.mp4`, { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', progressHandler);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
