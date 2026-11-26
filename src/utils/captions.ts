import type {
  CaptionSegment,
  CaptionTemplateId,
  CaptionWord,
  TextClip,
} from '../types/editor';

export interface FormattedCaptionChunk {
  id: number;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export interface CaptionTemplateMeta {
  id: CaptionTemplateId;
  name: string;
  badge: string;
  defaultColor: string;
  defaultHighlightColor: string;
  defaultBgColor: string;
  defaultBgOpacity: number;
  defaultOutlineWidth: number;
}

export const CAPTION_TEMPLATES: CaptionTemplateMeta[] = [
  {
    id: 'none',
    name: 'Normal (No Template)',
    badge: 'Static',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#00d4c6',
    defaultBgColor: '#000000',
    defaultBgOpacity: 0,
    defaultOutlineWidth: 0,
  },
  {
    id: 'one-word-pop',
    name: '1. One-Word Pop',
    badge: '1 Word',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#fde047',
    defaultBgColor: '#000000',
    defaultBgOpacity: 0,
    defaultOutlineWidth: 3,
  },
  {
    id: 'one-word-box',
    name: '2. One-Word Pill',
    badge: '1 Word + Bg',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#00d4c6',
    defaultBgColor: '#111318',
    defaultBgOpacity: 0.85,
    defaultOutlineWidth: 0,
  },
  {
    id: 'phrase-box',
    name: '3. Phrase Box',
    badge: '2-3 Words + Bg',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#fde047',
    defaultBgColor: '#000000',
    defaultBgOpacity: 0.78,
    defaultOutlineWidth: 0,
  },
  {
    id: 'phrase-clean',
    name: '4. Phrase Clean',
    badge: '2-3 Words',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#00d4c6',
    defaultBgColor: '#000000',
    defaultBgOpacity: 0,
    defaultOutlineWidth: 2,
  },
  {
    id: 'phrase-highlight',
    name: '5. Word Highlight',
    badge: 'Karaoke',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#fde047',
    defaultBgColor: '#000000',
    defaultBgOpacity: 0,
    defaultOutlineWidth: 2.5,
  },
  {
    id: 'phrase-highlight-box',
    name: '6. Highlight Pill',
    badge: 'Karaoke + Bg',
    defaultColor: '#e8eaed',
    defaultHighlightColor: '#00d4c6',
    defaultBgColor: '#111318',
    defaultBgOpacity: 0.85,
    defaultOutlineWidth: 0,
  },
  {
    id: 'neon-glow',
    name: '7. Neon Glow',
    badge: 'Bounce',
    defaultColor: '#00f5e4',
    defaultHighlightColor: '#ffffff',
    defaultBgColor: '#000000',
    defaultBgOpacity: 0,
    defaultOutlineWidth: 1.5,
  },
  {
    id: 'typewriter-wave',
    name: '8. Word Reveal',
    badge: 'Sequential',
    defaultColor: '#ffffff',
    defaultHighlightColor: '#f472b6',
    defaultBgColor: '#14161b',
    defaultBgOpacity: 0.75,
    defaultOutlineWidth: 0,
  },
];

export function formatCaptionChunks(
  segments: CaptionSegment[],
  maxLines: number,
  maxCharsPerLine: number,
  templateId: CaptionTemplateId = 'none'
): FormattedCaptionChunk[] {
  const safeLines = Math.max(1, Math.min(6, Math.round(maxLines)));
  const safeChars = Math.max(4, Math.min(80, Math.round(maxCharsPerLine)));
  const out: FormattedCaptionChunk[] = [];
  let nextId = 1;

  const isOneWord =
    templateId === 'one-word-pop' || templateId === 'one-word-box';
  const isPhrase =
    templateId !== 'none' && !isOneWord;

  for (const seg of segments) {
    const words: CaptionWord[] =
      seg.words && seg.words.length > 0
        ? seg.words.filter((w) => w.word.trim().length > 0)
        : synthesizeWordTimings(seg.text, seg.start, seg.end);

    if (words.length === 0) continue;

    if (isOneWord) {
      for (const w of words) {
        const token = w.word.trim();
        if (!token) continue;
        out.push({
          id: nextId++,
          start: w.start,
          end: Math.max(w.start + 0.14, w.end),
          text: token,
          words: [w],
        });
      }
      continue;
    }

    if (isPhrase) {
      // Group 2-3 words per chunk
      for (let i = 0; i < words.length; i += 3) {
        const slice = words.slice(i, i + 3);
        const text = slice.map((w) => w.word.trim()).join(' ');
        const start = slice[0].start;
        const end = slice[slice.length - 1].end;
        out.push({
          id: nextId++,
          start,
          end: Math.max(start + 0.2, end),
          text,
          words: slice,
        });
      }
      continue;
    }

    // Normal ('none'): respect maxLines & maxCharsPerLine
    let lines: string[] = [''];
    let chunkWords: CaptionWord[] = [];
    let chunkStart = words[0].start;
    let chunkEnd = words[0].end;

    const flush = () => {
      const text = lines
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
      if (text) {
        out.push({
          id: nextId++,
          start: chunkStart,
          end: Math.max(chunkStart + 0.15, chunkEnd),
          text,
          words: chunkWords,
        });
      }
    };

    for (const w of words) {
      const token = w.word.trim();
      const lastIdx = lines.length - 1;
      const currentLine = lines[lastIdx];
      const candidate = currentLine ? `${currentLine} ${token}` : token;

      if (candidate.length <= safeChars || currentLine.length === 0) {
        lines[lastIdx] = candidate;
        chunkWords.push(w);
        chunkEnd = w.end;
      } else if (lines.length < safeLines) {
        lines.push(token);
        chunkWords.push(w);
        chunkEnd = w.end;
      } else {
        flush();
        lines = [token];
        chunkWords = [w];
        chunkStart = w.start;
        chunkEnd = w.end;
      }
    }

    flush();
  }

  return out;
}

function synthesizeWordTimings(
  text: string,
  start: number,
  end: number
): CaptionWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const totalDur = Math.max(0.2, end - start);
  const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
  let cursor = start;

