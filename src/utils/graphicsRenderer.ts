import type {
  GraphicAnimation,
  GraphicClip,
  GraphicEasing,
  GraphicIconName,
  GraphicLayer,
  GraphicPreset,
} from '../types/editor';
import { clamp } from './time';

export type MediaElementSource = HTMLVideoElement | HTMLImageElement;

export interface GraphicRenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number; // global timeline time (seconds)
  clip: GraphicClip;
  mediaSources?: Map<string, MediaElementSource>;
  backdropCanvas?: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null;
}

// ---------------------------------------------------------------------------
// Easing & Animation Evaluation
// ---------------------------------------------------------------------------

export function applyEasing(t: number, easing: GraphicEasing): number {
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
      return (
        Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1
      );
    }
    default:
      return x;
  }
}

interface AnimState {
  opacity: number;
  scale: number;
  translateX: number; // px (at 720p base)
  translateY: number; // px (at 720p base)
  blur: number;
  entranceProgress: number; // 0 -> 1
  exitProgress: number; // 0 -> 1
  localTime: number; // elapsed time in seconds
  duration: number;
  loopPhase: number;
}

function evaluateClipAnimation(
  anim: GraphicAnimation,
  elapsed: number,
  duration: number,
  layerDelay = 0
): AnimState {
  const speed = Math.max(0.2, anim.speed || 1);
  const t = Math.max(0, (elapsed - (anim.delay || 0) - layerDelay) * speed);
  const entDur = Math.max(0.05, anim.entranceDuration || 0.5);
  const exitDur = Math.max(0.05, anim.exitDuration || 0.4);

  const entRaw = clamp(t / entDur, 0, 1);
  const ent = applyEasing(entRaw, anim.easing);

  const timeLeft = Math.max(0, duration - elapsed);
  const exitRaw = anim.exit === 'none' ? 0 : clamp(1 - timeLeft / exitDur, 0, 1);
  const exit = applyEasing(exitRaw, 'ease-in-out');

  let opacity = 1;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let blur = 0;

  // Entrance
  switch (anim.entrance) {
    case 'fade':
      opacity *= ent;
      break;
    case 'scale-pop':
      opacity *= clamp(entRaw * 2, 0, 1);
      scale *= 0.4 + 0.6 * ent;
      break;
    case 'slide-up':
      opacity *= clamp(entRaw * 1.6, 0, 1);
      translateY += (1 - ent) * 64;
      break;
    case 'slide-down':
      opacity *= clamp(entRaw * 1.6, 0, 1);
      translateY -= (1 - ent) * 64;
      break;
    case 'slide-left':
      opacity *= clamp(entRaw * 1.6, 0, 1);
      translateX += (1 - ent) * 90;
      break;
    case 'slide-right':
      opacity *= clamp(entRaw * 1.6, 0, 1);
      translateX -= (1 - ent) * 90;
      break;
    case 'blur-in':
      opacity *= ent;
      scale *= 1.15 - 0.15 * ent;
      blur += (1 - ent) * 14;
      break;
    case 'typewriter':
      opacity *= entRaw > 0 ? 1 : 0;
      break;
    case 'none':
      break;
  }

  // Exit
  switch (anim.exit) {
    case 'fade':
      opacity *= 1 - exit;
      break;
    case 'scale-down':
      opacity *= 1 - exit;
      scale *= 1 - 0.35 * exit;
      break;
    case 'slide-up':
      opacity *= 1 - exit;
      translateY -= exit * 60;
      break;
    case 'slide-down':
      opacity *= 1 - exit;
      translateY += exit * 60;
      break;
    case 'slide-left':
      opacity *= 1 - exit;
      translateX -= exit * 80;
      break;
    case 'slide-right':
      opacity *= 1 - exit;
      translateX += exit * 80;
      break;
    case 'blur-out':
      opacity *= 1 - exit;
      blur += exit * 12;
      break;
    case 'none':
      break;
  }

  // Loop
  const loopPhase = elapsed * speed * Math.PI * 2;
  switch (anim.loop) {
    case 'float':
      translateY += Math.sin(loopPhase * 0.45) * 9;
      break;
    case 'pulse':
      scale *= 1 + Math.sin(loopPhase * 0.65) * 0.035;
      break;
    case 'orbit':
      translateX += Math.cos(loopPhase * 0.4) * 10;
      translateY += Math.sin(loopPhase * 0.4) * 6;
      break;
    case 'breathe':
      scale *= 1 + Math.sin(loopPhase * 0.35) * 0.02;
      opacity *= 0.92 + Math.sin(loopPhase * 0.35) * 0.08;
      break;
    case 'shimmer':
      opacity *= 0.88 + Math.sin(loopPhase * 1.4) * 0.12;
      break;
    case 'none':
      break;
  }

  return {
    opacity: clamp(opacity, 0, 1),
    scale,
    translateX,
    translateY,
    blur,
    entranceProgress: ent,
    exitProgress: exit,
    localTime: t,
    duration,
    loopPhase,
  };
}

// ---------------------------------------------------------------------------
// Drawing Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '#000000').replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2) || '00', 16);
  const g = parseInt(full.slice(2, 4) || '00', 16);
  const b = parseInt(full.slice(4, 6) || '00', 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function makeFillStyle(
  ctx: CanvasRenderingContext2D,
  clip: GraphicClip,
  w: number,
  h: number
): string | CanvasGradient {
  const { visual } = clip;
  if (!visual.gradientEnabled) return visual.primaryColor;
  const rad = ((visual.gradientAngle ?? 135) * Math.PI) / 180;
  const dx = Math.cos(rad) * (w * 0.5);
  const dy = Math.sin(rad) * (h * 0.5);
  const grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
  grad.addColorStop(0, visual.primaryColor);
  grad.addColorStop(1, visual.secondaryColor);
  return grad;
}

function drawFittedMedia(
  ctx: CanvasRenderingContext2D,
  source: MediaElementSource | HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  radius = 0
) {
  const srcW =
    source instanceof HTMLVideoElement
      ? source.videoWidth || 1280
      : source instanceof HTMLImageElement
        ? source.naturalWidth || 1280
        : source.width || 1280;
  const srcH =
    source instanceof HTMLVideoElement
      ? source.videoHeight || 720
      : source instanceof HTMLImageElement
        ? source.naturalHeight || 720
        : source.height || 720;

  ctx.save();
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, radius);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
  }

  const coverScale = Math.max(dw / Math.max(1, srcW), dh / Math.max(1, srcH));
  const rw = srcW * coverScale;
  const rh = srcH * coverScale;
  ctx.drawImage(source, dx + (dw - rw) / 2, dy + (dh - rh) / 2, rw, rh);
  ctx.restore();
}

function drawPlaceholderCard(
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  primary: string,
  secondary: string,
  radius = 12
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, radius);
  ctx.clip();
  const grad = ctx.createLinearGradient(dx, dy, dx + dw, dy + dh);
  grad.addColorStop(0, hexToRgba(primary, 0.35));
  grad.addColorStop(1, hexToRgba(secondary, 0.45));
  ctx.fillStyle = grad;
  ctx.fillRect(dx, dy, dw, dh);

  // Subtle geometric grid
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  const step = Math.max(18, Math.min(dw, dh) / 6);
  for (let gx = dx; gx < dx + dw; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, dy);
    ctx.lineTo(gx, dy + dh);
    ctx.stroke();
  }
  for (let gy = dy; gy < dy + dh; gy += step) {
    ctx.beginPath();
    ctx.moveTo(dx, gy);
    ctx.lineTo(dx + dw, gy);
    ctx.stroke();
  }
  ctx.restore();
}

