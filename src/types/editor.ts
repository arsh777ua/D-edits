export type MediaType = 'video' | 'image' | 'audio';
export type TrackType = 'video' | 'audio' | 'text' | 'captions';
export type SidebarTab = 'media' | 'text' | 'captions' | 'audio';
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

export type TimelineClip = VideoClip | AudioClip | TextClip;

export type ExportQuality = 'standard' | 'high' | 'ultra';
export type ExportEncoder = 'fast' | 'hq';

export interface ExportSettings {
  resolution: '720p' | '1080p' | '1440p' | '2160p' | 'project';
  width?: number;
  height?: number;
  fps: 24 | 25 | 30 | 50 | 60;
  quality: ExportQuality;
  encoder: ExportEncoder;
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
