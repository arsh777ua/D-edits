import type {
  AudioClip,
  MediaAsset,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import { decodeAssetAudioBuffer } from './silenceRemoval';
import { getProjectDuration } from './timeline';

function encodeAudioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const len = buffer.length;
  const dataLen = len * numCh * 2;
  const wav = new ArrayBuffer(44 + dataLen);
  const view = new DataView(wav);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
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
  view.setUint32(40, dataLen, true);

  const pcm = new Int16Array(wav, 44);
  if (numCh === 1) {
    const ch0 = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const s = ch0[i];
      const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
  } else {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numCh; ch++) {
      channels.push(buffer.getChannelData(ch));
    }
    let idx = 0;
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = channels[ch][i];
        const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
        pcm[idx++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
    }
  }
  return new Blob([wav], { type: 'audio/wav' });
}

/**
 * Renders all active video/audio clips on the timeline into a single 16kHz mono WAV File
 * whose timestamps match the timeline 1:1 (respecting trims, splits, speed, and silence cuts).
 */
export async function renderTimelineAudioToWav(
  clips: TimelineClip[],
  mediaAssets: MediaAsset[]
): Promise<File | null> {
  const audioSources = clips.filter(
    (c): c is VideoClip | AudioClip =>
      c.trackType === 'audio' ||
      (c.trackType === 'video' && c.mediaType === 'video')
  );
  if (audioSources.length === 0) return null;

  const duration = getProjectDuration(audioSources);
  if (duration <= 0) return null;

  const assetMap = new Map<string, MediaAsset>();
  for (const a of mediaAssets) assetMap.set(a.id, a);

  let offlineCtx: OfflineAudioContext;
  try {
    offlineCtx = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(duration * 16000)),
      16000
    );
  } catch {
    offlineCtx = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(duration * 44100)),
      44100
    );
  }

  let scheduledAny = false;
  for (const clip of audioSources) {
    const asset = assetMap.get(clip.mediaId);
    if (!asset) continue;
    let buf: AudioBuffer | null = null;
    try {
      buf = await decodeAssetAudioBuffer(asset);
    } catch {
      buf = null;
    }
    if (!buf || buf.duration <= 0.01) continue;

    const speed = clip.trackType === 'video' ? clip.speed : 1;
    const when = Math.max(0, clip.startTime);
    const offset = Math.max(0, Math.min(buf.duration - 0.01, clip.sourceStart));
    const playDur = Math.max(
      0.01,
      Math.min(clip.duration * speed, buf.duration - offset)
    );

    scheduledAny = true;
    const src = offlineCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;

    const gain = offlineCtx.createGain();
    gain.gain.value = clip.volume > 0 ? Math.min(2, clip.volume) : 1;
    src.connect(gain);
    gain.connect(offlineCtx.destination);

    src.start(when, offset, playDur);
  }

  if (!scheduledAny) {
    // Fallback: if browser couldn't decode the audio codec, let Whisper/PyAV decode the single timeline clip directly
    if (audioSources.length === 1) {
      const singleAsset = assetMap.get(audioSources[0].mediaId);
      if (singleAsset) return singleAsset.file;
    }
    return null;
  }
  const rendered = await offlineCtx.startRendering();
  const wavBlob = encodeAudioBufferToWavBlob(rendered);
  return new File([wavBlob], 'timeline_audio.wav', { type: 'audio/wav' });
}
