export type ShortcutCategory =
  | 'General'
  | 'Timeline'
  | 'Playback'
  | 'Editing'
  | 'Navigation';

export type ShortcutActionId =
  | 'split'
  | 'rippleDeleteLeft'
  | 'rippleDeleteRight'
  | 'delete'
  | 'deleteKey'
  | 'playPause'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'selectAll'
  | 'prevFrame'
  | 'nextFrame'
  | 'prev10Frames'
  | 'next10Frames'
  | 'goToStart'
  | 'goToEnd'
  | 'zoomIn'
  | 'zoomOut'
  | 'deselect';

export interface ShortcutConfig {
  id: ShortcutActionId;
  name: string;
  category: ShortcutCategory;
  defaultKey: string;
  key: string;
  enabled: boolean;
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  'General',
  'Timeline',
  'Playback',
  'Editing',
  'Navigation',
];

export const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  { id: 'undo', name: 'Undo', category: 'General', defaultKey: 'Ctrl+Z', key: 'Ctrl+Z', enabled: true },
  { id: 'redo', name: 'Redo', category: 'General', defaultKey: 'Ctrl+Shift+Z', key: 'Ctrl+Shift+Z', enabled: true },
  { id: 'deselect', name: 'Deselect / Cancel', category: 'General', defaultKey: 'Escape', key: 'Escape', enabled: true },

  { id: 'selectAll', name: 'Select All Clips', category: 'Timeline', defaultKey: 'Ctrl+A', key: 'Ctrl+A', enabled: true },
  { id: 'zoomIn', name: 'Zoom In Timeline', category: 'Timeline', defaultKey: '+', key: '+', enabled: true },
  { id: 'zoomOut', name: 'Zoom Out Timeline', category: 'Timeline', defaultKey: '-', key: '-', enabled: true },

  { id: 'playPause', name: 'Play / Pause', category: 'Playback', defaultKey: 'Space', key: 'Space', enabled: true },

  { id: 'split', name: 'Split Clip at Playhead', category: 'Editing', defaultKey: 'E', key: 'E', enabled: true },
  { id: 'rippleDeleteLeft', name: 'Split & Delete Left (Ripple)', category: 'Editing', defaultKey: 'Q', key: 'Q', enabled: true },
  { id: 'rippleDeleteRight', name: 'Split & Delete Right (Ripple)', category: 'Editing', defaultKey: 'W', key: 'W', enabled: true },
  { id: 'delete', name: 'Delete Selected Clip', category: 'Editing', defaultKey: 'F', key: 'F', enabled: true },
  { id: 'deleteKey', name: 'Delete Selected Clip (Key)', category: 'Editing', defaultKey: 'Delete', key: 'Delete', enabled: true },
  { id: 'copy', name: 'Copy Selected Clip', category: 'Editing', defaultKey: 'Ctrl+C', key: 'Ctrl+C', enabled: true },
  { id: 'paste', name: 'Paste Clip', category: 'Editing', defaultKey: 'Ctrl+V', key: 'Ctrl+V', enabled: true },
  { id: 'duplicate', name: 'Duplicate Selected Clip', category: 'Editing', defaultKey: 'Ctrl+D', key: 'Ctrl+D', enabled: true },

  { id: 'prevFrame', name: 'Previous Frame', category: 'Navigation', defaultKey: 'ArrowLeft', key: 'ArrowLeft', enabled: true },
  { id: 'nextFrame', name: 'Next Frame', category: 'Navigation', defaultKey: 'ArrowRight', key: 'ArrowRight', enabled: true },
  { id: 'prev10Frames', name: 'Backward 10 Frames', category: 'Navigation', defaultKey: 'Shift+ArrowLeft', key: 'Shift+ArrowLeft', enabled: true },
  { id: 'next10Frames', name: 'Forward 10 Frames', category: 'Navigation', defaultKey: 'Shift+ArrowRight', key: 'Shift+ArrowRight', enabled: true },
  { id: 'goToStart', name: 'Go to Timeline Start', category: 'Navigation', defaultKey: 'Home', key: 'Home', enabled: true },
  { id: 'goToEnd', name: 'Go to Timeline End', category: 'Navigation', defaultKey: 'End', key: 'End', enabled: true },
];

const STORAGE_KEY = 'cutlite_shortcuts_v1';

export function loadShortcuts(): ShortcutConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
    const parsed = JSON.parse(raw) as Array<{ id: string; key: string; enabled: boolean }>;
    const map = new Map(parsed.map((p) => [p.id, p]));
    return DEFAULT_SHORTCUTS.map((def) => {
      const saved = map.get(def.id);
      if (!saved) return { ...def };
      return {
        ...def,
        key: typeof saved.key === 'string' && saved.key ? saved.key : def.defaultKey,
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
      };
    });
  } catch {
    return DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
  }
}

export function saveShortcuts(shortcuts: ShortcutConfig[]): void {
  try {
    const minimal = shortcuts.map(({ id, key, enabled }) => ({ id, key, enabled }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
  } catch {
    // ignore storage quota errors
  }
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt']);

/**
 * Converts a KeyboardEvent into a canonical shortcut string, e.g. "Ctrl+Shift+Z", "Space", "E".
 * Returns null if only a modifier key was pressed.
 */
export function eventToShortcutString(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let keyName = e.key;
  if (e.code === 'Space' || keyName === ' ') {
    keyName = 'Space';
  } else if (keyName === '=' || keyName === '+') {
    keyName = '+';
    // Strip Shift when user presses Shift+= for '+'
    const shiftIdx = parts.indexOf('Shift');
    if (shiftIdx !== -1 && parts.length === 1) parts.splice(shiftIdx, 1);
  } else if (keyName === '-' || keyName === '_') {
    keyName = '-';
  } else if (keyName.length === 1) {
    keyName = keyName.toUpperCase();
  }

  parts.push(keyName);
  return parts.join('+');
}

export function formatShortcutDisplay(combo: string): string {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);
  return combo
    .replace(/\bCtrl\b/g, isMac ? '⌘' : 'Ctrl')
    .replace(/\bArrowLeft\b/g, '←')
    .replace(/\bArrowRight\b/g, '→')
    .replace(/\bArrowUp\b/g, '↑')
    .replace(/\bArrowDown\b/g, '↓')
    .replace(/\bEscape\b/g, 'Esc');
}
