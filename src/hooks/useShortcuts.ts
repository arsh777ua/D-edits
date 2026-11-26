import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_SHORTCUTS,
  loadShortcuts,
  saveShortcuts,
  type ShortcutActionId,
  type ShortcutConfig,
} from '../utils/shortcuts';

export function useShortcuts() {
  const [shortcuts, setShortcuts] = useState<ShortcutConfig[]>(() => loadShortcuts());

  const updateShortcutKey = useCallback(
    (id: ShortcutActionId, newKey: string): { ok: boolean; conflictName?: string } => {
      const conflict = shortcuts.find(
        (s) => s.id !== id && s.enabled && s.key.toLowerCase() === newKey.toLowerCase()
      );
      if (conflict) {
        return { ok: false, conflictName: conflict.name };
      }

      setShortcuts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, key: newKey, enabled: true } : s));
        saveShortcuts(next);
        return next;
      });
      return { ok: true };
    },
    [shortcuts]
  );

  const toggleShortcutEnabled = useCallback((id: ShortcutActionId) => {
    setShortcuts((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      // If re-enabling, check for conflict with another enabled shortcut
      if (!target.enabled) {
        const conflict = prev.find(
          (s) => s.id !== id && s.enabled && s.key.toLowerCase() === target.key.toLowerCase()
        );
        if (conflict) return prev;
      }
      const next = prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      saveShortcuts(next);
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    const fresh = DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
    setShortcuts(fresh);
    saveShortcuts(fresh);
  }, []);

  const keyToActionMap = useMemo(() => {
    const map = new Map<string, ShortcutConfig>();
    for (const s of shortcuts) {
      if (s.enabled && !map.has(s.key.toLowerCase())) {
        map.set(s.key.toLowerCase(), s);
      }
    }
    return map;
  }, [shortcuts]);

  return {
    shortcuts,
    keyToActionMap,
    updateShortcutKey,
    toggleShortcutEnabled,
    resetToDefaults,
  };
}