  return tokens.map((word) => {
    const dur = (word.length / totalChars) * totalDur;
    const wStart = cursor;
    const wEnd = cursor + dur;
    cursor = wEnd;
    return { word, start: wStart, end: wEnd };
  });
}

export interface EvaluatedCaptionState {
  scale: number;
  translateY: number;
  opacity: number;
  activeWordIndex: number;
  hasBackground: boolean;
  isHighlightTemplate: boolean;
  isSequentialReveal: boolean;
  isNeon: boolean;
}

/**
 * Computes animation transform, opacity, and active word index at `playhead`
 * identically for both PreviewPlayer and Canvas Exporter.
 */
export function evaluateCaptionAnimation(
  clip: TextClip,
  playhead: number
): EvaluatedCaptionState {
  const tpl = clip.captionTemplate ?? 'none';
  const localTime = Math.max(0, playhead - clip.startTime);

  const hasBackground =
    tpl === 'one-word-box' ||
    tpl === 'phrase-box' ||
    tpl === 'phrase-highlight-box' ||
    tpl === 'typewriter-wave' ||
    (clip.bgOpacity ?? 0) > 0;

  const isHighlightTemplate =
    tpl === 'phrase-highlight' ||
    tpl === 'phrase-highlight-box' ||
    tpl === 'typewriter-wave';

  const isSequentialReveal = tpl === 'typewriter-wave';
  const isNeon = tpl === 'neon-glow';

  // Determine active word index
  let activeWordIndex = -1;
  if (clip.words && clip.words.length > 0) {
    for (let i = 0; i < clip.words.length; i++) {
      if (playhead >= clip.words[i].start - 0.03) {
        activeWordIndex = i;
      }
    }
    if (activeWordIndex === -1) activeWordIndex = 0;
  } else {
    const tokens = clip.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const progress = Math.min(0.999, localTime / Math.max(0.2, clip.duration));
      activeWordIndex = Math.floor(progress * tokens.length);
    }
  }

  if (tpl === 'none') {
    return {
      scale: 1,
      translateY: 0,
      opacity: 1,
      activeWordIndex,
      hasBackground,
      isHighlightTemplate: false,
      isSequentialReveal: false,
      isNeon: false,
    };
  }

  // Smooth pop-in / slide-up over first 140ms
  const t = Math.min(1, localTime / 0.14);
  const easeOutBack = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const easeOutCubic = 1 - Math.pow(1 - t, 3);

  let scale = 1;
  let translateY = 0;
  const opacity = Math.min(1, localTime / 0.08);

  if (tpl === 'one-word-pop' || tpl === 'one-word-box' || tpl === 'neon-glow') {
    scale = 0.72 + 0.28 * easeOutBack;
  } else {
    scale = 0.92 + 0.08 * easeOutCubic;
    translateY = (1 - easeOutCubic) * 10;
  }

  return {
    scale,
    translateY,
    opacity,
    activeWordIndex,
    hasBackground,
    isHighlightTemplate,
    isSequentialReveal,
    isNeon,
  };
}
