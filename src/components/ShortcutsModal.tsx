import { AlertTriangle, Keyboard, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  eventToShortcutString,
  formatShortcutDisplay,
  SHORTCUT_CATEGORIES,
  type ShortcutActionId,
  type ShortcutCategory,
  type ShortcutConfig,
} from '../utils/shortcuts';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutConfig[];
  onUpdateShortcut: (
    id: ShortcutActionId,
    newKey: string
  ) => { ok: boolean; conflictName?: string };
  onToggleEnabled: (id: ShortcutActionId) => void;
  onResetDefaults: () => void;
}

export function ShortcutsModal({
  open,
  onClose,
  shortcuts,
  onUpdateShortcut,
  onToggleEnabled,
  onResetDefaults,
}: ShortcutsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'All' | ShortcutCategory>('All');
  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        setCapturingId(null);
        setConflictMsg(null);
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Capture key combination when editing a shortcut
  useEffect(() => {
    if (!capturingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        setCapturingId(null);
        setConflictMsg(null);
        return;
      }

      const combo = eventToShortcutString(e);
      if (!combo) return;

      const res = onUpdateShortcut(capturingId, combo);
      if (!res.ok) {
        setConflictMsg(
          `Shortcut "${formatShortcutDisplay(combo)}" is already used by "${res.conflictName}".`
        );
      } else {
        setConflictMsg(null);
        setCapturingId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [capturingId, onUpdateShortcut]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shortcuts.filter((s) => {
      if (category !== 'All' && s.category !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    });
  }, [shortcuts, search, category]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-dialog-title"
      onClose={() => {
        setCapturingId(null);
        setConflictMsg(null);
        onClose();
      }}
      className="m-auto w-full max-w-2xl rounded-xl bg-[#181a20] border border-[#2a2d36] text-[#e8eaed] p-0 shadow-2xl"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#262932] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-[#00d4c6]" />
          <h1
            id="shortcuts-dialog-title"
            className="text-sm font-semibold text-white"
          >
            Keyboard Shortcuts
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCapturingId(null);
              setConflictMsg(null);
              onResetDefaults();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[#b0b5c0] hover:text-white hover:bg-[#232630] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="p-1 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search + Category Tabs */}
      <div className="px-5 pt-3.5 pb-2.5 border-b border-[#22252e] space-y-3 bg-[#14161b]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#7e8494] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shortcuts by action or key..."
            className="w-full bg-[#1e2028] border border-[#2a2d36] focus:border-[#00d4c6] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white outline-none"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {(['All', ...SHORTCUT_CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                category === cat
                  ? 'bg-[#00d4c6]/15 text-[#00d4c6]'
                  : 'text-[#8c92a0] hover:text-white hover:bg-[#1e2028]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {conflictMsg && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{conflictMsg}</span>
          </div>
        )}
      </div>

      {/* Shortcuts List */}
      <div className="max-h-[55vh] overflow-y-auto custom-scrollbar divide-y divide-[#22252e] px-5">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-[#6d7382]">
            No shortcuts match your search.
          </p>
        ) : (
          filtered.map((item) => {
            const isCapturing = capturingId === item.id;
            return (
              <div
                key={item.id}
                className="py-2.5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-medium ${
                      item.enabled ? 'text-white' : 'text-[#6d7382] line-through'
                    }`}
                  >
                    {item.name}
                  </p>
                  <p className="text-[10px] text-[#7e8494]">{item.category}</p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setConflictMsg(null);
                      setCapturingId(isCapturing ? null : item.id);
                    }}
                    title="Click to assign a new shortcut"
                    className={`min-w-[120px] px-2.5 py-1 rounded-md border text-xs font-mono text-center transition-colors cursor-pointer ${
                      isCapturing
                        ? 'bg-[#00d4c6]/15 border-[#00d4c6] text-[#00d4c6] animate-pulse'
                        : item.enabled
                          ? 'bg-[#1e2028] border-[#2a2d36] hover:border-[#00d4c6]/60 text-[#e8eaed]'
                          : 'bg-[#171920] border-[#22252e] text-[#6d7382]'
                    }`}
                  >
                    {isCapturing
                      ? 'Press your desired shortcut...'
                      : formatShortcutDisplay(item.key)}
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.enabled}
                    aria-label={`Toggle ${item.name}`}
                    onClick={() => onToggleEnabled(item.id)}
                    title={item.enabled ? 'Disable shortcut' : 'Enable shortcut'}
                    className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${
                      item.enabled ? 'bg-[#00d4c6]' : 'bg-[#2c303a]'
                    }`}
                  >
                    <span
                      className={`block w-3.5 h-3.5 rounded-full bg-[#0e0f12] transition-transform ${
                        item.enabled ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </dialog>
  );
}
