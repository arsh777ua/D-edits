import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type {
  AudioClip,
  ExportProgress,
  ExportSettings,
  MediaAsset,
  TextClip,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import { evaluateCaptionAnimation } from './captions';
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
          if (Math.abs(ve.currentTime - expectedTime) > 0.25) {
            ve.currentTime = Math.max(0, expectedTime);
          }
          if (ve.paused) {
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
  quality: ExportSettings['quality']
): { videoBps: number; audioBps: number } {
  const pixels = width * height;
  const resScale = pixels / (1920 * 1080); // 1.0 for 1080p, 4.0 for 4K
  const fpsScale = fps >= 50 ? 1.35 : 1.0;

  const baseMbps =
    quality === 'ultra' ? 28 : quality === 'high' ? 16 : 8;
  const videoBps = Math.round(
    Math.max(4_000_000, baseMbps * 1_000_000 * resScale * fpsScale)
  );
  const audioBps = quality === 'ultra' ? 320_000 : quality === 'high' ? 192_000 : 128_000;
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

  return hasAnyAudio;
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

  const width =
    settings.width ?? (settings.resolution === '1080p' ? 1920 : 1280);
  const height =
    settings.height ?? (settings.resolution === '1080p' ? 1080 : 720);
  const fps = settings.fps;

  const assetMap = new Map<string, MediaAsset>();
  for (const a of mediaAssets) assetMap.set(a.id, a);

  onProgress({
    status: 'preparing',
    progress: 5,
    message: 'Preparing media assets...',
  });

  const videoElements = new Map<string, HTMLVideoElement>();
  const imageElements = new Map<string, HTMLImageElement>();

  for (const clip of clips) {
    if (clip.trackType !== 'video') continue;
    const asset = assetMap.get(clip.mediaId);
    if (!asset) continue;
    if (clip.mediaType === 'video' && !videoElements.has(asset.id)) {
      videoElements.set(asset.id, await loadVideoElement(asset.url));
    } else if (clip.mediaType === 'image' && !imageElements.has(asset.id)) {
      imageElements.set(asset.id, await loadImageElement(asset.url));
    }
  }

  if (abortSignal?.aborted) throw new Error('Export cancelled');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

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

    const seekVideo = (video: HTMLVideoElement, t: number) =>
      new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - t) < 0.005) {
          resolve();
          return;
        }
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = Math.max(0, t);
      });

    for (let i = 0; i < totalFrames; i++) {
      if (abortSignal?.aborted) throw new Error('Export cancelled');
      const time = i / fps;
      for (const vClip of findActiveClipsAtTime<VideoClip>(clips, 'video', time)) {
        if (vClip.mediaType === 'video') {
          const ve = videoElements.get(vClip.mediaId);
          if (ve) {
            await seekVideo(
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
        canvas.toBlob(res, 'image/jpeg', 0.96)
      );
      if (blob) {
        await ffmpeg.writeFile(
          `frame_${String(i).padStart(5, '0')}.jpg`,
          new Uint8Array(await blob.arrayBuffer())
        );
      }
      onProgress({
        status: 'rendering',
        progress: 10 + Math.round(((i + 1) / totalFrames) * 65),
        message: `Rendering HQ frame ${i + 1}/${totalFrames}...`,
      });
    }

    // Mix audio via OfflineAudioContext
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(
      2,
      Math.ceil(duration * sampleRate),
      sampleRate
    );
    const hasOfflineAudio = await scheduleLiveAudio(
      offlineCtx as unknown as AudioContext,
      offlineCtx.destination as unknown as MediaStreamAudioDestinationNode,
      clips,
      assetMap,
      0
    );
    let hasWav = false;
    if (hasOfflineAudio) {
      const renderedAudio = await offlineCtx.startRendering();
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
      let off = 44;
      for (let i = 0; i < renderedAudio.length; i++) {
        for (let c = 0; c < numCh; c++) {
          const s = Math.max(-1, Math.min(1, renderedAudio.getChannelData(c)[i]));
          view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          off += 2;
        }
      }
      await ffmpeg.writeFile('hq_audio.wav', new Uint8Array(wav));
      hasWav = true;
    }

    onProgress({
      status: 'encoding',
      progress: 82,
      message: 'Encoding high-quality H.264 MP4...',
    });

    const crf =
      settings.quality === 'ultra' ? '15' : settings.quality === 'high' ? '18' : '22';
    await ffmpeg.exec([
      '-framerate',
      String(fps),
      '-i',
      'frame_%05d.jpg',
      ...(hasWav ? ['-i', 'hq_audio.wav'] : []),
      '-c:v',
      'libx264',
      '-crf',
      crf,
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      ...(hasWav ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
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
    if (hasWav) await ffmpeg.deleteFile('hq_audio.wav').catch(() => {});
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
    settings.quality
  );

  const canvasStream = canvas.captureStream(fps);
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
    ? ['-i', 'recorded.webm', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', '-y', 'output.mp4']
    : ['-i', 'recorded.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', 'output.mp4'];

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
