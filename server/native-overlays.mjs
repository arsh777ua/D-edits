import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

let fontsLoaded = false;
export function ensureSystemFontsLoaded() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  try {
    GlobalFonts.loadSystemFonts();
  } catch {
    // Ignore if unavailable
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hexToRgba(hex, alpha = 1) {
  const clean = (hex || '#000000').replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const r = parseInt(full.slice(0, 2) || '00', 16);
  const g = parseInt(full.slice(2, 4) || '00', 16);
  const b = parseInt(full.slice(4, 6) || '00', 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function cleanFontName(fontFamily) {
  return (fontFamily || 'Segoe UI').split(',')[0].replace(/['"]/g, '').trim() || 'Segoe UI';
}

function applyEasing(t, easing) {
  const x = clamp(t, 0, 1);
  switch (easing) {
    case 'linear':
      return x;
    case 'ease-out':
      return 1 - Math.pow(1 - x, 3);
    case 'ease-in-out':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'back-out': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case 'elastic': {
      if (x === 0 || x === 1) return x;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    }
    default:
      return x;
  }
}

function evaluateCaptionAnimation(clip, time) {
  const tpl = clip.captionTemplate ?? 'none';
  const elapsed = Math.max(0, time - clip.startTime);
  const dur = Math.max(0.1, clip.duration);
  const tokens = (clip.text || '').trim().split(/\s+/).filter(Boolean);

  let activeWordIndex = -1;
  if (tokens.length > 0) {
    if (clip.words && clip.words.length > 0) {
      const found = clip.words.findIndex((w) => time >= w.start && time <= w.end);
      if (found !== -1) {
        activeWordIndex = Math.min(tokens.length - 1, found);
      } else {
        let last = 0;
        for (let i = 0; i < clip.words.length; i++) {
          if (time >= clip.words[i].start) last = i;
        }
        activeWordIndex = Math.min(tokens.length - 1, last);
      }
    } else {
      const ratio = clamp(elapsed / dur, 0, 0.999);
      activeWordIndex = Math.floor(ratio * tokens.length);
    }
  }

  let scale = 1;
  let opacity = 1;
  let translateY = 0;

  if (tpl === 'one-word-pop' || tpl === 'one-word-box') {
    const t = Math.min(1, elapsed / 0.14);
    const ease = 1 - Math.pow(1 - t, 3);
    scale = 0.78 + 0.22 * ease;
    opacity = Math.min(1, elapsed / 0.06);
  } else if (tpl === 'phrase-box' || tpl === 'phrase-clean') {
    const t = Math.min(1, elapsed / 0.16);
    const ease = 1 - Math.pow(1 - t, 3);
    translateY = (1 - ease) * 10;
    opacity = Math.min(1, elapsed / 0.1);
  } else if (tpl === 'neon-glow') {
    const t = Math.min(1, elapsed / 0.14);
    scale = 0.92 + 0.08 * t;
    opacity = Math.min(1, elapsed / 0.08);
  } else if (tpl === 'typewriter-wave') {
    opacity = Math.min(1, elapsed / 0.08);
  }

  return {
    scale,
    opacity,
    translateY,
    activeWordIndex,
    isHighlightTemplate:
      tpl === 'phrase-highlight' ||
      tpl === 'phrase-highlight-box' ||
      tpl === 'typewriter-wave',
    isSequentialReveal: tpl === 'typewriter-wave',
    hasBackground:
      tpl === 'one-word-box' ||
      tpl === 'phrase-box' ||
      tpl === 'phrase-highlight-box',
    isNeon: tpl === 'neon-glow',
  };
}

function drawMovingGridBackdrop(ctx, boxW, boxH, resScale, elapsed, clip) {
  const { visual, specific } = clip;
  ctx.save();
  ctx.fillStyle = hexToRgba(
    visual?.backgroundColor || '#000000',
    visual?.backgroundOpacity ?? 1
  );
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);

  const step = Math.max(16, (specific?.gridSize ?? 48) * resScale);
  const speed = specific?.gridSpeed ?? 1;
  const gOpacity = specific?.gridOpacity ?? 0.22;
  const shiftX = (elapsed * 34 * speed * resScale) % step;
  const shiftY = (elapsed * 20 * speed * resScale) % step;

  ctx.strokeStyle = hexToRgba(visual?.secondaryColor || '#ffffff', gOpacity);
  ctx.lineWidth = Math.max(1, resScale);

  for (let gx = -boxW / 2 - step + shiftX; gx <= boxW / 2 + step; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, -boxH / 2);
    ctx.lineTo(gx, boxH / 2);
    ctx.stroke();
  }
  for (let gy = -boxH / 2 - step + shiftY; gy <= boxH / 2 + step; gy += step) {
    ctx.beginPath();
    ctx.moveTo(-boxW / 2, gy);
    ctx.lineTo(boxW / 2, gy);
    ctx.stroke();
  }

  const vig = ctx.createRadialGradient(0, 0, boxW * 0.15, 0, 0, boxW * 0.65);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.restore();
}

function drawGraphicTextLayer(ctx, layer, w, h, resScale, overrideText) {
  if (!layer.visible) return;
  const rawText = overrideText ?? layer.text ?? '';
  if (!rawText) return;

  const fontSize = (layer.fontSize ?? 36) * resScale;
  const weight = layer.fontWeight ?? 700;
  const family = cleanFontName(layer.fontFamily);
  const align = layer.textAlign ?? 'center';
  const lineHeight = (layer.lineHeight ?? 1.2) * fontSize;
  const letterSpacing = (layer.letterSpacing ?? 0) * resScale;

  ctx.save();
  ctx.font = `${weight} ${fontSize}px "${family}"`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${letterSpacing}px`;
  }

  const lx = ((layer.x ?? 0) / 100) * w;
  const ly = ((layer.y ?? 0) / 100) * h;
  ctx.translate(lx, ly);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
  const lScale = layer.scale ?? 1;
  ctx.scale(lScale, lScale);
  ctx.globalAlpha *= layer.opacity ?? 1;

  const lines = rawText.split('\n');
  const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width), fontSize);
  const totalH = lines.length * lineHeight;

  if ((layer.bgOpacity ?? 0) > 0) {
    const padX = 16 * resScale;
    const padY = 8 * resScale;
    const bx =
      align === 'left'
        ? -padX
        : align === 'right'
          ? -maxW - padX
          : -maxW / 2 - padX;
    ctx.save();
    ctx.fillStyle = hexToRgba(layer.bgColor ?? '#000000', layer.bgOpacity ?? 0.8);
    ctx.beginPath();
    ctx.roundRect(
      bx,
      -totalH / 2 - padY,
      maxW + padX * 2,
      totalH + padY * 2,
      8 * resScale
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = layer.color ?? '#ffffff';
  const startY = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, startY + i * lineHeight);
  });
  ctx.restore();
}

function renderGraphicClip(ctx, width, height, time, clip) {
  const elapsed = Math.max(0, time - clip.startTime);
  const resScale = height / 720;
  const { visual, transform, animation, specific } = clip;

  const speed = Math.max(0.2, animation?.speed || 1);
  const t = Math.max(0, (elapsed - (animation?.delay || 0)) * speed);
  const entDur = Math.max(0.05, animation?.entranceDuration || 0.5);
  const exitDur = Math.max(0.05, animation?.exitDuration || 0.4);
  const entRaw = clamp(t / entDur, 0, 1);
  const ent = applyEasing(entRaw, animation?.easing || 'ease-out');
  const timeLeft = Math.max(0, clip.duration - elapsed);
  const exitRaw =
    animation?.exit === 'none' ? 0 : clamp(1 - timeLeft / exitDur, 0, 1);
  const exit = applyEasing(exitRaw, 'ease-in-out');

  let opacity = 1;
  if (animation?.entrance === 'fade' || animation?.entrance === 'blur-in') opacity *= ent;
  if (animation?.exit && animation.exit !== 'none') opacity *= 1 - exit;

  if (opacity <= 0.002) return;

  ctx.save();
  ctx.globalAlpha = clamp((visual?.opacity ?? 1) * opacity, 0, 1);
  const cx = width / 2 + ((transform?.x ?? 0) / 100) * width;
  const cy = height / 2 + ((transform?.y ?? 0) / 100) * height;
  const boxW = (width * (transform?.width ?? 100)) / 100;
  const boxH = (height * (transform?.height ?? 100)) / 100;

  ctx.translate(cx, cy);
  ctx.rotate(((transform?.rotation ?? 0) * Math.PI) / 180);
  ctx.scale(transform?.scaleX ?? 1, transform?.scaleY ?? 1);

  if ((visual?.glowIntensity ?? 0) > 0) {
    ctx.shadowColor = visual.primaryColor || '#00d4c6';
    ctx.shadowBlur = visual.glowIntensity * resScale;
  } else if ((visual?.shadowBlur ?? 0) > 0) {
    ctx.shadowColor = visual.shadowColor || 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = visual.shadowBlur * resScale;
    ctx.shadowOffsetY = 4 * resScale;
  }

  const textLayers = (clip.layers || []).filter((l) => l.type === 'text' && l.visible);

  if (clip.templateId === 'moving-grid-pop-text') {
    drawMovingGridBackdrop(ctx, boxW, boxH, resScale, elapsed, clip);
    const mainLayer = textLayers[0];
    if (mainLayer && mainLayer.text) {
      const fontSize = (mainLayer.fontSize ?? 60) * resScale;
      const weight = mainLayer.fontWeight ?? 800;
      const family = cleanFontName(mainLayer.fontFamily);
      const letterSpacing = (mainLayer.letterSpacing ?? 3) * resScale;
      const stagger = Math.max(0.06, animation?.stagger || 0.28);
      const popDur = Math.max(0.12, animation?.entranceDuration || 0.35);

      ctx.save();
      ctx.font = `${weight} ${fontSize}px "${family}"`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = `${letterSpacing}px`;
      }

      const lx = ((mainLayer.x ?? 0) / 100) * boxW;
      const ly = ((mainLayer.y ?? 0) / 100) * boxH;
      ctx.translate(lx, ly);

      if (specific?.popMode === 'line-by-line') {
        const lines = mainLayer.text
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          const slot = Math.max(0.35, clip.duration / lines.length);
          const activeIdx = Math.min(lines.length - 1, Math.floor(elapsed / slot));
          const localT = elapsed - activeIdx * slot;
          const p = applyEasing(clamp(localT / popDur, 0, 1), animation?.easing || 'back-out');
          const lineText = lines[activeIdx];
          const measured = ctx.measureText(lineText).width;
          const fit = measured > boxW * 0.88 ? (boxW * 0.88) / measured : 1;

          ctx.scale(fit * (0.55 + 0.45 * p), fit * (0.55 + 0.45 * p));
          ctx.globalAlpha *= clamp(p * 1.4, 0, 1);
          ctx.fillStyle = mainLayer.color ?? '#ffffff';
          ctx.fillText(lineText, 0, 0);
        }
      } else {
        const singleLine = mainLayer.text.replace(/\s+/g, ' ').trim();
        const words = singleLine.split(' ').filter(Boolean);
        if (words.length > 0) {
          const spaceW = ctx.measureText(' ').width * 1.15;
          const widths = words.map((w) => ctx.measureText(w).width);
          const totalW =
            widths.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * spaceW;
          const fit = totalW > boxW * 0.9 ? (boxW * 0.9) / totalW : 1;
          ctx.scale(fit, fit);

          let cursorX = -totalW / 2;
          words.forEach((word, idx) => {
            const w = widths[idx];
            const wordT = clamp((elapsed - idx * stagger) / popDur, 0, 1);
            const eased = applyEasing(wordT, animation?.easing || 'back-out');
            if (eased > 0.01) {
              ctx.save();
              ctx.translate(cursorX + w / 2, (1 - eased) * 18 * resScale);
              const popS = 0.5 + 0.5 * eased;
              ctx.scale(popS, popS);
              ctx.globalAlpha *= clamp(wordT * 1.6, 0, 1);
              ctx.fillStyle = mainLayer.color ?? '#ffffff';
              ctx.fillText(word, 0, 0);
              ctx.restore();
            }
            cursorX += w + spaceW;
          });
        }
      }
      ctx.restore();
    }
  } else if (clip.templateId === 'moving-grid-counter') {
    drawMovingGridBackdrop(ctx, boxW, boxH, resScale, elapsed, clip);
    const fromVal = specific?.countFrom ?? 0;
    const toVal = specific?.countTo ?? 1000;
    const countDur = Math.max(0.1, specific?.countDuration ?? 2.4);
    const decimals = Math.max(0, Math.min(4, Math.round(specific?.countDecimals ?? 0)));
    const prefix = specific?.countPrefix ?? '';
    const suffix = specific?.countSuffix ?? '';

    const rawProg = clamp(elapsed / countDur, 0, 1);
    const easedProg = applyEasing(rawProg, animation?.easing || 'ease-out');
    const currentVal = fromVal + (toVal - fromVal) * easedProg;
    const formatted = currentVal.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const displayStr = `${prefix}${formatted}${suffix}`;

    const arriveElapsed = elapsed - countDur;
    const arrivalPop =
      arriveElapsed >= 0 && arriveElapsed < 0.35
        ? 1 + Math.sin((arriveElapsed / 0.35) * Math.PI) * 0.12
        : 1;

    if (textLayers[0]) {
      ctx.save();
      ctx.scale(arrivalPop, arrivalPop);
      drawGraphicTextLayer(ctx, textLayers[0], boxW, boxH, resScale, displayStr);
      ctx.restore();
    }
    for (let i = 1; i < textLayers.length; i++) {
      drawGraphicTextLayer(ctx, textLayers[i], boxW, boxH, resScale);
    }
  }

  ctx.restore();
}

function renderTextClip(ctx, width, height, time, tClip) {
  if (!tClip.text) return;
  const anim = evaluateCaptionAnimation(tClip, time);
  ctx.save();
  const resScale = height / 720;
  const scaledFontSize = tClip.fontSize * resScale;
  const weight = tClip.bold === false ? 400 : 700;
  const family = cleanFontName(tClip.fontFamily);
  ctx.font = `${weight} ${scaledFontSize}px "${family}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = anim.opacity;

  const tx = width / 2 + (tClip.x / 100) * width;
  const ty =
    height / 2 + (tClip.y / 100) * height + anim.translateY * resScale;

  ctx.translate(tx, ty);
  ctx.scale(anim.scale, anim.scale);

  const lines = tClip.text.split('\n');
  const lineHeight = scaledFontSize * 1.25;
  const maxLineW = Math.max(
    ...lines.map((l) => ctx.measureText(l).width),
    scaledFontSize
  );
  const totalH = lines.length * lineHeight;

  const bgAlpha = tClip.bgOpacity ?? (anim.hasBackground ? 0.78 : 0);
  if (bgAlpha > 0) {
    const padX = 16 * resScale;
    const padY = 8 * resScale;
    const boxW = maxLineW + padX * 2;
    const boxH = totalH + padY * 2;
    const rad = 10 * resScale;

    ctx.save();
    ctx.fillStyle = hexToRgba(tClip.bgColor ?? '#000000', bgAlpha);
    ctx.beginPath();
    ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, rad);
    ctx.fill();
    ctx.restore();
  }

  const shadowBlur = (tClip.shadowBlur ?? 6) * resScale;
  if (anim.isNeon) {
    ctx.shadowColor = tClip.color;
    ctx.shadowBlur = 18 * resScale;
  } else if (shadowBlur > 0) {
    ctx.shadowColor = tClip.shadowColor ?? 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetY = 2 * resScale;
  }

  const outlineW = (tClip.outlineWidth ?? 0) * resScale;
  if (outlineW > 0) {
    ctx.lineWidth = outlineW * 2;
    ctx.strokeStyle = tClip.outlineColor ?? '#000000';
    ctx.lineJoin = 'round';
  }

  const startY = -((lines.length - 1) * lineHeight) / 2;

  if (anim.isHighlightTemplate) {
    const tokens = tClip.text.trim().split(/\s+/).filter(Boolean);
    const spaceW = ctx.measureText(' ').width;
    const widths = tokens.map((tok) => ctx.measureText(tok).width);
    const totalLineW =
      widths.reduce((a, b) => a + b, 0) +
      Math.max(0, tokens.length - 1) * spaceW;
    let cursorX = -totalLineW / 2;
    const highlightCol = tClip.highlightColor ?? '#fde047';

    tokens.forEach((tok, idx) => {
      const w = widths[idx];
      const isActive = idx === anim.activeWordIndex;
      const isFuture = anim.isSequentialReveal && idx > anim.activeWordIndex;
      ctx.save();
      ctx.globalAlpha = anim.opacity * (isFuture ? 0.18 : 1);
      ctx.fillStyle = isActive ? highlightCol : tClip.color;
      const cx = cursorX + w / 2;
      if (outlineW > 0) ctx.strokeText(tok, cx, 0);
      ctx.fillText(tok, cx, 0);
      ctx.restore();
      cursorX += w + spaceW;
    });
  } else {
    ctx.fillStyle = tClip.color;
    lines.forEach((line, idx) => {
      const ly = startY + idx * lineHeight;
      if (outlineW > 0) ctx.strokeText(line, 0, ly);
      ctx.fillText(line, 0, ly);
    });
  }
  ctx.restore();
}

export function createOverlayRenderer(width, height, clips) {
  ensureSystemFontsLoaded();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gClips = (clips || [])
    .filter((c) => c.trackType === 'graphics')
    .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
  const tClips = (clips || [])
    .filter((c) => c.trackType === 'text' || c.trackType === 'captions')
    .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));

  return {
    hasAny: gClips.length > 0 || tClips.length > 0,
    renderFrameRgba(time) {
      ctx.clearRect(0, 0, width, height);
      for (const g of gClips) {
        if (time >= g.startTime - 0.0005 && time < g.startTime + g.duration - 0.0005) {
          renderGraphicClip(ctx, width, height, time, g);
        }
      }
      for (const t of tClips) {
        if (time >= t.startTime - 0.0005 && time < t.startTime + t.duration - 0.0005) {
          renderTextClip(ctx, width, height, time, t);
        }
      }
      return canvas.data();
    },
  };
}
