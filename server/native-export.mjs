import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createOverlayRenderer } from './native-overlays.mjs';

const execFileAsync = promisify(execFile);

const CACHE_DIR = path.join(os.tmpdir(), 'dedits-native-export');
const ASSETS_DIR = path.join(CACHE_DIR, 'assets');
const JOBS_DIR = path.join(CACHE_DIR, 'jobs');
const SFX_DIR = path.resolve(process.cwd(), 'custom assets', 'sfx');

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

let cachedEncoder = null;

export async function detectBestH264Encoder() {
  if (cachedEncoder) return cachedEncoder;

  const candidates = [
    { codec: 'h264_nvenc', label: 'NVIDIA NVENC GPU' },
    { codec: 'h264_qsv', label: 'Intel QuickSync GPU' },
    { codec: 'h264_amf', label: 'AMD AMF GPU' },
    { codec: 'libx264', label: 'CPU x264' },
  ];

  for (const c of candidates) {
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=256x256:d=0.1',
          '-c:v',
          c.codec,
          '-f',
          'null',
          '-',
        ],
        { timeout: 6000 }
      );
      cachedEncoder = c;
      return c;
    } catch {
      // Try next encoder
    }
  }

  cachedEncoder = { codec: 'libx264', label: 'CPU x264' };
  return cachedEncoder;
}

const jobs = new Map();

function getQualityCrf(quality) {
  if (quality === 'ultra') return 18;
  if (quality === 'high') return 20;
  return 23;
}

function buildEncoderArgs(codec, quality, customBitrateMbps) {
  const crf = getQualityCrf(quality);
  if (customBitrateMbps && customBitrateMbps > 0) {
    const b = `${Math.round(customBitrateMbps)}M`;
    if (codec === 'h264_nvenc') {
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-b:v', b, '-maxrate', b, '-pix_fmt', 'yuv420p'];
    }
    if (codec === 'h264_qsv') {
      return ['-c:v', 'h264_qsv', '-b:v', b, '-pix_fmt', 'yuv420p'];
    }
    if (codec === 'h264_amf') {
      return ['-c:v', 'h264_amf', '-b:v', b, '-pix_fmt', 'yuv420p'];
    }
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', b, '-pix_fmt', 'yuv420p'];
  }

  if (codec === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0', '-pix_fmt', 'yuv420p'];
  }
  if (codec === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(crf), '-pix_fmt', 'yuv420p'];
  }
  if (codec === 'h264_amf') {
    return ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf), '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
}