function resolveMediaForLayer(
  layer: GraphicLayer | undefined,
  mediaSources?: Map<string, MediaElementSource>,
  backdrop?: MediaElementSource | HTMLCanvasElement | null
): MediaElementSource | HTMLCanvasElement | null {
  if (layer?.mediaId && mediaSources?.has(layer.mediaId)) {
    return mediaSources.get(layer.mediaId) ?? null;
  }
  return backdrop ?? null;
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: GraphicLayer,
  w: number,
  h: number,
  resScale: number,
  anim: AnimState,
  overrideText?: string
) {
  if (!layer.visible) return;
  const rawText = overrideText ?? layer.text ?? '';
  if (!rawText) return;

  const fontSize = (layer.fontSize ?? 36) * resScale;
  const weight = layer.fontWeight ?? 700;
  const family = layer.fontFamily ?? 'Inter, sans-serif';
  const align = layer.textAlign ?? 'center';
  const lineHeight = (layer.lineHeight ?? 1.2) * fontSize;
  const letterSpacing = (layer.letterSpacing ?? 0) * resScale;

  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${letterSpacing}px`;
  }

  const lx = ((layer.x ?? 0) / 100) * w;
  const ly = ((layer.y ?? 0) / 100) * h;
  ctx.translate(lx, ly);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
  const lScale = layer.scale ?? 1;
  ctx.scale(lScale, lScale);
  ctx.globalAlpha *= layer.opacity ?? 1;

  // Typewriter slice if active
  const displayText =
    overrideText === undefined && anim.localTime < 2 && layer.type === 'text'
      ? rawText
      : rawText;

  const lines = displayText.split('\n');
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

function drawDoodleIcon(
  ctx: CanvasRenderingContext2D,
  icon: GraphicIconName,
  x: number,
  y: number,
  size: number,
  color: string,
  strokeWidth: number,
  progress: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const s = size * (0.6 + 0.4 * progress);

  switch (icon) {
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, s * 0.25);
      ctx.quadraticCurveTo(0, -s * 0.45, s * 0.65, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.38, -s * 0.26);
      ctx.lineTo(s * 0.68, 0.02);
      ctx.lineTo(s * 0.35, s * 0.26);
      ctx.stroke();
      break;
    }
    case 'circle': {
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.75, s * 0.48, -0.1, 0, Math.PI * 2 * progress);
      ctx.stroke();
      break;
    }
    case 'sparkle': {
      const r = s * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.fill();
      break;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? s * 0.55 : s * 0.24;
        const ang = (i * Math.PI) / 5 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'check': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, 0);
      ctx.lineTo(-s * 0.1, s * 0.35);
      ctx.lineTo(s * 0.5, -s * 0.35);
      ctx.stroke();
      break;
    }
    case 'crosshair': {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.65, 0);
      ctx.lineTo(s * 0.65, 0);
      ctx.moveTo(0, -s * 0.65);
      ctx.lineTo(0, s * 0.65);
      ctx.stroke();
      break;
    }
    case 'underline': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, 0);
      ctx.quadraticCurveTo(0, s * 0.22, s * 0.7 * progress, -s * 0.05);
      ctx.stroke();
      break;
    }
    case 'bolt': {
      ctx.beginPath();
      ctx.moveTo(s * 0.1, -s * 0.55);
      ctx.lineTo(-s * 0.25, s * 0.05);
      ctx.lineTo(s * 0.08, s * 0.05);
      ctx.lineTo(-s * 0.1, s * 0.55);
      ctx.lineTo(s * 0.28, -s * 0.05);
      ctx.lineTo(-s * 0.05, -s * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'scribble':
    default: {
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s * 0.15);
      ctx.bezierCurveTo(-s * 0.2, -s * 0.3, s * 0.2, s * 0.3, s * 0.6, -s * 0.1);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawTextureOverlay(
  ctx: CanvasRenderingContext2D,
  texture: GraphicClip['visual']['texture'],
  w: number,
  h: number,
  resScale: number
) {
  if (texture === 'none') return;
  ctx.save();
  if (texture === 'scanlines') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const gap = Math.max(3, 4 * resScale);
    for (let y = -h / 2; y < h / 2; y += gap * 2) {
      ctx.fillRect(-w / 2, y, w, gap);
    }
  } else if (texture === 'grid') {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = Math.max(1, resScale);
    const step = 42 * resScale;
    for (let x = -w / 2; x < w / 2; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
      ctx.stroke();
    }
    for (let y = -h / 2; y < h / 2; y += step) {
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
  } else if (texture === 'halftone') {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    const step = 20 * resScale;
    const r = 2 * resScale;
    for (let x = -w / 2; x < w / 2; x += step) {
      for (let y = -h / 2; y < h / 2; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (texture === 'grain') {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 180; i++) {
      const gx = (((i * 7919) % 1000) / 1000 - 0.5) * w;
      const gy = (((i * 6271) % 1000) / 1000 - 0.5) * h;
      ctx.fillRect(gx, gy, 2 * resScale, 2 * resScale);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main Template Renderer (All 25 Templates)
// ---------------------------------------------------------------------------

export function renderGraphicToCanvas({
  ctx,
  width,
  height,
  time,
  clip,
  mediaSources,
  backdropCanvas,
}: GraphicRenderContext): void {
  const elapsed = Math.max(0, time - clip.startTime);
  const resScale = height / 720;
  const { visual, transform, animation, specific } = clip;
  const anim = evaluateClipAnimation(animation, elapsed, clip.duration);

  if (anim.opacity <= 0.002) return;

  ctx.save();
  ctx.globalAlpha = clamp(visual.opacity * anim.opacity, 0, 1);
  ctx.globalCompositeOperation = visual.blendMode || 'source-over';

  if (anim.blur > 0.2 && 'filter' in ctx) {
    ctx.filter = `blur(${(anim.blur * resScale).toFixed(1)}px)`;
  }

  // Transform & Alignment
  const alignOffsetX =
    transform.alignH === 'left'
      ? -width * 0.25
      : transform.alignH === 'right'
        ? width * 0.25
        : 0;
  const alignOffsetY =
    transform.alignV === 'top'
      ? -height * 0.25
      : transform.alignV === 'bottom'
        ? height * 0.25
        : 0;

  const cx =
    width / 2 +
    (transform.x / 100) * width +
    alignOffsetX +
    anim.translateX * resScale;
  const cy =
    height / 2 +
    (transform.y / 100) * height +
    alignOffsetY +
    anim.translateY * resScale;

  const boxW = (width * (transform.width ?? 100)) / 100;
  const boxH = (height * (transform.height ?? 100)) / 100;

  ctx.translate(cx, cy);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX * anim.scale, transform.scaleY * anim.scale);

  // Crop clip
  if (
    transform.cropTop > 0 ||
    transform.cropRight > 0 ||
    transform.cropBottom > 0 ||
    transform.cropLeft > 0
  ) {
    const cl = (transform.cropLeft / 100) * boxW;
    const cr = (transform.cropRight / 100) * boxW;
    const ct = (transform.cropTop / 100) * boxH;
    const cb = (transform.cropBottom / 100) * boxH;
    ctx.beginPath();
    ctx.rect(
      -boxW / 2 + cl,
      -boxH / 2 + ct,
      Math.max(1, boxW - cl - cr),
      Math.max(1, boxH - ct - cb)
    );
    ctx.clip();
  }

  // Optional Background Plate
  if (visual.backgroundOpacity > 0 && clip.templateId !== 'spotlight-focus' && clip.templateId !== 'paper-tear-reveal') {
    ctx.save();
    ctx.fillStyle = hexToRgba(visual.backgroundColor, visual.backgroundOpacity);
    ctx.beginPath();
    ctx.roundRect(
      -boxW / 2,
      -boxH / 2,
      boxW,
      boxH,
      visual.borderRadius * resScale
    );
    ctx.fill();
    ctx.restore();
  }

  // Shadow / Glow
  if (visual.glowIntensity > 0) {
    ctx.shadowColor = visual.primaryColor;
    ctx.shadowBlur = visual.glowIntensity * resScale;
  } else if (visual.shadowBlur > 0) {
    ctx.shadowColor = visual.shadowColor || 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = visual.shadowBlur * resScale;
    ctx.shadowOffsetY = 4 * resScale;
  }

  const textLayers = clip.layers.filter((l) => l.type === 'text' && l.visible);
  const mediaLayer = clip.layers.find((l) => l.type === 'media' && l.visible);
  const activeMedia = resolveMediaForLayer(mediaLayer, mediaSources, backdropCanvas);

  switch (clip.templateId) {
    // -----------------------------------------------------------------------
    // 1. Cinematic Title Reveal
    // -----------------------------------------------------------------------
    case 'cinematic-title-reveal': {
      const barPct = (specific.letterboxBars ?? 10) / 100;
      const barH = boxH * barPct * anim.entranceProgress;
      if (barH > 0) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, barH);
        ctx.fillRect(-boxW / 2, boxH / 2 - barH, boxW, barH);
      }

      const flare = specific.flareIntensity ?? 0.7;
      if (flare > 0) {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, boxW * 0.45);
        grad.addColorStop(0, hexToRgba(visual.secondaryColor, 0.28 * flare));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      }

      for (const layer of textLayers) {
        const lAnim = evaluateClipAnimation(animation, elapsed, clip.duration, layer.delay ?? 0);
        ctx.save();
        ctx.globalAlpha *= lAnim.opacity;
        const spread = 1 + (1 - lAnim.entranceProgress) * 0.25;
        ctx.scale(spread, spread);
        drawTextLayer(ctx, layer, boxW, boxH, resScale, lAnim);
        ctx.restore();
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 2. Text Behind Subject
    // -----------------------------------------------------------------------
    case 'text-behind-subject': {
      const bgLayer = textLayers[0];
      const fgLayer = textLayers[1];
      if (bgLayer) {
        ctx.save();
        ctx.globalAlpha *= specific.textDepth ?? 0.85;
        drawTextLayer(ctx, bgLayer, boxW, boxH, resScale, anim);
        ctx.restore();
      }
      // Subject cutout mask overlay
      const cutW = boxW * 0.34;
      const cutH = boxH * 0.68;
      if (activeMedia) {
        ctx.save();
        ctx.beginPath();
        if (specific.maskSource === 'center-rect') {
          ctx.roundRect(-cutW / 2, -cutH / 2 + boxH * 0.08, cutW, cutH, 24 * resScale);
        } else {
          ctx.ellipse(0, boxH * 0.08, cutW * 0.52, cutH * 0.52, 0, 0, Math.PI * 2);
        }
        ctx.clip();
        drawFittedMedia(ctx, activeMedia, -boxW / 2, -boxH / 2, boxW, boxH, 0);
        ctx.restore();
      } else {
        // Clean silhouette cutout badge when no underlying footage
        ctx.save();
        ctx.fillStyle = hexToRgba(visual.secondaryColor, 0.25);
        ctx.strokeStyle = hexToRgba(visual.primaryColor, 0.7);
        ctx.lineWidth = 2 * resScale;
        ctx.beginPath();
        ctx.ellipse(0, boxH * 0.08, cutW * 0.45, cutH * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (fgLayer) {
        drawTextLayer(ctx, fgLayer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 3. Floating 3D Text
    // -----------------------------------------------------------------------
    case 'floating-3d-text': {
      const depth = Math.max(2, Math.round(specific.depth3D ?? 14));
      const drift = specific.cameraDrift ?? 0.65;
      const mainLayer = textLayers[0];
      if (mainLayer) {
        const fontSize = (mainLayer.fontSize ?? 80) * resScale;
        ctx.save();
        ctx.font = `${mainLayer.fontWeight ?? 800} ${fontSize}px ${mainLayer.fontFamily ?? 'Impact, sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const yaw = Math.sin(elapsed * 1.4) * 0.14 * drift;
        ctx.transform(1, yaw * 0.35, -yaw * 0.25, 1, 0, ((mainLayer.y ?? 0) / 100) * boxH);

        for (let d = depth; d >= 1; d--) {
          ctx.fillStyle = hexToRgba(
            mainLayer.secondaryColor ?? visual.secondaryColor,
            0.25 + (1 - d / depth) * 0.45
          );
          ctx.fillText(mainLayer.text ?? '', d * 1.2 * resScale, d * 1.4 * resScale);
        }
        ctx.fillStyle = mainLayer.color ?? '#ffffff';
        ctx.fillText(mainLayer.text ?? '', 0, 0);
        ctx.restore();
      }
      for (let i = 1; i < textLayers.length; i++) {
        drawTextLayer(ctx, textLayers[i], boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 4. Kinetic Typography
    // -----------------------------------------------------------------------
    case 'kinetic-typography': {
      const main = textLayers[0];
      if (main && main.text) {
        const isChar = specific.kineticMode === 'character';
        const units = isChar
          ? main.text.split('')
          : main.text.trim().split(/\s+/);
        const stagger = Math.max(0.03, animation.stagger || 0.15);
        const fontSize = (main.fontSize ?? 52) * resScale;
        ctx.save();
        ctx.font = `${main.fontWeight ?? 800} ${fontSize}px ${main.fontFamily ?? 'Inter, sans-serif'}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const spaceW = isChar ? 0 : (specific.wordSpacing ?? 16) * resScale;
        const widths = units.map((u) => ctx.measureText(u).width);
        const totalW = widths.reduce((a, b) => a + b, 0) + Math.max(0, units.length - 1) * spaceW;
        let curX = -totalW / 2;

        units.forEach((unit, idx) => {
          const uT = clamp((elapsed - idx * (isChar ? stagger * 0.25 : stagger)) / 0.28, 0, 1);
          const eased = applyEasing(uT, animation.easing);
          if (eased > 0.01) {
            ctx.save();
            ctx.globalAlpha *= eased;
            const uw = widths[idx];
            ctx.translate(curX + uw / 2, (1 - eased) * 28 * resScale);
            ctx.scale(0.8 + 0.2 * eased, 0.8 + 0.2 * eased);
            ctx.fillStyle = idx % 2 === 1 ? visual.primaryColor : (main.color ?? '#ffffff');
            ctx.fillText(unit, 0, 0);
            ctx.restore();
          }
          curX += widths[idx] + spaceW;
        });
        ctx.restore();
      }
      for (let i = 1; i < textLayers.length; i++) {
        drawTextLayer(ctx, textLayers[i], boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 5. Editorial Title Layout
    // -----------------------------------------------------------------------
    case 'editorial-title-layout': {
      ctx.save();
      ctx.strokeStyle = hexToRgba(visual.strokeColor, 0.35);
      ctx.lineWidth = Math.max(1, resScale);
      ctx.strokeRect(-boxW * 0.44, -boxH * 0.4, boxW * 0.88, boxH * 0.8);
      ctx.beginPath();
      ctx.moveTo(boxW * 0.02, -boxH * 0.4);
      ctx.lineTo(boxW * 0.02, boxH * 0.4);
      ctx.stroke();
      ctx.restore();

      const cardW = boxW * 0.36;
      const cardH = boxH * 0.64;
      const cardX = boxW * 0.06;
      const cardY = -cardH / 2;
      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, cardX, cardY, cardW, cardH, 8 * resScale);
      } else {
        drawPlaceholderCard(ctx, cardX, cardY, cardW, cardH, visual.primaryColor, visual.secondaryColor, 8 * resScale);
      }

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 6. Subject Pop-Out
    // -----------------------------------------------------------------------
    case 'subject-pop-out': {
      const popW = boxW * 0.44;
      const popH = boxH * 0.7;
      const outW = (specific.outlineWidth ?? 6) * resScale;
      const sDist = (specific.shadowDistance ?? 16) * resScale;
      const popScale = specific.freezePop ? 1 + Math.sin(anim.entranceProgress * Math.PI) * 0.08 : 1;

      ctx.save();
      ctx.scale(popScale, popScale);
      // Drop shadow silhouette
      ctx.fillStyle = hexToRgba(visual.primaryColor, 0.35);
      ctx.beginPath();
      if (specific.maskShape === 'rounded-rect') {
        ctx.roundRect(-popW / 2 + sDist, -popH / 2 + sDist, popW, popH, 24 * resScale);
      } else {
        ctx.ellipse(sDist, sDist, popW * 0.48, popH * 0.48, 0, 0, Math.PI * 2);
      }
      ctx.fill();

      // Main cutout
      ctx.save();
      ctx.beginPath();
      if (specific.maskShape === 'rounded-rect') {
        ctx.roundRect(-popW / 2, -popH / 2, popW, popH, 24 * resScale);
      } else {
        ctx.ellipse(0, 0, popW * 0.48, popH * 0.48, 0, 0, Math.PI * 2);
      }
      ctx.clip();
      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, -popW / 2, -popH / 2, popW, popH, 0);
      } else {
        drawPlaceholderCard(ctx, -popW / 2, -popH / 2, popW, popH, visual.primaryColor, visual.secondaryColor, 0);
      }
      ctx.restore();

      // Outline
      ctx.strokeStyle = visual.strokeColor || '#ffffff';
      ctx.lineWidth = outW;
      ctx.beginPath();
      if (specific.maskShape === 'rounded-rect') {
        ctx.roundRect(-popW / 2, -popH / 2, popW, popH, 24 * resScale);
      } else {
        ctx.ellipse(0, 0, popW * 0.48, popH * 0.48, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 7. Magnified Detail
    // -----------------------------------------------------------------------
    case 'magnified-detail': {
      const tx = ((specific.targetX ?? -12) / 100) * boxW;
      const ty = ((specific.targetY ?? 8) / 100) * boxH;
      const lx = boxW * 0.18;
      const ly = -boxH * 0.08;
      const radius = Math.min(boxW, boxH) * 0.2;
      const zoomAmt = specific.zoomAmount ?? 2.4;

      // Connecting line
      ctx.save();
      ctx.strokeStyle = visual.primaryColor;
      ctx.lineWidth = Math.max(2, 2.5 * resScale);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.fillStyle = visual.primaryColor;
      ctx.beginPath();
      ctx.arc(tx, ty, 5 * resScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Loupe window
      ctx.save();
      ctx.beginPath();
      if (specific.magnifierShape === 'square') {
        ctx.rect(lx - radius, ly - radius, radius * 2, radius * 2);
      } else if (specific.magnifierShape === 'rounded') {
        ctx.roundRect(lx - radius, ly - radius, radius * 2, radius * 2, 24 * resScale);
      } else {
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
      }
      ctx.clip();
      if (activeMedia) {
        drawFittedMedia(
          ctx,
          activeMedia,
          lx - (boxW * zoomAmt) / 2 - tx * zoomAmt,
          ly - (boxH * zoomAmt) / 2 - ty * zoomAmt,
          boxW * zoomAmt,
          boxH * zoomAmt,
          0
        );
      } else {
        drawPlaceholderCard(ctx, lx - radius, ly - radius, radius * 2, radius * 2, visual.primaryColor, visual.secondaryColor, 0);
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = visual.strokeColor || visual.primaryColor;
      ctx.lineWidth = (visual.strokeWidth || 4) * resScale;
      ctx.beginPath();
      if (specific.magnifierShape === 'square') {
        ctx.rect(lx - radius, ly - radius, radius * 2, radius * 2);
      } else if (specific.magnifierShape === 'rounded') {
        ctx.roundRect(lx - radius, ly - radius, radius * 2, radius * 2, 24 * resScale);
      } else {
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 8. Motion Echo
    // -----------------------------------------------------------------------
    case 'motion-echo': {
      const count = Math.max(2, Math.round(specific.echoCount ?? 5));
      const spacing = (specific.echoSpacing ?? 22) * resScale;
      const baseOp = specific.echoOpacity ?? 0.55;
      const cw = boxW * 0.45;
      const ch = boxH * 0.56;

      for (let i = count; i >= 1; i--) {
        const offset = Math.sin(elapsed * 2.2 - i * 0.35) * spacing * i * 0.45;
        ctx.save();
        ctx.globalAlpha *= baseOp * (1 - i / (count + 1));
        ctx.translate(offset - i * spacing * 0.3, -i * spacing * 0.15);
        if (activeMedia) {
          drawFittedMedia(ctx, activeMedia, -cw / 2, -ch / 2, cw, ch, 14 * resScale);
        } else {
          drawPlaceholderCard(ctx, -cw / 2, -ch / 2, cw, ch, visual.primaryColor, visual.secondaryColor, 14 * resScale);
        }
        ctx.restore();
      }
      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, -cw / 2, -ch / 2, cw, ch, 14 * resScale);
      } else {
        drawPlaceholderCard(ctx, -cw / 2, -ch / 2, cw, ch, visual.primaryColor, visual.secondaryColor, 14 * resScale);
      }
      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 9. Spotlight Focus
    // -----------------------------------------------------------------------
    case 'spotlight-focus': {
      const tx = ((specific.targetX ?? 0) / 100) * boxW;
      const ty = ((specific.targetY ?? -4) / 100) * boxH;
      const rad = ((specific.spotlightRadius ?? 24) / 100) * Math.min(boxW, boxH);
      const feather = ((specific.spotlightFeather ?? 45) / 100) * rad;
      const outerR = rad + feather;

      const grad = ctx.createRadialGradient(tx, ty, Math.max(1, rad * 0.65), tx, ty, Math.max(2, outerR));
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, hexToRgba(visual.backgroundColor || '#000000', visual.backgroundOpacity || 0.78));
      ctx.fillStyle = grad;
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);

      ctx.save();
      ctx.strokeStyle = hexToRgba(visual.primaryColor, 0.7);
      ctx.lineWidth = 2 * resScale;
      ctx.beginPath();
      if (specific.spotlightShape === 'rect') {
        ctx.roundRect(tx - rad, ty - rad * 0.7, rad * 2, rad * 1.4, 16 * resScale);
      } else {
        ctx.ellipse(tx, ty, rad, specific.spotlightShape === 'ellipse' ? rad * 0.7 : rad, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 10. Film Strip Composition
    // -----------------------------------------------------------------------
    case 'film-strip': {
      const fCount = Math.max(2, Math.round(specific.frameCount ?? 4));
      const gap = (specific.frameSpacing ?? 16) * resScale;
      const stripH = boxH * 0.52;
      const frameW = boxW * 0.34;
      const scroll = (elapsed * 70 * (specific.scrollSpeed ?? 1) * resScale) % (frameW + gap);

      ctx.save();
      ctx.fillStyle = visual.backgroundColor || '#0b0c10';
      ctx.fillRect(-boxW / 2, -stripH / 2, boxW, stripH);

      // Sprocket holes
      ctx.fillStyle = '#e2e8f0';
      const holeStep = 24 * resScale;
      for (let hx = -boxW / 2 - scroll; hx < boxW / 2 + holeStep; hx += holeStep) {
        ctx.fillRect(hx, -stripH / 2 + 8 * resScale, 10 * resScale, 7 * resScale);
        ctx.fillRect(hx, stripH / 2 - 15 * resScale, 10 * resScale, 7 * resScale);
      }

      const innerH = stripH - 46 * resScale;
      for (let i = -1; i <= fCount + 1; i++) {
        const fx = -boxW / 2 + i * (frameW + gap) - scroll;
        if (activeMedia) {
          drawFittedMedia(ctx, activeMedia, fx, -innerH / 2, frameW, innerH, 4 * resScale);
        } else {
          drawPlaceholderCard(ctx, fx, -innerH / 2, frameW, innerH, visual.primaryColor, visual.secondaryColor, 4 * resScale);
        }
      }
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 11. Paper Tear Reveal
    // -----------------------------------------------------------------------
    case 'paper-tear-reveal': {
      const prog = anim.entranceProgress;
      const rough = (specific.edgeRoughness ?? 18) * resScale;
      const splitX = -boxW / 2 + boxW * prog;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-boxW / 2, -boxH / 2);
      ctx.lineTo(splitX, -boxH / 2);
      const steps = 18;
      for (let i = 0; i <= steps; i++) {
        const py = -boxH / 2 + (i / steps) * boxH;
        const jag =
          specific.tearShape === 'wave'
            ? Math.sin(i * 0.9) * rough
            : specific.tearShape === 'diagonal'
              ? (i / steps - 0.5) * rough * 4
              : ((i % 2 === 0 ? 1 : -1) * rough * 0.8);
        ctx.lineTo(splitX + jag, py);
      }
      ctx.lineTo(-boxW / 2, boxH / 2);
      ctx.closePath();

      ctx.save();
      ctx.clip();
      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, -boxW / 2, -boxH / 2, boxW, boxH, 0);
      } else {
        drawPlaceholderCard(ctx, -boxW / 2, -boxH / 2, boxW, boxH, visual.primaryColor, visual.secondaryColor, 0);
      }
      ctx.restore();

      ctx.strokeStyle = visual.backgroundColor || '#f5f0e6';
      ctx.lineWidth = 10 * resScale;
      ctx.stroke();
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 12. Sliding Film Panels
    // -----------------------------------------------------------------------
    case 'sliding-film-panels': {
      const pCount = Math.max(2, Math.round(specific.panelCount ?? 4));
      const pGap = (specific.panelSpacing ?? 12) * resScale;
      const isHoriz = specific.panelOrientation === 'horizontal';
      const totalSpan = isHoriz ? boxH * 0.82 : boxW * 0.86;
      const panelSize = (totalSpan - pGap * (pCount - 1)) / pCount;

      for (let i = 0; i < pCount; i++) {
        const pT = clamp((elapsed - i * (specific.panelStagger ?? 0.12)) / 0.55, 0, 1);
        const eased = applyEasing(pT, animation.easing);
        const slideOffset = (1 - eased) * (i % 2 === 0 ? -120 : 120) * resScale;

        ctx.save();
        if (isHoriz) {
          const py = -totalSpan / 2 + i * (panelSize + pGap);
          ctx.translate(slideOffset, 0);
          if (activeMedia) {
            drawFittedMedia(ctx, activeMedia, -boxW * 0.42, py, boxW * 0.84, panelSize, visual.borderRadius * resScale);
          } else {
            drawPlaceholderCard(ctx, -boxW * 0.42, py, boxW * 0.84, panelSize, visual.primaryColor, visual.secondaryColor, visual.borderRadius * resScale);
          }
        } else {
          const px = -totalSpan / 2 + i * (panelSize + pGap);
          ctx.translate(0, slideOffset);
          if (activeMedia) {
            drawFittedMedia(ctx, activeMedia, px, -boxH * 0.38, panelSize, boxH * 0.76, visual.borderRadius * resScale);
          } else {
            drawPlaceholderCard(ctx, px, -boxH * 0.38, panelSize, boxH * 0.76, visual.primaryColor, visual.secondaryColor, visual.borderRadius * resScale);
          }
        }
        ctx.restore();
      }
      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 13. Infinite Frame
    // -----------------------------------------------------------------------
    case 'infinite-frame': {
      const nCount = Math.max(2, Math.round(specific.nestedCount ?? 6));
      const zoomD = specific.zoomDepth ?? 1.4;
      const phase = (elapsed * 0.65) % 1;

      for (let i = 0; i < nCount; i++) {
        const t = ((i + phase) / nCount) * zoomD;
        const s = 0.2 + t * 0.65;
        const fw = boxW * s;
        const fh = boxH * s;
        ctx.save();
        ctx.globalAlpha *= clamp(1 - Math.abs(s - 0.55) * 0.9, 0.15, 1);
        ctx.strokeStyle = i % 2 === 0 ? visual.primaryColor : visual.secondaryColor;
        ctx.lineWidth = Math.max(1.5, (visual.strokeWidth || 3) * resScale);
        ctx.beginPath();
        ctx.roundRect(-fw / 2, -fh / 2, fw, fh, visual.borderRadius * resScale);
        ctx.stroke();
        ctx.restore();
      }

      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, -boxW * 0.18, -boxH * 0.18, boxW * 0.36, boxH * 0.36, 10 * resScale);
      }
      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 14. Snapshot Explosion
    // -----------------------------------------------------------------------
    case 'snapshot-explosion': {
      const count = Math.max(2, Math.round(specific.photoCount ?? 5));
      const spread = specific.spreadRotation ?? 18;
      const pw = boxW * 0.24;
      const ph = boxH * 0.44;

      for (let i = 0; i < count; i++) {
        const idxNorm = i - (count - 1) / 2;
        const t = clamp((elapsed - i * 0.1) / 0.5, 0, 1);
        const eased = applyEasing(t, 'back-out');
        const ang = (idxNorm * spread * Math.PI) / 180;
        const ox = idxNorm * pw * 0.55 * eased;
        const oy = (specific.collageLayout === 'scatter' ? Math.sin(i * 2.1) * 40 : Math.abs(idxNorm) * 14) * resScale * eased;

        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(ang * eased);
        ctx.scale(eased, eased);
        ctx.fillStyle = visual.backgroundColor || '#ffffff';
        ctx.beginPath();
        ctx.roundRect(-pw / 2, -ph / 2, pw, ph, visual.borderRadius * resScale);
        ctx.fill();

        const pad = 10 * resScale;
        if (activeMedia) {
          drawFittedMedia(ctx, activeMedia, -pw / 2 + pad, -ph / 2 + pad, pw - pad * 2, ph * 0.72, 2 * resScale);
        } else {
          drawPlaceholderCard(ctx, -pw / 2 + pad, -ph / 2 + pad, pw - pad * 2, ph * 0.72, visual.primaryColor, visual.secondaryColor, 2 * resScale);
        }
        ctx.restore();
      }
      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 15. Liquid Shape Reveal
    // -----------------------------------------------------------------------
    case 'liquid-shape-reveal': {
      const lobes = Math.max(3, Math.round(specific.blobComplexity ?? 6));
      const baseR = Math.min(boxW, boxH) * 0.36 * anim.entranceProgress;

      ctx.save();
      ctx.beginPath();
      const pts = 72;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wobble = Math.sin(a * lobes + elapsed * 3) * (baseR * 0.12);
        const r = baseR + wobble;
        const px = Math.cos(a) * r * 1.25;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.save();
      ctx.clip();
      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, -boxW / 2, -boxH / 2, boxW, boxH, 0);
      } else {
        ctx.fillStyle = makeFillStyle(ctx, clip, boxW, boxH);
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      }
      ctx.restore();

      ctx.strokeStyle = makeFillStyle(ctx, clip, boxW, boxH);
      ctx.lineWidth = 4 * resScale;
      ctx.stroke();
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 16. Floating Glass Panels
    // -----------------------------------------------------------------------
    case 'floating-glass-panels': {
      const gw = boxW * 0.62;
      const gh = boxH * 0.44;
      const rad = visual.borderRadius * resScale;
      const gOp = specific.glassOpacity ?? 0.18;
      const refl = specific.reflectionStrength ?? 0.55;

      ctx.save();
      ctx.fillStyle = hexToRgba(visual.backgroundColor || '#ffffff', gOp);
      ctx.beginPath();
      ctx.roundRect(-gw / 2, -gh / 2, gw, gh, rad);
      ctx.fill();

      // Specular highlight
      const refGrad = ctx.createLinearGradient(-gw / 2, -gh / 2, gw / 2, gh / 2);
      refGrad.addColorStop(0, `rgba(255,255,255,${0.35 * refl})`);
      refGrad.addColorStop(0.5, 'rgba(255,255,255,0.03)');
      refGrad.addColorStop(1, `rgba(255,255,255,${0.18 * refl})`);
      ctx.fillStyle = refGrad;
      ctx.fill();

      ctx.strokeStyle = hexToRgba(visual.strokeColor || '#ffffff', 0.45);
      ctx.lineWidth = Math.max(1, (visual.strokeWidth || 1.5) * resScale);
      ctx.stroke();
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 17. Neon Line Composition
    // -----------------------------------------------------------------------
    case 'neon-line-composition': {
      const nw = boxW * 0.72;
      const nh = boxH * 0.54;
      const lw = (specific.lineThickness ?? 3) * resScale;

      ctx.save();
      ctx.shadowColor = visual.primaryColor;
      ctx.shadowBlur = (specific.neonGlow ?? 22) * resScale;
      ctx.strokeStyle = makeFillStyle(ctx, clip, nw, nh);
      ctx.lineWidth = lw;
      if (specific.lineStyle === 'dashed') {
        ctx.setLineDash([16 * resScale, 10 * resScale]);
        ctx.lineDashOffset = -elapsed * 45 * resScale;
      }
      ctx.beginPath();
      ctx.roundRect(-nw / 2, -nh / 2, nw, nh, visual.borderRadius * resScale);
      ctx.stroke();

      if (specific.lineStyle === 'double') {
        ctx.strokeRect(-nw / 2 + 10 * resScale, -nh / 2 + 10 * resScale, nw - 20 * resScale, nh - 20 * resScale);
      }
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 18. Tracking HUD
    // -----------------------------------------------------------------------
    case 'tracking-hud': {
      const tx = ((specific.targetX ?? 0) / 100) * boxW;
      const ty = ((specific.targetY ?? 0) / 100) * boxH;
      const bSize = ((specific.bracketSize ?? 22) / 100) * Math.min(boxW, boxH);
      const corner = bSize * 0.35;

      ctx.save();
      ctx.translate(tx, ty);
      ctx.strokeStyle = visual.primaryColor;
      ctx.lineWidth = Math.max(2, 2.5 * resScale);

      // 4 corner brackets
      const pts: Array<[number, number, number, number]> = [
        [-bSize, -bSize, 1, 1],
        [bSize, -bSize, -1, 1],
        [-bSize, bSize, 1, -1],
        [bSize, bSize, -1, -1],
      ];
      for (const [cx0, cy0, sx, sy] of pts) {
        ctx.beginPath();
        ctx.moveTo(cx0, cy0 + sy * corner);
        ctx.lineTo(cx0, cy0);
        ctx.lineTo(cx0 + sx * corner, cy0);
        ctx.stroke();
      }

      if (specific.showCrosshair !== false) {
        drawDoodleIcon(ctx, 'crosshair', 0, 0, bSize * 0.45, visual.secondaryColor, 1.8 * resScale, 1);
      }

      // Label above bracket
      if (textLayers[0]) {
        drawTextLayer(ctx, { ...textLayers[0], x: 0, y: -(bSize / boxH) * 100 - 8 }, boxW, boxH, resScale, anim);
      }
      if (textLayers[1]) {
        drawTextLayer(ctx, { ...textLayers[1], x: 0, y: (bSize / boxH) * 100 + 8 }, boxW, boxH, resScale, anim);
      }
      ctx.restore();
      break;
    }

    // -----------------------------------------------------------------------
    // 19. Doodle Pack
    // -----------------------------------------------------------------------
    case 'doodle-pack': {
      const doodles = clip.layers.filter((l) => l.type === 'doodle' && l.visible);
      doodles.forEach((d, idx) => {
        const dT = clamp((elapsed - idx * (animation.stagger || 0.15)) / 0.45, 0, 1);
        const eased = applyEasing(dT, 'ease-out');
        const dx = ((d.x ?? 0) / 100) * boxW;
        const dy = ((d.y ?? 0) / 100) * boxH;
        ctx.save();
        ctx.translate(dx, dy);
        if (d.rotation) ctx.rotate((d.rotation * Math.PI) / 180);
        drawDoodleIcon(
          ctx,
          d.iconName ?? 'arrow',
          0,
          0,
          120 * (d.scale ?? 1) * resScale,
          d.color ?? visual.primaryColor,
          (visual.strokeWidth || 4) * resScale,
          eased
        );
        ctx.restore();
      });

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 20. Desktop Popups
    // -----------------------------------------------------------------------
    case 'desktop-popups': {
      const winW = boxW * 0.56;
      const winH = boxH * 0.4;
      const barH = 34 * resScale;
      const rad = visual.borderRadius * resScale;
      const isLight = specific.windowTheme === 'light';

      ctx.save();
      ctx.fillStyle = isLight ? '#f8fafc' : (visual.backgroundColor || '#181a20');
      ctx.beginPath();
      ctx.roundRect(-winW / 2, -winH / 2, winW, winH, rad);
      ctx.fill();

      // Title bar
      ctx.fillStyle = isLight ? '#e2e8f0' : '#232630';
      ctx.beginPath();
      ctx.roundRect(-winW / 2, -winH / 2, winW, barH, [rad, rad, 0, 0]);
      ctx.fill();

      // Traffic lights
      const dotColors = ['#ef4444', '#f59e0b', '#10b981'];
      dotColors.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(-winW / 2 + (18 + i * 16) * resScale, -winH / 2 + barH / 2, 5 * resScale, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.strokeStyle = visual.strokeColor || '#334155';
      ctx.lineWidth = Math.max(1, (visual.strokeWidth || 1.5) * resScale);
      ctx.beginPath();
      ctx.roundRect(-winW / 2, -winH / 2, winW, winH, rad);
      ctx.stroke();
      ctx.restore();

      const winTitle = clip.layers.find((l) => l.type === 'window' && l.visible);
      if (winTitle) {
        drawTextLayer(
          ctx,
          {
            ...winTitle,
            fontSize: 15,
            fontWeight: 600,
            color: isLight ? '#0f172a' : '#e2e8f0',
            x: 0,
            y: ((-winH / 2 + barH / 2) / boxH) * 100,
          },
          boxW,
          boxH,
          resScale,
          anim
        );
      }
      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 21. 3D Flip Card
    // -----------------------------------------------------------------------
    case 'flip-card-3d': {
      const cw = boxW * 0.42;
      const ch = boxH * 0.64;
      const flips = Math.max(1, specific.flipCount ?? 1);
      const angle = clamp(elapsed / Math.max(0.6, clip.duration * 0.65), 0, 1) * Math.PI * flips;
      const cosA = Math.cos(angle);
      const isBack = cosA < 0;
      const scaleFactor = Math.max(0.04, Math.abs(cosA));

      ctx.save();
      if (specific.flipAxis === 'x') ctx.scale(1, scaleFactor);
      else ctx.scale(scaleFactor, 1);

      ctx.fillStyle = isBack ? visual.secondaryColor : visual.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(-cw / 2, -ch / 2, cw, ch, visual.borderRadius * resScale);
      ctx.fill();

      if (!isBack && activeMedia) {
        drawFittedMedia(ctx, activeMedia, -cw / 2, -ch / 2, cw, ch, visual.borderRadius * resScale);
      }

      ctx.strokeStyle = visual.strokeColor || '#ffffff';
      ctx.lineWidth = Math.max(1.5, (visual.strokeWidth || 2) * resScale);
      ctx.beginPath();
      ctx.roundRect(-cw / 2, -ch / 2, cw, ch, visual.borderRadius * resScale);
      ctx.stroke();

      if (isBack) {
        drawTextLayer(
          ctx,
          {
            id: 'back-t',
            name: 'Back',
            type: 'text',
            visible: true,
            text: specific.backTitle ?? 'AFTER',
            fontSize: 44,
            fontWeight: 800,
            color: '#ffffff',
          },
          boxW,
          boxH,
          resScale,
          anim
        );
      } else if (textLayers[0]) {
        drawTextLayer(ctx, textLayers[0], boxW, boxH, resScale, anim);
      }
      ctx.restore();
      break;
    }

    // -----------------------------------------------------------------------
    // 22. Pixel Disintegration
    // -----------------------------------------------------------------------
    case 'pixel-disintegration': {
      const dissolveT = clamp((elapsed - clip.duration * 0.35) / Math.max(0.4, clip.duration * 0.55), 0, 1);
      const pCount = Math.round(specific.particleQuantity ?? 90);
      const pSize = (specific.particleSize ?? 6) * resScale;

      if (dissolveT < 0.92 && textLayers[0]) {
        ctx.save();
        ctx.globalAlpha *= 1 - dissolveT;
        drawTextLayer(ctx, textLayers[0], boxW, boxH, resScale, anim);
        ctx.restore();
      }

      if (dissolveT > 0.02) {
        for (let i = 0; i < pCount; i++) {
          const seed1 = ((i * 1973) % 1000) / 1000;
          const seed2 = ((i * 3571) % 1000) / 1000;
          const sx = (seed1 - 0.5) * boxW * 0.5;
          const sy = (seed2 - 0.5) * boxH * 0.22;
          let dx = sx;
          let dy = sy;
          const travel = dissolveT * 260 * resScale * (0.4 + seed1);
          if (specific.particleDirection === 'up') dy -= travel;
          else if (specific.particleDirection === 'explode') {
            const a = seed1 * Math.PI * 2;
            dx += Math.cos(a) * travel;
            dy += Math.sin(a) * travel;
          } else if (specific.particleDirection === 'swirl') {
            const a = seed1 * Math.PI * 2 + dissolveT * 4;
            dx += Math.cos(a) * travel * 0.7;
            dy += Math.sin(a) * travel * 0.7;
          } else {
            dx += travel;
            dy += (seed2 - 0.5) * travel * 0.4;
          }
          ctx.save();
          ctx.globalAlpha *= (1 - dissolveT) * 0.9;
          ctx.fillStyle = i % 2 === 0 ? visual.primaryColor : visual.secondaryColor;
          ctx.fillRect(dx, dy, pSize, pSize);
          ctx.restore();
        }
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 23. RGB Split Entrance
    // -----------------------------------------------------------------------
    case 'rgb-split-entrance': {
      const splitDecay = clamp(1 - anim.entranceProgress * 0.75, 0.15, 1);
      const offset = (specific.channelOffset ?? 16) * (specific.splitIntensity ?? 0.85) * splitDecay * resScale;
      const jitter = Math.sin(elapsed * 24) * offset * 0.35;

      for (const layer of textLayers) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.translate(-offset + jitter, 0);
        drawTextLayer(ctx, { ...layer, color: '#ff2a6d' }, boxW, boxH, resScale, anim);
        ctx.restore();

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.translate(offset - jitter, 0);
        drawTextLayer(ctx, { ...layer, color: '#05d9e8' }, boxW, boxH, resScale, anim);
        ctx.restore();

        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 24. Floating Object Showcase
    // -----------------------------------------------------------------------
    case 'floating-object-showcase': {
      const floatY = Math.sin(elapsed * 2.2) * (specific.floatDepth ?? 16) * resScale;
      const ow = boxW * 0.38;
      const oh = boxH * 0.48;

      // Ground shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, oh * 0.62, ow * 0.44, 14 * resScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(0, floatY - 14 * resScale);
      ctx.rotate((((specific.objectRotation ?? 6) * Math.sin(elapsed * 1.3)) * Math.PI) / 180);
      if (activeMedia) {
        drawFittedMedia(ctx, activeMedia, -ow / 2, -oh / 2, ow, oh, visual.borderRadius * resScale);
      } else {
        drawPlaceholderCard(ctx, -ow / 2, -oh / 2, ow, oh, visual.primaryColor, visual.secondaryColor, visual.borderRadius * resScale);
      }
      ctx.restore();

      for (const layer of textLayers) {
        drawTextLayer(ctx, layer, boxW, boxH, resScale, anim);
      }
      break;
    }

    // -----------------------------------------------------------------------
    // 25. Perspective Caption
    // -----------------------------------------------------------------------
    case 'perspective-caption': {
      const skew = ((specific.perspectiveAngle ?? -18) * Math.PI) / 180;
      const ext = Math.max(1, Math.round(specific.extrusionDepth ?? 12));
      const main = textLayers[0];
      if (main) {
        const fontSize = (main.fontSize ?? 78) * resScale;
        ctx.save();
        ctx.font = `${main.fontWeight ?? 800} ${fontSize}px ${main.fontFamily ?? 'Impact, sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.transform(1, Math.sin(skew) * 0.25, -Math.sin(skew) * 0.35, 0.92, 0, 0);

        for (let d = ext; d >= 1; d--) {
          ctx.fillStyle = hexToRgba(main.secondaryColor ?? visual.secondaryColor, 0.45);
          ctx.fillText(main.text ?? '', d * resScale, d * 1.2 * resScale);
        }
        ctx.fillStyle = main.color ?? '#ffffff';
        ctx.fillText(main.text ?? '', 0, 0);
        ctx.restore();
      }
      for (let i = 1; i < textLayers.length; i++) {
        drawTextLayer(ctx, textLayers[i], boxW, boxH, resScale, anim);
      }
      break;
    }

function drawMovingGridBackdrop(
  ctx: CanvasRenderingContext2D,
  boxW: number,
  boxH: number,
  resScale: number,
  elapsed: number,
  clip: GraphicClip
) {
  const { visual, specific } = clip;
  ctx.save();
  ctx.fillStyle = hexToRgba(
    visual.backgroundColor || '#000000',
    visual.backgroundOpacity ?? 1
  );
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);

  const step = Math.max(16, (specific.gridSize ?? 48) * resScale);
  const speed = specific.gridSpeed ?? 1;
  const gOpacity = specific.gridOpacity ?? 0.22;
  const shiftX = (elapsed * 34 * speed * resScale) % step;
  const shiftY = (elapsed * 20 * speed * resScale) % step;

  ctx.strokeStyle = hexToRgba(visual.secondaryColor || '#ffffff', gOpacity);
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

    // -----------------------------------------------------------------------
    // 26. Moving Grid Pop Text (Complete Black BG + Moving Grid + 1-Line Pop)
    // -----------------------------------------------------------------------
    case 'moving-grid-pop-text': {
      drawMovingGridBackdrop(ctx, boxW, boxH, resScale, elapsed, clip);

      // 3. One-line text popping up one by one
      const mainLayer = textLayers[0];
      if (mainLayer && mainLayer.text) {
        const fontSize = (mainLayer.fontSize ?? 60) * resScale;
        const weight = mainLayer.fontWeight ?? 800;
        const family = mainLayer.fontFamily ?? 'Inter, sans-serif';
        const letterSpacing = (mainLayer.letterSpacing ?? 3) * resScale;
        const stagger = Math.max(0.06, animation.stagger || 0.28);
        const popDur = Math.max(0.12, animation.entranceDuration || 0.35);

        ctx.save();
        ctx.font = `${weight} ${fontSize}px ${family}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        if ('letterSpacing' in ctx) {
          (
            ctx as CanvasRenderingContext2D & { letterSpacing: string }
          ).letterSpacing = `${letterSpacing}px`;
        }

        const lx = ((mainLayer.x ?? 0) / 100) * boxW;
        const ly = ((mainLayer.y ?? 0) / 100) * boxH;
        ctx.translate(lx, ly);

        if (specific.popMode === 'line-by-line') {
          const lines = mainLayer.text
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          if (lines.length > 0) {
            const slot = Math.max(0.35, clip.duration / lines.length);
            const activeIdx = Math.min(
              lines.length - 1,
              Math.floor(elapsed / slot)
            );
            const localT = elapsed - activeIdx * slot;
            const p = applyEasing(clamp(localT / popDur, 0, 1), animation.easing);
            const lineText = lines[activeIdx];
            const measured = ctx.measureText(lineText).width;
            const fit = measured > boxW * 0.88 ? (boxW * 0.88) / measured : 1;

            ctx.scale(fit * (0.55 + 0.45 * p), fit * (0.55 + 0.45 * p));
            ctx.globalAlpha *= clamp(p * 1.4, 0, 1);
            ctx.fillStyle = mainLayer.color ?? '#ffffff';
            ctx.fillText(lineText, 0, 0);
          }
        } else {
          // Word-by-word on a single line
          const singleLine = mainLayer.text.replace(/\s+/g, ' ').trim();
          const words = singleLine.split(' ').filter(Boolean);
          if (words.length > 0) {
            const spaceW = ctx.measureText(' ').width * 1.15;
            const widths = words.map((w) => ctx.measureText(w).width);
            const totalW =
              widths.reduce((a, b) => a + b, 0) +
              Math.max(0, words.length - 1) * spaceW;
            const fit = totalW > boxW * 0.9 ? (boxW * 0.9) / totalW : 1;
            ctx.scale(fit, fit);

            let cursorX = -totalW / 2;
            words.forEach((word, idx) => {
              const w = widths[idx];
              const wordT = clamp((elapsed - idx * stagger) / popDur, 0, 1);
              const eased = applyEasing(wordT, animation.easing);
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
      break;
    }

    // -----------------------------------------------------------------------
    // 27. Moving Grid Counter (Complete Black BG + Moving Grid + Count-Up)
    // -----------------------------------------------------------------------
    case 'moving-grid-counter': {
      drawMovingGridBackdrop(ctx, boxW, boxH, resScale, elapsed, clip);

      const fromVal = specific.countFrom ?? 0;
      const toVal = specific.countTo ?? 1000;
      const countDur = Math.max(0.1, specific.countDuration ?? 2.4);
      const decimals = Math.max(0, Math.min(4, Math.round(specific.countDecimals ?? 0)));
      const prefix = specific.countPrefix ?? '';
      const suffix = specific.countSuffix ?? '';

      const rawProg = clamp(elapsed / countDur, 0, 1);
      const easedProg = applyEasing(rawProg, animation.easing);
      const currentVal = fromVal + (toVal - fromVal) * easedProg;

      const formatted = currentVal.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      const displayStr = `${prefix}${formatted}${suffix}`;

      // Subtle arrival pop when target number arrives
      const arriveElapsed = elapsed - countDur;
      const arrivalPop =
        arriveElapsed >= 0 && arriveElapsed < 0.35
          ? 1 + Math.sin((arriveElapsed / 0.35) * Math.PI) * 0.12
          : 1;

      const numLayer = textLayers[0];
      if (numLayer) {
        ctx.save();
        ctx.scale(arrivalPop, arrivalPop);
        drawTextLayer(ctx, numLayer, boxW, boxH, resScale, anim, displayStr);
        ctx.restore();
      }

      for (let i = 1; i < textLayers.length; i++) {
        drawTextLayer(ctx, textLayers[i], boxW, boxH, resScale, anim);
      }
      break;
    }
  }

  drawTextureOverlay(ctx, visual.texture, boxW, boxH, resScale);
  ctx.restore();
}

export function presetToPreviewClip(preset: GraphicPreset): GraphicClip {
  return {
    id: preset.id,
    trackType: 'graphics',
    trackIndex: 0,
    name: preset.name,
    startTime: 0,
    duration: preset.defaultDuration || 4,
    sourceStart: 0,
    sourceDuration: 600,
    templateId: preset.templateId,
    category: preset.category,
    presetName: preset.name,
    layers: preset.layers,
    visual: preset.visual,
    transform: preset.transform,
    animation: preset.animation,
    specific: preset.specific,
  };
}
