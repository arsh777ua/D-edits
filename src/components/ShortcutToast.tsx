import { formatShortcutDisplay } from '../utils/shortcuts';

interface ShortcutToastProps {
  toast: { id: number; key: string; label: string } | null;
}

export function ShortcutToast({ toast }: ShortcutToastProps) {
  if (!toast) return null;

  return (
    <div
      key={toast.id}
      aria-live="polite"
      className="fixed bottom-64 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#181a20]/95 border border-[#2e323d] shadow-xl text-xs text-white"
    >
      <kbd className="px-1.5 py-0.5 rounded bg-[#00d4c6]/15 text-[#00d4c6] font-mono text-[11px] font-semibold">
        {formatShortcutDisplay(toast.key)}
      </kbd>
      <span className="text-[#d0d4dc]">{toast.label}</span>
    </div>
  );
}