function getGraphicSfxOffsets(gc) {
  const sfx = gc.sfx;
  if (!sfx?.enabled || !sfx.sfxFile) return [];
  const baseDelay = Math.max(0, sfx.delay ?? 0);
  if (sfx.triggerMode === 'on-start') {
    return baseDelay < gc.duration ? [baseDelay] : [];
  }
  if (sfx.triggerMode === 'on-target') {
    const arriveAt = baseDelay + Math.max(0.1, gc.specific?.countDuration ?? 2.4);
    return arriveAt < gc.duration - 0.02 ? [arriveAt] : [];
  }
  const mainText = (gc.layers || []).find((l) => l.type === 'text' && l.visible)?.text ?? '';
  const words = mainText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const stagger = Math.max(0.06, gc.animation?.stagger || 0.28);
  return words.map((_, i) => baseDelay + i * stagger).filter((t) => t < gc.duration - 0.02);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getAssetFilePath(assetId) {
  const entries = fs.readdirSync(ASSETS_DIR);
  const match = entries.find((e) => e.startsWith(`${assetId}.`) || e === assetId);
  return match ? path.join(ASSETS_DIR, match) : null;
}

export function attachNativeExportMiddleware(middlewares) {
  middlewares.use('/api/system-fonts', async (_req, res) => {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Drawing; [System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name }',
        ],
        { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }
      );
      const list = Array.from(
        new Set(
          stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      if (list.length > 0) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ fonts: list }));
        return;
      }
      throw new Error('Empty font list');
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          fonts: [
            'Arial',
            'Calibri',
            'Cambria',
            'Consolas',
            'Courier New',
            'Georgia',
            'Impact',
            'Segoe UI',
            'Tahoma',
            'Times New Roman',
            'Trebuchet MS',
            'Verdana',
          ],
        })
      );
    }
  });

  middlewares.use('/api/native-export/status', async (_req, res) => {
    try {
      const enc = await detectBestH264Encoder();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ available: true, encoder: enc }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ available: false, error: String(err) }));
    }
  });

  middlewares.use('/api/native-export/has-asset/', (req, res) => {
    const assetId = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]);
    const found = assetId ? getAssetFilePath(path.basename(assetId)) : null;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ exists: Boolean(found) }));
  });

  middlewares.use('/api/native-export/upload-asset/', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const raw = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]);
      const [assetId, extRaw] = raw.split('__ext__');
      const safeId = path.basename(assetId || 'asset');
      const ext = extRaw ? `.${path.basename(extRaw).replace(/[^a-z0-9]/gi, '')}` : '.mp4';
      const target = path.join(ASSETS_DIR, `${safeId}${ext}`);
      const buf = await readRawBody(req);
      fs.writeFileSync(target, buf);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, assetId: safeId }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  middlewares.use('/api/native-export/start', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const body = await readJsonBody(req);
      const {
        jobId: providedJobId,
        width,
        height,
        fps,
        duration,
        quality,
        customBitrateMbps,
        clips,
      } = body;

      const jobId = path.basename(providedJobId || crypto.randomUUID());
      const jobDir = path.join(JOBS_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      const enc = await detectBestH264Encoder();
      const outputPath = path.join(jobDir, 'output.mp4');

      const job = {
        id: jobId,
        status: 'rendering',
        progress: 5,
        message: `Rendering outside browser with ${enc.label}...`,
        encoder: enc,
        outputPath,
        error: null,
      };
      jobs.set(jobId, job);

      const inputs = [];
      const filterParts = [];
      const audioLabels = [];

      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}[base0]`
      );
      let currentVideoLabel = 'base0';
      let inputIdx = 0;

      // 1. Video clips
      const videoClips = (clips || [])
        .filter((c) => c.trackType === 'video')
        .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));

      for (let i = 0; i < videoClips.length; i++) {
        const vc = videoClips[i];
        const assetPath = getAssetFilePath(vc.mediaId);
        if (!assetPath) continue;

        const idx = inputIdx++;
        const speed = vc.speed || 1;
        if (vc.mediaType === 'image') {
          inputs.push('-loop', '1', '-t', String(vc.duration), '-i', assetPath);
        } else {
          inputs.push(
            '-ss',
            String(Math.max(0, vc.sourceStart || 0)),
            '-t',
            String(Math.max(0.05, vc.duration * speed)),
            '-i',
            assetPath
          );
        }

        const vLabel = `vc_${i}`;
        const chains = [
          vc.mediaType === 'video' && speed !== 1
            ? `setpts=(PTS-STARTPTS)/${speed}+${vc.startTime.toFixed(3)}/TB`
            : `setpts=PTS-STARTPTS+${vc.startTime.toFixed(3)}/TB`,
          `fps=${fps}`,
        ];

        const br = (vc.brightness ?? 1) - 1;
        const ct = vc.contrast ?? 1;
        if (Math.abs(br) > 0.01 || Math.abs(ct - 1) > 0.01) {
          chains.push(`eq=brightness=${br.toFixed(2)}:contrast=${ct.toFixed(2)}`);
        }

        const scale = vc.scale ?? 1;
        const targetW = Math.max(2, Math.round(width * scale) & ~1);
        const targetH = Math.max(2, Math.round(height * scale) & ~1);
        chains.push(
          `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
          `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
          'format=yuva420p'
        );

        filterParts.push(`[${idx}:v]${chains.join(',')}[${vLabel}]`);

        const ox = Math.round((width - targetW) / 2 + ((vc.x ?? 0) / 100) * width);
        const oy = Math.round((height - targetH) / 2 + ((vc.y ?? 0) / 100) * height);
        const nextLabel = `comp_${i}`;
        const endT = (vc.startTime + vc.duration).toFixed(3);
        filterParts.push(
          `[${currentVideoLabel}][${vLabel}]overlay=x=${ox}:y=${oy}:enable='between(t,${vc.startTime.toFixed(3)},${endT})':eof_action=pass[${nextLabel}]`
        );
        currentVideoLabel = nextLabel;

        if (vc.mediaType === 'video' && (vc.volume ?? 1) > 0) {
          const aLabel = `va_${i}`;
          const delayMs = Math.max(0, Math.round(vc.startTime * 1000));
          const vol = vc.volume ?? 1;
          const atempo = speed !== 1 ? `atempo=${speed},` : '';
          filterParts.push(
            `[${idx}:a]${atempo}volume=${vol.toFixed(2)},adelay=${delayMs}|${delayMs},apad=whole_dur=${duration.toFixed(3)}[${aLabel}]`
          );
          audioLabels.push(`[${aLabel}]`);
        }
      }

      // 2. Graphic SFX natively in FFmpeg
      const graphicClips = (clips || []).filter((c) => c.trackType === 'graphics');
      for (let i = 0; i < graphicClips.length; i++) {
        const gc = graphicClips[i];
        const offsets = getGraphicSfxOffsets(gc);
        if (offsets.length > 0 && gc.sfx?.sfxFile) {
          const sfxPath = path.join(SFX_DIR, path.basename(gc.sfx.sfxFile));
          if (fs.existsSync(sfxPath)) {
            for (let k = 0; k < offsets.length; k++) {
              const sIdx = inputIdx++;
              inputs.push('-i', sfxPath);
              const sLabel = `sfx_${i}_${k}`;
              const delayMs = Math.max(0, Math.round((gc.startTime + offsets[k]) * 1000));
              const vol = gc.sfx.volume ?? 0.85;
              filterParts.push(
                `[${sIdx}:a]volume=${vol.toFixed(2)},adelay=${delayMs}|${delayMs},apad=whole_dur=${duration.toFixed(3)}[${sLabel}]`
              );
              audioLabels.push(`[${sLabel}]`);
            }
          }
        }
      }

      // 3. Dedicated Audio clips
      const audioClips = (clips || []).filter((c) => c.trackType === 'audio');
      for (let i = 0; i < audioClips.length; i++) {
        const ac = audioClips[i];
        const assetPath = getAssetFilePath(ac.mediaId);
        if (!assetPath) continue;
        const idx = inputIdx++;
        inputs.push(
          '-ss',
          String(Math.max(0, ac.sourceStart || 0)),
          '-t',
          String(Math.max(0.05, ac.duration)),
          '-i',
          assetPath
        );
        const aLabel = `aud_${i}`;
        const delayMs = Math.max(0, Math.round(ac.startTime * 1000));
        const vol = ac.volume ?? 1;
        filterParts.push(
          `[${idx}:a]volume=${vol.toFixed(2)},adelay=${delayMs}|${delayMs},apad=whole_dur=${duration.toFixed(3)}[${aLabel}]`
        );
        audioLabels.push(`[${aLabel}]`);
      }

      // 4. Native Skia (@napi-rs/canvas) RGBA pipe for 100% exact Graphics, Text & Captions
      const overlayRenderer = createOverlayRenderer(width, height, clips);
      if (overlayRenderer.hasAny) {
        const ovIdx = inputIdx++;
        inputs.push(
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgba',
          '-s',
          `${width}x${height}`,
          '-r',
          String(fps),
          '-i',
          'pipe:0'
        );
        const nextLabel = 'comp_ov';
        filterParts.push(
          `[${currentVideoLabel}][${ovIdx}:v]overlay=0:0:format=auto:shortest=1[${nextLabel}]`
        );
        currentVideoLabel = nextLabel;
      }

      // 5. Mix all audio streams natively
      let audioMapArgs = [];
      if (audioLabels.length === 1) {
        audioMapArgs = ['-map', audioLabels[0], '-c:a', 'aac', '-b:a', '320k'];
      } else if (audioLabels.length > 1) {
        filterParts.push(
          `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`
        );
        audioMapArgs = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '320k'];
      }

      const encArgs = buildEncoderArgs(enc.codec, quality, customBitrateMbps);
      const ffmpegArgs = [
        '-y',
        ...inputs,
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        `[${currentVideoLabel}]`,
        ...audioMapArgs,
        ...encArgs,
        '-t',
        duration.toFixed(3),
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        outputPath,
      ];

      const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
      let stderrTail = '';

      if (overlayRenderer.hasAny && proc.stdin) {
        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        (async () => {
          try {
            for (let f = 0; f < totalFrames; f++) {
              if (proc.killed) break;
              const rgba = overlayRenderer.renderFrameRgba(f / fps);
              const ok = proc.stdin.write(rgba);
              if (!ok) {
                await new Promise((resolve) => proc.stdin.once('drain', resolve));
              }
            }
            proc.stdin.end();
          } catch {
            // Ignore pipe close if FFmpeg exited early
          }
        })();
      }

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        const match = text.match(/out_time_us=(\d+)/);
        if (match) {
          const outSec = Number(match[1]) / 1_000_000;
          const pct = Math.min(98, Math.max(5, Math.round((outSec / Math.max(0.1, duration)) * 95)));
          job.progress = pct;
          job.message = `${enc.label}: ${outSec.toFixed(1)}s / ${duration.toFixed(1)}s`;
        }
      });

      proc.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1200);
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          job.status = 'done';
          job.progress = 100;
          job.message = `Export complete (${enc.label})`;
        } else {
          job.status = 'error';
          job.error = stderrTail || `FFmpeg exited with code ${code}`;
        }
      });

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jobId, encoder: enc }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  middlewares.use('/api/native-export/progress/', (req, res) => {
    const jobId = path.basename(decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]));
    const job = jobs.get(jobId);
    if (!job) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: job.status,
        progress: job.progress,
        message: job.message,
        encoder: job.encoder,
        error: job.error,
      })
    );
  });

  middlewares.use('/api/native-export/download/', (req, res) => {
    const jobId = path.basename(decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]));
    const job = jobs.get(jobId);
    if (!job || !fs.existsSync(job.outputPath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const buf = fs.readFileSync(job.outputPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);

    setTimeout(() => {
      try {
        fs.rmSync(path.dirname(job.outputPath), { recursive: true, force: true });
        jobs.delete(jobId);
      } catch {
        // Ignore cleanup errors
      }
    }, 2000);
  });
}
