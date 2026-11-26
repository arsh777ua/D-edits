export type MediaType = 'video' | 'image' | 'audio';
export type TrackType = 'video' | 'audio' | 'text' | 'captions' | 'graphics';
export type SidebarTab = 'media' | 'text' | 'captions' | 'audio' | 'graphics';
export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface CaptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: CaptionWord[];
}

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  url: string;
  duration: number; // seconds
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  mimeType: string;
}

export interface BaseClip {
  id: string;
  trackType: TrackType;
  trackIndex?: number; // 0 = bottom layer, 1+ = upper overlay layers
  name: string;
  startTime: number; // seconds on timeline
  duration: number; // seconds on timeline
  sourceStart: number; // seconds into original source media
  sourceDuration: number; // original source media duration (seconds)
}

export interface TimelineTrack {
  id: string;
  type: TrackType;
  index: number;
  label: string;
}

export interface VideoClip extends BaseClip {
  trackType: 'video';
  mediaId: string;
  mediaType: 'video' | 'image';
  scale: number; // 0.1 - 3.0
  x: number; // -100 to 100 (% of canvas width)
  y: number; // -100 to 100 (% of canvas height)
  cropTop: number; // 0 - 45 (%)
  cropRight: number; // 0 - 45 (%)
  cropBottom: number; // 0 - 45 (%)
  cropLeft: number; // 0 - 45 (%)
  rotate: number; // -180 to 180 (deg)
  volume: number; // 0 - 2
  speed: PlaybackSpeed;
  brightness: number; // 0.2 - 2.0 (1 = normal)
  contrast: number; // 0.2 - 2.0 (1 = normal)
}

export interface AudioClip extends BaseClip {
  trackType: 'audio';
  mediaId: string;
  volume: number; // 0 - 2
  fadeIn: number; // seconds
  fadeOut: number; // seconds
}

export type CaptionTemplateId =
  | 'none'
  | 'one-word-pop'
  | 'one-word-box'
  | 'phrase-box'
  | 'phrase-clean'
  | 'phrase-highlight'
  | 'phrase-highlight-box'
  | 'neon-glow'
  | 'typewriter-wave';

export interface TextClip extends BaseClip {
  trackType: 'text' | 'captions';
  text: string;
  fontSize: number; // px relative to 720p height
  color: string;
  fontFamily: string;
  x: number; // -50 to 50 (% from center)
  y: number; // -50 to 50 (% from center)
  bold?: boolean;
  outlineColor?: string;
  outlineWidth?: number; // 0 - 12
  shadowColor?: string;
  shadowBlur?: number; // 0 - 24
  captionTemplate?: CaptionTemplateId;
  words?: CaptionWord[];
  highlightColor?: string;
  bgColor?: string;
  bgOpacity?: number; // 0 - 1
}

export type GraphicCategory =
  | 'cinematic-typography'
  | 'footage-enhancement'
  | 'creative-transitions'
  | 'modern-elements'
  | 'special-creative'
  | 'my-templates';

export type GraphicTemplateId =
  | 'cinematic-title-reveal'
  | 'text-behind-subject'
  | 'floating-3d-text'
  | 'kinetic-typography'
  | 'editorial-title-layout'
  | 'subject-pop-out'
  | 'magnified-detail'
  | 'motion-echo'
  | 'spotlight-focus'
  | 'film-strip'
  | 'paper-tear-reveal'
  | 'sliding-film-panels'
  | 'infinite-frame'
  | 'snapshot-explosion'
  | 'liquid-shape-reveal'
  | 'floating-glass-panels'
  | 'neon-line-composition'
  | 'tracking-hud'
  | 'doodle-pack'
  | 'desktop-popups'
  | 'flip-card-3d'
  | 'pixel-disintegration'
  | 'rgb-split-entrance'
  | 'floating-object-showcase'
  | 'perspective-caption'
  | 'moving-grid-pop-text'
  | 'moving-grid-counter';

export type GraphicLayerType =
  | 'text'
  | 'shape'
  | 'media'
  | 'icon'
  | 'doodle'
  | 'window';

export type GraphicIconName =
  | 'arrow'
  | 'circle'
  | 'star'
  | 'sparkle'
  | 'check'
  | 'crosshair'
  | 'scribble'
  | 'underline'
  | 'bolt';

export interface GraphicLayer {
  id: string;
  name: string;
  type: GraphicLayerType;
  visible: boolean;
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number; // px relative to 720p
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  secondaryColor?: string;
  bgColor?: string;
  bgOpacity?: number;
  mediaId?: string;
  iconName?: GraphicIconName;
  x?: number; // -50 to 50 (% offset)
  y?: number; // -50 to 50 (% offset)
  scale?: number;
  rotation?: number;
  opacity?: number;
  delay?: number;
}

