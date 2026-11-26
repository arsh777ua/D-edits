export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function gainToDb(gain: number): number {
  if (gain <= 0.00001) return -100;
  return Math.round(clamp(20 * Math.log10(gain), -100, 20) * 10) / 10;
}

export function dbToGain(db: number): number {
  if (db <= -99.9) return 0;
  return Math.pow(10, clamp(db, -100, 20) / 20);
}

export function formatDb(db: number): string {
  if (db <= -99.9) return '-∞ dB';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

/**
 * Format seconds as MM:SS.ff (at 30fps display) or MM:SS.d
 */
export function formatTimecode(seconds: number, fps = 30): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe - Math.floor(safe)) * fps);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
