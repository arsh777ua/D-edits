import {
  Check,
  Download,
  Home,
  Keyboard,
  Redo2,
  Save,
  Scissors,
  Settings,
  Undo2,
} from 'lucide-react';
import { useState } from 'react';

interface TopBarProps {
  projectName: string;
  onRenameProject: (name: string) => void;
  onGoHome: () => void;
  onSaveProject: () => void;
  lastSavedAt: number | null;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenProjectSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenExport: () => void;
  hasClips: boolean;
}

export function TopBar({
  projectName,
  onRenameProject,
  onGoHome,
  onSaveProject,
  lastSavedAt,
  isSaving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenProjectSettings,
  onOpenShortcuts,
  onOpenExport,
  hasClips,
}: TopBarProps) {
  const [isEditingName, setIsEditingName] = useState(false);

  return (
    <header className="h-12 shrink-0 bg-[#14161b] border-b border-[#262932] px-3 flex items-center justify-between gap-4">
      {/* Left: Home + Logo + Project Name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onGoHome}
          title="Return to Home Screen"
          aria-label="Home Screen"
          className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer shrink-0"
        >
          <Home className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#00d4c6] text-[#091214] flex items-center justify-center shadow-sm">
            <Scissors className="w-4 h-4 stroke-[2.4]" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-white hidden sm:inline">
            CutLite
          </span>
        </div>

        <div className="h-4 w-px bg-[#2a2d36]" />

        {isEditingName ? (
          <input
            type="text"
            value={projectName}
            autoFocus
            onChange={(e) => onRenameProject(e.target.value)}
            onBlur={() => {
              if (!projectName.trim()) onRenameProject('Untitled Project');
              setIsEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                if (!projectName.trim()) onRenameProject('Untitled Project');
                setIsEditingName(false);
              }
            }}
            className="bg-[#1e2028] border border-[#00d4c6]/60 rounded px-2 py-0.5 text-xs text-white outline-none w-44"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingName(true)}
            title="Click to rename project"
            className="text-xs text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] px-2 py-1 rounded transition-colors truncate max-w-[200px]"
          >
            {projectName}
          </button>
        )}
      </div>

      {/* Center: Undo / Redo */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>

      {/* Right: Save + Settings + Shortcuts + Export */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSaveProject}
          title={
            lastSavedAt
              ? `Last saved at ${new Date(lastSavedAt).toLocaleTimeString()}`
              : 'Save Project'
          }
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-[#9aa0ad] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer"
        >
          {isSaving ? (
            <Save className="w-3.5 h-3.5 text-[#00d4c6] animate-pulse" />
          ) : (
            <Check className="w-3.5 h-3.5 text-[#00d4c6]" />
          )}
          <span className="hidden md:inline">
            {isSaving
              ? 'Saving...'
              : lastSavedAt
                ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Save'}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenProjectSettings}
          title="Project Settings"
          aria-label="Project Settings"
          className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts"
          aria-label="Keyboard Shortcuts"
          className="p-1.5 rounded-md text-[#b0b5c0] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer"
        >
          <Keyboard className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onOpenExport}
          disabled={!hasClips}
          title={hasClips ? 'Export video as MP4' : 'Add clips to timeline to export'}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#00d4c6] hover:bg-[#18e3d5] active:bg-[#00bfb3] text-[#091214] font-semibold text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 stroke-[2.4]" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
}