export type GraphicBlendMode =
  | 'source-over'
  | 'screen'
  | 'multiply'
  | 'overlay'
  | 'lighten'
  | 'color-dodge';

export type GraphicTexture = 'none' | 'grain' | 'scanlines' | 'halftone' | 'grid';

export interface GraphicVisualStyle {
  backgroundColor: string;
  backgroundOpacity: number; // 0 - 1
  primaryColor: string;
  secondaryColor: string;
  gradientEnabled: boolean;
  gradientAngle: number; // 0 - 360
  strokeColor: string;
  strokeWidth: number; // 0 - 16
  borderRadius: number; // 0 - 60
  shadowBlur: number; // 0 - 40
  shadowColor: string;
  glowIntensity: number; // 0 - 40
  opacity: number; // 0 - 1
  blendMode: GraphicBlendMode;
  texture: GraphicTexture;
}

export interface GraphicTransform {
  x: number; // -100 to 100 (% of canvas width)
  y: number; // -100 to 100 (% of canvas height)
  width: number; // 10 - 200 (% of canvas)
  height: number; // 10 - 200 (% of canvas)
  scaleX: number; // 0.1 - 3
  scaleY: number; // 0.1 - 3
  rotation: number; // -180 to 180
  anchorX: number; // -50 to 50
  anchorY: number; // -50 to 50
  alignH: 'left' | 'center' | 'right';
  alignV: 'top' | 'middle' | 'bottom';
  cropTop: number; // 0 - 45
  cropRight: number; // 0 - 45
  cropBottom: number; // 0 - 45
  cropLeft: number; // 0 - 45
}

export type GraphicEntranceAnim =
  | 'none'
  | 'fade'
  | 'scale-pop'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'blur-in'
  | 'typewriter';

export type GraphicExitAnim =
  | 'none'
  | 'fade'
  | 'scale-down'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'blur-out';

export type GraphicLoopAnim =
  | 'none'
  | 'float'
  | 'pulse'
  | 'orbit'
  | 'shimmer'
  | 'breathe';

export type GraphicEasing =
  | 'linear'
  | 'ease-out'
  | 'ease-in-out'
  | 'back-out'
  | 'elastic';

export interface GraphicAnimation {
  entrance: GraphicEntranceAnim;
  exit: GraphicExitAnim;
  loop: GraphicLoopAnim;
  entranceDuration: number; // seconds
  exitDuration: number; // seconds
  delay: number; // seconds
  speed: number; // 0.25 - 3
  easing: GraphicEasing;
  direction: 'up' | 'down' | 'left' | 'right' | 'center';
  stagger: number; // seconds
}

export interface GraphicSpecificProps {
  // Cinematic Title Reveal
  letterboxBars?: number;
  flareIntensity?: number;
  // Text Behind Subject
  maskSource?: 'auto-luma' | 'center-oval' | 'center-rect' | 'custom-media';
  textDepth?: number;
  overlapAmount?: number;
  // Floating 3D Text
  depth3D?: number;
  cameraDrift?: number;
  // Kinetic Typography
  kineticMode?: 'word' | 'character';
  wordSpacing?: number;
  // Editorial Title
  issueLabel?: string;
  layoutVariant?: 'minimal' | 'bold-split' | 'feature';
  // Subject Pop-Out
  maskShape?: 'oval' | 'rounded-rect' | 'polygon';
  outlineWidth?: number;
  edgeFeather?: number;
  shadowDistance?: number;
  freezePop?: boolean;
  // Magnified Detail
  zoomAmount?: number;
  magnifierShape?: 'circle' | 'rounded' | 'square';
  targetX?: number;
  targetY?: number;
  // Motion Echo
  echoCount?: number;
  echoSpacing?: number;
  echoOpacity?: number;
  // Spotlight Focus
  spotlightRadius?: number;
  spotlightFeather?: number;
  spotlightShape?: 'circle' | 'ellipse' | 'rect';
  // Film Strip
  frameCount?: number;
  frameSpacing?: number;
  scrollSpeed?: number;
  // Paper Tear
  tearShape?: 'jagged' | 'wave' | 'diagonal';
  edgeRoughness?: number;
  tearDirection?: 'left' | 'right' | 'center' | 'top';
  // Sliding Panels
  panelCount?: number;
  panelSpacing?: number;
  panelStagger?: number;
  panelOrientation?: 'vertical' | 'horizontal';
  // Infinite Frame
  nestedCount?: number;
  zoomDepth?: number;
  // Snapshot Explosion
  photoCount?: number;
  spreadRotation?: number;
  collageLayout?: 'fan' | 'scatter' | 'grid';
  // Liquid Reveal
  blobComplexity?: number;
  revealDirection?: 'center' | 'left' | 'right' | 'bottom';
  // Glass Panels
  glassOpacity?: number;
  glassBlur?: number;
  reflectionStrength?: number;
  // Neon Lines
  neonGlow?: number;
  lineThickness?: number;
  lineStyle?: 'solid' | 'dashed' | 'double';
  // Tracking HUD
  bracketSize?: number;
  hudLabel?: string;
  showCrosshair?: boolean;
  // Doodle Pack
  doodleStyle?: 'hand-drawn' | 'clean' | 'marker';
  strokeRoughness?: number;
  // Desktop Popups
  windowTheme?: 'dark' | 'light' | 'retro';
  windowLayout?: 'stacked' | 'cascade' | 'card';
  // 3D Flip Card
  flipAxis?: 'y' | 'x';
  flipCount?: number;
  backTitle?: string;
  backSubtitle?: string;
  // Pixel Disintegration
  particleQuantity?: number;
  particleSize?: number;
  particleDirection?: 'right' | 'up' | 'explode' | 'swirl';
  // RGB Split
  channelOffset?: number;
  splitIntensity?: number;
  // Floating Object
  floatDepth?: number;
  lightAngle?: number;
  objectRotation?: number;
  // Perspective Caption
  perspectiveAngle?: number;
  extrusionDepth?: number;
  tiltX?: number;
  // Moving Grid Pop Text
  gridSize?: number;
  gridSpeed?: number;
  gridOpacity?: number;
  popMode?: 'word-by-word' | 'line-by-line';
  // Moving Grid Counter
  countFrom?: number;
  countTo?: number;
  countDuration?: number;
  countPrefix?: string;
  countSuffix?: string;
  countDecimals?: number;
}

