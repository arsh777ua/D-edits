import { useEffect, useState } from 'react';

const FALLBACK_SYSTEM_FONTS = [
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
];

let cachedFonts: string[] | null = null;

export async function fetchSystemFonts(): Promise<string[]> {
  if (cachedFonts && cachedFonts.length > 0) return cachedFonts;
  try {
    const res = await fetch('/api/system-fonts');
    if (res.ok) {
      const data = (await res.json()) as { fonts?: string[] };
      if (data.fonts && data.fonts.length > 0) {
        cachedFonts = data.fonts;
        return cachedFonts;
      }
    }
  } catch {
    // Fallback to standard Windows system fonts
  }
  return FALLBACK_SYSTEM_FONTS;
}

export function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>(
    () => cachedFonts ?? FALLBACK_SYSTEM_FONTS
  );

  useEffect(() => {
    let active = true;
    fetchSystemFonts().then((list) => {
      if (active) setFonts(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return fonts;
}
