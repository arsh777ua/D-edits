import { AlertTriangle, FolderOpen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  AspectRatioPreset,
  FrameRateOption,
  PreviewBackground,
  ProjectSettings,
  ResolutionPreset,
} from '../types/editor';
import {
  ASPECT_RATIO_PRESETS,
  computeDimensions,
  DEFAULT_PROJECT_SETTINGS,
  formatAspectRatio,
  FRAME_RATES,
  RESOLUTION_PRESETS,
} from '../utils/projectConfig';
import {
  fetchDefaultProjectLocation,
  pickLocalFolder,
} from '../utils/projectStorage';

interface ProjectConfigModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialSettings?: ProjectSettings;
  hasClips?: boolean;
  onClose: () => void;
  onConfirm: (
    name: string,
    settings: ProjectSettings,
    folderHandle?: FileSystemDirectoryHandle
  ) => void;
}

export function ProjectConfigModal({
  open,
  mode,
  initialName = 'Untitled Project',
  initialSettings = DEFAULT_PROJECT_SETTINGS,
  hasClips = false,
  onClose,
  onConfirm,
}: ProjectConfigModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState(initialName);
  const [settings, setSettings] = useState<ProjectSettings>(initialSettings);
  const [folderHandle, setFolderHandle] = useState<
    FileSystemDirectoryHandle | undefined
  >(undefined);
  const [showEditConfirm, setShowEditConfirm] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'create') return;
    let active = true;
    void fetchDefaultProjectLocation().then((resolved) => {
      if (active && resolved) {
        setSettings((s) => ({ ...s, locationLabel: resolved }));
      }
    });
    return () => {
      active = false;
    };
  }, [open, mode]);

  const handleResolutionChange = (res: ResolutionPreset) => {
    const dims = computeDimensions(
      res,
      settings.aspectRatioPreset,
      settings.width,
      settings.height
    );
    setSettings((s) => ({
      ...s,
      resolutionPreset: res,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleAspectRatioChange = (ar: AspectRatioPreset) => {
    const dims = computeDimensions(
      settings.resolutionPreset,
      ar,
      settings.width,
      settings.height
    );
    setSettings((s) => ({
      ...s,
      aspectRatioPreset: ar,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleCustomDim = (field: 'width' | 'height', raw: number) => {
    const val = Number.isFinite(raw) ? Math.max(128, Math.min(7680, raw)) : 1280;
    setSettings((s) => ({
      ...s,
      resolutionPreset: 'custom',
      [field]: val,
    }));
  };

  const handlePickFolder = async () => {
    const picked = await pickLocalFolder();
    if (picked) {
      setFolderHandle(picked.handle);
      setSettings((s) => ({ ...s, locationLabel: picked.name }));
    }
  };

  const handleSubmit = () => {
    const finalName = name.trim() || 'Untitled Project';
    const validSettings: ProjectSettings = {
      ...settings,
      width: Math.max(128, Math.min(7680, Math.round(settings.width))),
      height: Math.max(128, Math.min(7680, Math.round(settings.height))),
    };

    if (
      mode === 'edit' &&
      hasClips &&
      !showEditConfirm &&
      (validSettings.width !== initialSettings.width ||
        validSettings.height !== initialSettings.height ||
        validSettings.fps !== initialSettings.fps)
    ) {
      setShowEditConfirm(true);
      return;
    }

    onConfirm(finalName, validSettings, folderHandle);
  };

  const computedAspect = formatAspectRatio(settings.width, settings.height);
  const previewRatio = settings.width / Math.max(1, settings.height);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="project-config-title"
      onClose={onClose}
      className="m-auto w-full max-w-2xl rounded-xl bg-[#181a20] border border-[#2a2d36] text-[#e8eaed] p-0 shadow-2xl"
    >
      <div className="px-5 py-3.5 border-b border-[#262932] flex items-center justify-between">
        <h1
          id="project-config-title"
          className="text-sm font-semibold text-white"
        >
          {mode === 'create' ? 'Create New Project' : 'Project Settings'}
        </h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="p-1 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
        {/* Project Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#b0b5c0] block">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled Project"
            className="w-full bg-[#121419] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg px-3 py-2 text-xs text-white outline-none"
          />
        </div>

        {/* Resolution Presets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#b0b5c0]">Resolution</span>
            <span className="text-[11px] font-mono text-[#00d4c6]">
              {settings.width} × {settings.height} ({computedAspect})
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {RESOLUTION_PRESETS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleResolutionChange(r.id)}
                className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                  settings.resolutionPreset === r.id
                    ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-white'
                    : 'bg-[#121419] border-[#262932] text-[#9aa0ad] hover:text-white'
                }`}
              >
                <div className="text-xs font-semibold">{r.label}</div>
                <div className="text-[10px] opacity-75">{r.sublabel}</div>
              </button>
            ))}
          </div>

          {(settings.resolutionPreset === 'custom' ||
            settings.aspectRatioPreset === 'custom') && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-[11px] text-[#8c92a0] block">
                  Width (px)
                </label>
                <input
                  type="number"
                  min={128}
                  max={7680}
                  step={2}
                  value={settings.width}
                  onChange={(e) =>
                    handleCustomDim('width', Number(e.target.value))
                  }
                  className="w-full bg-[#121419] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[#8c92a0] block">
                  Height (px)
                </label>
                <input
                  type="number"
                  min={128}
                  max={7680}
                  step={2}
                  value={settings.height}
                  onChange={(e) =>
                    handleCustomDim('height', Number(e.target.value))
                  }
                  className="w-full bg-[#121419] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Aspect Ratio + Visual Preview */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-[#b0b5c0] block">
            Aspect Ratio
          </span>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <div className="flex-1 grid grid-cols-3 gap-2">
              {ASPECT_RATIO_PRESETS.map((ar) => (
                <button
                  key={ar.id}
                  type="button"
                  onClick={() => handleAspectRatioChange(ar.id)}
                  className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    settings.aspectRatioPreset === ar.id
                      ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-white'
                      : 'bg-[#121419] border-[#262932] text-[#9aa0ad] hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold">{ar.label}</div>
                  <div className="text-[10px] opacity-75 truncate">
                    {ar.description}
                  </div>
                </button>
              ))}
            </div>

            <div className="w-full sm:w-28 rounded-lg bg-[#121419] border border-[#262932] p-2 flex flex-col items-center justify-center gap-1.5 shrink-0">
              <div className="w-16 h-16 flex items-center justify-center">
                <div
                  className="border-2 border-[#00d4c6] bg-[#00d4c6]/10 rounded-xs"
                  style={{
                    width: previewRatio >= 1 ? '56px' : `${Math.max(18, 56 * previewRatio)}px`,
                    height: previewRatio <= 1 ? '56px' : `${Math.max(18, 56 / previewRatio)}px`,
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-[#8c92a0]">
                {computedAspect}
              </span>
            </div>
          </div>
        </div>

        {/* Frame Rate */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-[#b0b5c0] block">
            Frame Rate
          </span>
          <div className="grid grid-cols-5 gap-2">
            {FRAME_RATES.map((fps: FrameRateOption) => (
              <button
                key={fps}
                type="button"
                onClick={() => setSettings((s) => ({ ...s, fps }))}
                className={`py-2 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                  settings.fps === fps
                    ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6] font-semibold'
                    : 'bg-[#121419] border-[#262932] text-[#9aa0ad] hover:text-white'
                }`}
              >
                {fps} FPS
              </button>
            ))}
          </div>
        </div>

        {/* Project Location + Background */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[#b0b5c0] block">
              Project Location
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settings.locationLabel}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, locationLabel: e.target.value }))
                }
                placeholder="Documents\\CutLite Projects"
                className="flex-1 min-w-0 bg-[#121419] border border-[#262932] focus:border-[#00d4c6] rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-white outline-none"
              />
              <button
                type="button"
                onClick={handlePickFolder}
                title="Choose local folder"
                className="px-2.5 py-1.5 rounded-lg bg-[#232630] hover:bg-[#2d313d] text-xs text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#00d4c6]" />
                <span>Browse</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[#b0b5c0] block">
              Preview Background
            </span>
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: 'black', label: 'Black' },
                  { id: 'checkerboard', label: 'Checker' },
                  { id: 'custom', label: 'Color' },
                ] as Array<{ id: PreviewBackground; label: string }>
              ).map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() =>
                    setSettings((s) => ({ ...s, previewBackground: bg.id }))
                  }
                  className={`flex-1 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                    settings.previewBackground === bg.id
                      ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-white'
                      : 'bg-[#121419] border-[#262932] text-[#9aa0ad] hover:text-white'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
              {settings.previewBackground === 'custom' && (
                <input
                  type="color"
                  value={settings.previewBackgroundColor}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      previewBackgroundColor: e.target.value,
                    }))
                  }
                  className="w-8 h-8 rounded border border-[#2a2d36] bg-transparent cursor-pointer shrink-0"
                />
              )}
            </div>
          </div>
        </div>

        {/* Confirmation banner when modifying resolution/FPS on an active timeline */}
        {showEditConfirm && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300">
                Confirm Project Settings Update
              </p>
              <p className="text-[11px] text-amber-200/90 mt-0.5">
                Changing resolution or frame rate will update the preview and
                export settings. Existing clip timing and footage will not be
                stretched or altered. Click &ldquo;Apply Changes&rdquo; to confirm.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-[#262932] flex justify-end gap-2 bg-[#14161b]">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-xs font-medium text-[#b0b5c0] hover:text-white hover:bg-[#232630] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={handleSubmit}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#00d4c6] hover:bg-[#18e3d5] text-[#091214] cursor-pointer"
        >
          {mode === 'create'
            ? 'Create Project'
            : showEditConfirm
              ? 'Apply Changes'
              : 'Save Settings'}
        </button>
      </div>
    </dialog>
  );
}