export interface GraphicSfxSettings {
  enabled: boolean;
  sfxFile: string;
  sfxName?: string;
  volume: number; // 0 - 2
  triggerMode: 'on-start' | 'per-word' | 'on-target';
  delay?: number; // seconds
}

export interface GraphicClip extends BaseClip {
  trackType: 'graphics';
  templateId: GraphicTemplateId;
  category: GraphicCategory;
  presetName?: string;
  layers: GraphicLayer[];
  visual: GraphicVisualStyle;
  transform: GraphicTransform;
  animation: GraphicAnimation;
  specific: GraphicSpecificProps;
  sfx?: GraphicSfxSettings;
}

export interface GraphicPreset {
  id: string;
  name: string;
  description: string;
  templateId: GraphicTemplateId;
  category: GraphicCategory;
  defaultDuration: number;
  layers: GraphicLayer[];
  visual: GraphicVisualStyle;
  transform: GraphicTransform;
  animation: GraphicAnimation;
  specific: GraphicSpecificProps;
  sfx?: GraphicSfxSettings;
  isCustom?: boolean;
  createdAt?: number;
}

export type TimelineClip = VideoClip | AudioClip | TextClip | GraphicClip;

export type ExportQuality = 'standard' | 'high' | 'ultra';
export type ExportEncoder = 'fast' | 'hq';

export interface ExportSettings {
  resolution: '720p' | '1080p' | '1440p' | '2160p' | 'project';
  width?: number;
  height?: number;
  fps: 24 | 25 | 30 | 50 | 60;
  quality: ExportQuality;
  encoder: ExportEncoder;
  customBitrateMbps?: number;
}

export type ResolutionPreset =
  | '360p'
  | '480p'
  | '720p'
  | '1080p'
  | '1440p'
  | '2160p'
  | 'custom';

export type AspectRatioPreset =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:5'
  | '21:9'
  | 'custom';

export type FrameRateOption = 24 | 25 | 30 | 50 | 60;
export type PreviewBackground = 'black' | 'checkerboard' | 'custom';

export interface ProjectSettings {
  resolutionPreset: ResolutionPreset;
  aspectRatioPreset: AspectRatioPreset;
  width: number;
  height: number;
  fps: FrameRateOption;
  locationLabel: string;
  previewBackground: PreviewBackground;
  previewBackgroundColor: string;
}

export interface SerializedMediaRef {
  id: string;
  name: string;
  type: MediaType;
  duration: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  mimeType: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  settings: ProjectSettings;
  clips: TimelineClip[];
  mediaRefs: SerializedMediaRef[];
  duration: number;
  thumbnailUrl?: string;
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
}

export interface ExportProgress {
  status: 'idle' | 'preparing' | 'rendering' | 'encoding' | 'done' | 'error';
  progress: number; // 0 - 100
  message: string;
  outputUrl?: string;
  error?: string;
}
