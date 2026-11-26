import { AlertCircle, CheckCircle2, Download, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  ExportEncoder,
  ExportProgress,
  ExportQuality,
  ExportSettings,
  FrameRateOption,
  MediaAsset,
  ProjectSettings,
  TimelineClip,
} from '../types/editor';
import { exportProjectToMp4 } from '../utils/exporter';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  projectSettings: ProjectSettings;
  clips: TimelineClip[];
  mediaAssets: MediaAsset[];
}

const RES_OPTIONS: Array<{
  id: ExportSettings['resolution'];
  label: string;
  w?: number;
  h?: number;
}> = [
  { id: '720p', label: '720p HD', w: 1280, h: 720 },
  { id: '1080p', label: '1080p FHD', w: 1920, h: 1080 },
  { id: '1440p', label: '1440p 2K', w: 2560, h: 1440 },
  { id: '2160p', label: '2160p 4K', w: 3840, h: 2160 },
];

export function ExportModal({
  open,
  onClose,
  projectName,
  projectSettings,
  clips,
  mediaAssets,
}: ExportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [settings, setSettings] = useState<ExportSettings>({
    resolution: 'project',
    width: projectSettings.width,
    height: projectSettings.height,
    fps: projectSettings.fps,
    quality: 'high',
    encoder: 'fast',
  });

  const [progress, setProgress] = useState<ExportProgress>({
    status: 'idle',
    progress: 0,
    message: '',
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    abortRef.current?.abort();
    if (progress.outputUrl) {
      URL.revokeObjectURL(progress.outputUrl);
    }
    onClose();
  };

  const handleStartExport = async () => {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await exportProjectToMp4(
        clips,
        mediaAssets,
        settings,
        setProgress,
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setProgress({
        status: 'error',
        progress: 0,
        message: 'Export failed',
        error: err instanceof Error ? err.message : 'Unknown export error',
      });
    }
  };

  const isExporting =
    progress.status === 'preparing' ||
    progress.status === 'rendering' ||
    progress.status === 'encoding';

  const safeFilename = `${(projectName || 'video').replace(/[^a-z0-9_-]/gi, '_')}.mp4`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="export-dialog-title"
      onClose={handleClose}
      className="m-auto w-full max-w-lg rounded-xl bg-[#181a20] border border-[#2a2d36] text-[#e8eaed] p-0 shadow-2xl"
    >
      <div className="px-5 py-4 border-b border-[#262932] flex items-center justify-between">
        <h1 id="export-dialog-title" className="text-sm font-semibold text-white">
          Export Video
        </h1>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close export dialog"
          className="p-1 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {progress.status === 'idle' && (
          <>
            {/* Resolution */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#9aa0ad]">Resolution</span>
                <span className="text-[11px] font-mono text-[#00d4c6]">
                  {settings.width} × {settings.height}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      resolution: 'project',
                      width: projectSettings.width,
                      height: projectSettings.height,
                    }))
                  }
                  className={`py-2 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    settings.resolution === 'project'
                      ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6]'
                      : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                  }`}
                >
                  Project ({projectSettings.width}×{projectSettings.height})
                </button>
                {RES_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        resolution: opt.id,
                        width: opt.w,
                        height: opt.h,
                      }))
                    }
                    className={`py-2 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      settings.resolution === opt.id
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6]'
                        : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Rate */}
            <div className="space-y-1.5">
              <span className="text-xs text-[#9aa0ad] block">Frame Rate</span>
              <div className="grid grid-cols-4 gap-2">
                {Array.from(
                  new Set<FrameRateOption>([projectSettings.fps, 24, 30, 60])
                ).map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, fps }))}
                    className={`py-1.5 px-2 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                      settings.fps === fps
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6]'
                        : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Quality / Bitrate */}
            <div className="space-y-1.5">
              <span className="text-xs text-[#9aa0ad] block">
                Quality & Bitrate
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'standard', label: 'Standard', desc: '8 Mbps' },
                    { id: 'high', label: 'High', desc: '16 Mbps' },
                    { id: 'ultra', label: 'Ultra', desc: '28+ Mbps' },
                  ] as Array<{ id: ExportQuality; label: string; desc: string }>
                ).map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, quality: q.id }))}
                    className={`py-2 px-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      settings.quality === q.id
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-white'
                        : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold">{q.label}</div>
                    <div className="text-[10px] opacity-75">{q.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Encoder Mode */}
            <div className="space-y-1.5">
              <span className="text-xs text-[#9aa0ad] block">Encoder Mode</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: 'fast',
                      label: 'Fast (GPU Hardware)',
                      desc: '1x real-time export',
                    },
                    {
                      id: 'hq',
                      label: 'Best Quality (FFmpeg)',
                      desc: 'Sharpest CRF H.264, slower',
                    },
                  ] as Array<{ id: ExportEncoder; label: string; desc: string }>
                ).map((enc) => (
                  <button
                    key={enc.id}
                    type="button"
                    onClick={() =>
                      setSettings((s) => ({ ...s, encoder: enc.id }))
                    }
                    className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      settings.encoder === enc.id
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-white'
                        : 'bg-[#1e2028] border-[#2a2d36] text-[#b0b5c0] hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold">{enc.label}</div>
                    <div className="text-[10px] opacity-75">{enc.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[#121419] border border-[#22252e]">
              <span className="text-[#8c92a0]">Format</span>
              <span className="font-mono text-white">MP4 (H.264 + AAC)</span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-xs font-medium text-[#b0b5c0] hover:text-white hover:bg-[#232630] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={handleStartExport}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#00d4c6] hover:bg-[#18e3d5] text-[#091214] cursor-pointer"
              >
                Start Export
              </button>
            </div>
          </>
        )}

        {isExporting && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-[#00d4c6] animate-spin shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">
                  {progress.message}
                </p>
                <p className="text-[11px] text-[#8c92a0]">
                  Processing locally in your browser
                </p>
              </div>
              <span className="text-xs font-mono text-[#00d4c6]">
                {progress.progress}%
              </span>
            </div>

            <div className="h-2 w-full rounded-full bg-[#262932] overflow-hidden">
              <div
                className="h-full bg-[#00d4c6] transition-all duration-200"
                style={{ width: `${progress.progress}%` }}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-lg text-xs text-[#b0b5c0] hover:text-white hover:bg-[#232630] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {progress.status === 'done' && progress.outputUrl && (
          <div className="space-y-4 py-2 text-center">
            <div className="w-11 h-11 rounded-full bg-[#00d4c6]/15 text-[#00d4c6] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                Your video is ready!
              </p>
              <p className="text-xs text-[#8c92a0] mt-0.5">{safeFilename}</p>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <a
                href={progress.outputUrl}
                download={safeFilename}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00d4c6] hover:bg-[#18e3d5] text-[#091214] font-semibold text-xs"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </a>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[#232630] text-white hover:bg-[#2d313d] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {progress.status === 'error' && (
          <div className="space-y-4 py-2 text-center">
            <div className="w-11 h-11 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Export Failed</p>
              <p className="text-xs text-red-300 mt-1">{progress.error}</p>
            </div>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setProgress({ status: 'idle', progress: 0, message: '' })
                }
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[#232630] text-white hover:bg-[#2d313d] cursor-pointer"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-xs text-[#b0b5c0] hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
