import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AudioClip,
  CaptionTemplateId,
  CaptionWord,
  MediaAsset,
  PlaybackSpeed,
  TextClip,
  TimelineClip,
  TimelineTrack,
  TrackType,
  VideoClip,
} from '../types/editor';
import { createMediaAsset } from '../utils/media';
import { saveMediaBlob } from '../utils/projectStorage';
import { clamp, uid } from '../utils/time';
import {
  getProjectDuration,
  getTrackEndTime,
  rippleDeleteLeftAtTime,
  rippleDeleteRightAtTime,
  splitClipAtTime,
} from '../utils/timeline';

const MAX_HISTORY = 60;

const DEFAULT_TRACKS: TimelineTrack[] = [
  { id: 'captions-0', type: 'captions', index: 0, label: 'Captions 1' },
  { id: 'text-0', type: 'text', index: 0, label: 'Text 1' },
  { id: 'video-1', type: 'video', index: 1, label: 'Video 2' },
  { id: 'video-0', type: 'video', index: 0, label: 'Video 1' },
  { id: 'audio-0', type: 'audio', index: 0, label: 'Audio 1' },
];

function buildTracksForClips(clips: TimelineClip[]): TimelineTrack[] {
  const maxIdx: Record<TrackType, number> = {
    captions: 0,
    text: 0,
    video: 1,
    audio: 0,
  };
  for (const c of clips) {
    const idx = c.trackIndex ?? 0;
    if (idx > maxIdx[c.trackType]) maxIdx[c.trackType] = idx;
  }
  const result: TimelineTrack[] = [];
  for (let i = maxIdx.captions; i >= 0; i--) {
    result.push({
      id: `captions-${i}`,
      type: 'captions',
      index: i,
      label: `Captions ${i + 1}`,
    });
  }
  for (let i = maxIdx.text; i >= 0; i--) {
    result.push({ id: `text-${i}`, type: 'text', index: i, label: `Text ${i + 1}` });
  }
  for (let i = maxIdx.video; i >= 0; i--) {
    result.push({ id: `video-${i}`, type: 'video', index: i, label: `Video ${i + 1}` });
  }
  for (let i = 0; i <= maxIdx.audio; i++) {
    result.push({ id: `audio-${i}`, type: 'audio', index: i, label: `Audio ${i + 1}` });
  }
  return result;
}

export function useEditorState() {
  const [projectName, setProjectName] = useState('Untitled Project');
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Undo/redo history for timeline clips
  const [past, setPast] = useState<TimelineClip[][]>([]);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [future, setFuture] = useState<TimelineClip[][]>([]);
  const [tracks, setTracks] = useState<TimelineTrack[]>(DEFAULT_TRACKS);

  const clipsRef = useRef<TimelineClip[]>(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [clipboardClips, setClipboardClips] = useState<TimelineClip[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(50); // pixels per second

  const selectedClipId =
    selectedClipIds.length > 0
      ? selectedClipIds[selectedClipIds.length - 1]
      : null;

  const setSelectedClipId = useCallback(
    (id: string | null, additive = false) => {
      if (!id) {
        setSelectedClipIds([]);
        return;
      }
      if (additive) {
        setSelectedClipIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
      } else {
        setSelectedClipIds([id]);
      }
    },
    []
  );

  const selectAllClips = useCallback(() => {
    const allIds = clipsRef.current.map((c) => c.id);
    if (allIds.length === 0) return false;
    setSelectedClipIds(allIds);
    return true;
  }, []);

  const projectDuration = useMemo(() => getProjectDuration(clips), [clips]);

  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  );

  const pushHistory = useCallback((previousClips: TimelineClip[]) => {
    setPast((prev) => [...prev.slice(-(MAX_HISTORY - 1)), previousClips]);
    setFuture([]);
  }, []);

  const applyEdit = useCallback(
    (updater: (prev: TimelineClip[]) => TimelineClip[]) => {
      const current = clipsRef.current;
      const next = updater(current);
      if (next === current) return;
      pushHistory(current);
      clipsRef.current = next;
      setClips(next);
    },
    [pushHistory]
  );

  const setClipsLive = useCallback((updater: (prev: TimelineClip[]) => TimelineClip[]) => {
    setClips((prev) => {
      const next = updater(prev);
      clipsRef.current = next;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((prevFuture) => [clipsRef.current, ...prevFuture]);
      clipsRef.current = previous;
      setClips(previous);
      setSelectedClipIds((sel) =>
        sel.filter((id) => previous.some((c) => c.id === id))
      );
      return prevPast.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPast((prevPast) => [...prevPast, clipsRef.current]);
      clipsRef.current = next;
      setClips(next);
      setSelectedClipIds((sel) =>
        sel.filter((id) => next.some((c) => c.id === id))
      );
      return prevFuture.slice(1);
    });
  }, []);

  const addMediaFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const created: MediaAsset[] = [];
    for (const file of fileArray) {
      const asset = await createMediaAsset(file, (msg) => setImportStatus(msg));
      if (asset) {
        await saveMediaBlob(asset.id, asset.file).catch(() => {});
        created.push(asset);
      }
    }
    setImportStatus(null);
    if (created.length > 0) {
      setMediaAssets((prev) => [...created, ...prev]);
    }
    return created;
  }, []);

  const hydrateProjectSession = useCallback(
    (name: string, nextClips: TimelineClip[], nextAssets: MediaAsset[]) => {
      setProjectName(name);
      setPast([]);
      setFuture([]);
      clipsRef.current = nextClips;
      setClips(nextClips);
      setTracks(buildTracksForClips(nextClips));
      setMediaAssets(nextAssets);
      setSelectedClipIds([]);
      setPlayhead(0);
      setIsPlaying(false);
    },
    []
  );

  const addTrack = useCallback((type: TrackType) => {
    setTracks((prev) => {
      const sameType = prev.filter((t) => t.type === type);
      const nextIndex =
        sameType.length > 0
          ? Math.max(...sameType.map((t) => t.index)) + 1
          : 0;
      const labelPrefix =
        type === 'video'
          ? 'Video'
          : type === 'text'
            ? 'Text'
            : type === 'captions'
              ? 'Captions'
              : 'Audio';
      const newTrack: TimelineTrack = {
        id: `${type}-${nextIndex}`,
        type,
        index: nextIndex,
        label: `${labelPrefix} ${nextIndex + 1}`,
      };
      if (type === 'audio') {
        return [...prev, newTrack];
      }
      // Insert upper video/text layers at the top of their section
      const firstOfType = prev.findIndex((t) => t.type === type);
      if (firstOfType === -1) return [newTrack, ...prev];
      const copy = [...prev];
      copy.splice(firstOfType, 0, newTrack);
      return copy;
    });
  }, []);

  const removeTrack = useCallback(
    (type: TrackType, index: number) => {
      setTracks((prev) => {
        const sameType = prev.filter((t) => t.type === type);
        if (sameType.length <= 1) return prev;
        return prev.filter((t) => !(t.type === type && t.index === index));
      });

      const hasClipsOnTrack = clipsRef.current.some(
        (c) => c.trackType === type && (c.trackIndex ?? 0) === index
      );
      if (hasClipsOnTrack) {
        applyEdit((prev) =>
          prev.filter(
            (c) => !(c.trackType === type && (c.trackIndex ?? 0) === index)
          )
        );
        setSelectedClipIds((sel) =>
          sel.filter((id) => {
            const c = clipsRef.current.find((x) => x.id === id);
            return c && !(c.trackType === type && (c.trackIndex ?? 0) === index);
          })
        );
      }
    },
    [applyEdit]
  );

  const removeMediaAsset = useCallback(
    (assetId: string) => {
      setMediaAssets((prev) => {
        const target = prev.find((a) => a.id === assetId);
        if (target) URL.revokeObjectURL(target.url);
        return prev.filter((a) => a.id !== assetId);
      });
      applyEdit((prev) =>
        prev.filter((c) => !('mediaId' in c && c.mediaId === assetId))
      );
    },
    [applyEdit]
  );

  const addMediaToTimeline = useCallback(
    (asset: MediaAsset, explicitStartTime?: number, trackIndex = 0) => {
      let newClip: TimelineClip;

      if (asset.type === 'audio') {
        const start =
          explicitStartTime !== undefined
            ? Math.max(0, explicitStartTime)
            : getTrackEndTime(clipsRef.current, 'audio', trackIndex);
        const clip: AudioClip = {
          id: uid('clip'),
          trackType: 'audio',
          trackIndex,
          mediaId: asset.id,
          name: asset.name,
          startTime: start,
          duration: asset.duration,
          sourceStart: 0,
          sourceDuration: asset.duration,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
        };
        newClip = clip;
      } else {
        const start =
          explicitStartTime !== undefined
            ? Math.max(0, explicitStartTime)
            : getTrackEndTime(clipsRef.current, 'video', trackIndex);
        const clip: VideoClip = {
          id: uid('clip'),
          trackType: 'video',
          trackIndex,
          mediaId: asset.id,
          mediaType: asset.type,
          name: asset.name,
          startTime: start,
          duration: asset.duration,
          sourceStart: 0,
          sourceDuration: asset.type === 'image' ? 600 : asset.duration,
          scale: 1,
          x: 0,
          y: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
          rotate: 0,
          volume: 1,
          speed: 1,
          brightness: 1,
          contrast: 1,
        };
        newClip = clip;
      }

      applyEdit((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
    },
    [applyEdit, setSelectedClipId]
  );

  const addTextClip = useCallback(
    (preset?: Partial<TextClip>, trackIndex = 0, explicitStartTime?: number) => {
      const start =
        explicitStartTime !== undefined
          ? Math.max(0, explicitStartTime)
          : Math.max(0, playhead);
      const clip: TextClip = {
        id: uid('clip'),
        trackType: 'text',
        trackIndex,
        name: preset?.text || 'Text Overlay',
        startTime: start,
        duration: 4,
        sourceStart: 0,
        sourceDuration: 600,
        text: preset?.text ?? 'Double-click or edit text',
        fontSize: preset?.fontSize ?? 42,
        color: preset?.color ?? '#ffffff',
        fontFamily: preset?.fontFamily ?? 'Inter, sans-serif',
        x: preset?.x ?? 0,
        y: preset?.y ?? 25,
      };
      applyEdit((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
    },
    [applyEdit, playhead, setSelectedClipId]
  );

  const addCaptionClips = useCallback(
    (
      segments: Array<{
        start: number;
        end: number;
        text: string;
        words?: CaptionWord[];
      }>,
      style: {
        fontSize: number;
        color: string;
        y: number;
        fontFamily?: string;
        captionTemplate?: CaptionTemplateId;
        highlightColor?: string;
        bgColor?: string;
        bgOpacity?: number;
        outlineWidth?: number;
      },
      trackIndex = 0
    ) => {
      if (segments.length === 0) return;
      const created: TextClip[] = segments.map((seg) => ({
        id: uid('clip'),
        trackType: 'captions',
        trackIndex,
        name: seg.text,
        startTime: Math.max(0, seg.start),
        duration: Math.max(0.18, seg.end - seg.start),
        sourceStart: 0,
        sourceDuration: 600,
        text: seg.text,
        words: seg.words,
        fontSize: style.fontSize,
        color: style.color,
        fontFamily: style.fontFamily ?? 'Inter, sans-serif',
        x: 0,
        y: style.y,
        bold: true,
        outlineColor: '#000000',
        outlineWidth: style.outlineWidth ?? 0,
        captionTemplate: style.captionTemplate ?? 'none',
        highlightColor: style.highlightColor ?? '#fde047',
        bgColor: style.bgColor ?? '#000000',
        bgOpacity: style.bgOpacity ?? 0,
      }));
      applyEdit((prev) => [...prev, ...created]);
      setSelectedClipId(created[0].id);
    },
    [applyEdit, setSelectedClipId]
  );

  const applyStyleToAllTextClips = useCallback(
    (sourceClipId: string) => {
      const source = clipsRef.current.find(
        (c) =>
          c.id === sourceClipId &&
          (c.trackType === 'text' || c.trackType === 'captions')
      ) as TextClip | undefined;
      if (!source) return;

      applyEdit((prev) =>
        prev.map((c) => {
          if (c.trackType !== source.trackType) return c;
          return {
            ...c,
            fontFamily: source.fontFamily,
            fontSize: source.fontSize,
            color: source.color,
            x: source.x,
            y: source.y,
            bold: source.bold,
            outlineColor: source.outlineColor,
            outlineWidth: source.outlineWidth,
            shadowColor: source.shadowColor,
            shadowBlur: source.shadowBlur,
            captionTemplate: source.captionTemplate,
            highlightColor: source.highlightColor,
            bgColor: source.bgColor,
            bgOpacity: source.bgOpacity,
          };
        })
      );
    },
    [applyEdit]
  );

  const updateClip = useCallback(
    (id: string, patch: Partial<TimelineClip>, recordHistory = true) => {
      const updater = (prev: TimelineClip[]) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const updated = { ...c, ...patch } as TimelineClip;
          // If video speed changed, adjust timeline duration proportionally
          if (
            c.trackType === 'video' &&
            'speed' in patch &&
            patch.speed &&
            patch.speed !== c.speed
          ) {
            const oldSpeed = c.speed;
            const newSpeed = patch.speed as PlaybackSpeed;
            const sourceUsed = c.duration * oldSpeed;
            updated.duration = Math.max(0.2, sourceUsed / newSpeed);
          }
          if (
            (updated.trackType === 'text' || updated.trackType === 'captions') &&
            'text' in patch &&
            patch.text !== undefined
          ) {
            updated.name = patch.text.trim() || 'Text';
          }
          return updated;
        });

      if (recordHistory) {
        applyEdit(updater);
      } else {
        setClipsLive(updater);
      }
    },
    [applyEdit, setClipsLive]
  );

  const splitAtPlayhead = useCallback(() => {
    const t = playhead;
    const candidates =
      selectedClipIds.length > 0
        ? clipsRef.current.filter(
            (c) =>
              selectedClipIds.includes(c.id) &&
              t > c.startTime + 0.2 &&
              t < c.startTime + c.duration - 0.2
          )
        : [];

    if (candidates.length === 0) return false;

    applyEdit((prev) => {
      let next = prev;
      for (const target of candidates) {
        next = splitClipAtTime(next, target.id, t);
      }
      return next;
    });
    return true;
  }, [applyEdit, playhead, selectedClipIds]);

  const rippleDeleteLeft = useCallback(() => {
    const t = playhead;
    const target =
      selectedClipIds.length > 0
        ? clipsRef.current.find(
            (c) =>
              selectedClipIds.includes(c.id) &&
              t > c.startTime + 0.2 &&
              t < c.startTime + c.duration - 0.2
          )
        : undefined;

    if (!target) return false;
    const res = rippleDeleteLeftAtTime(clipsRef.current, target.id, t);
    if (!res) return false;

    applyEdit(() => res.clips);
    setPlayhead(res.nextPlayhead);
    return true;
  }, [applyEdit, playhead, selectedClipIds]);

  const rippleDeleteRight = useCallback(() => {
    const t = playhead;
    const target =
      selectedClipIds.length > 0
        ? clipsRef.current.find(
            (c) =>
              selectedClipIds.includes(c.id) &&
              t > c.startTime + 0.2 &&
              t < c.startTime + c.duration - 0.2
          )
        : undefined;

    if (!target) return false;
    const nextClips = rippleDeleteRightAtTime(clipsRef.current, target.id, t);
    if (!nextClips) return false;

    applyEdit(() => nextClips);
    return true;
  }, [applyEdit, playhead, selectedClipIds]);

  const deleteSelectedClip = useCallback(() => {
    if (selectedClipIds.length === 0) return false;
    const toRemove = new Set(selectedClipIds);
    applyEdit((prev) => prev.filter((c) => !toRemove.has(c.id)));
    setSelectedClipIds([]);
    return true;
  }, [applyEdit, selectedClipIds]);

  const copySelectedClips = useCallback(() => {
    if (selectedClipIds.length === 0) return false;
    const selected = clipsRef.current.filter((c) =>
      selectedClipIds.includes(c.id)
    );
    if (selected.length === 0) return false;
    setClipboardClips(selected.map((c) => ({ ...c })));
    return true;
  }, [selectedClipIds]);

  const pasteClips = useCallback(() => {
    if (clipboardClips.length === 0) return false;
    const minStart = Math.min(...clipboardClips.map((c) => c.startTime));
    const newClips = clipboardClips.map((c) => ({
      ...c,
      id: uid('clip'),
      startTime: Math.max(0, playhead + (c.startTime - minStart)),
    }));
    applyEdit((prev) => [...prev, ...newClips]);
    setSelectedClipIds(newClips.map((c) => c.id));
    return true;
  }, [applyEdit, clipboardClips, playhead]);

  const duplicateSelectedClips = useCallback(() => {
    if (selectedClipIds.length === 0) return false;
    const selected = clipsRef.current.filter((c) =>
      selectedClipIds.includes(c.id)
    );
    if (selected.length === 0) return false;

    const minStart = Math.min(...selected.map((c) => c.startTime));
    const maxEnd = Math.max(...selected.map((c) => c.startTime + c.duration));
    const span = maxEnd - minStart;

    const clones = selected.map((c) => ({
      ...c,
      id: uid('clip'),
      startTime: c.startTime + span,
    }));
    applyEdit((prev) => [...prev, ...clones]);
    setSelectedClipIds(clones.map((c) => c.id));
    return true;
  }, [applyEdit, selectedClipIds]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && playhead >= projectDuration && projectDuration > 0) {
        setPlayhead(0);
      }
      return !prev;
    });
  }, [playhead, projectDuration]);

  const stepFrame = useCallback(
    (direction: number, fps = 30) => {
      setIsPlaying(false);
      setPlayhead((prev) => clamp(prev + direction / fps, 0, Math.max(projectDuration, 0)));
    },
    [projectDuration]
  );

  return {
    projectName,
    setProjectName,
    mediaAssets,
    importStatus,
    addMediaFiles,
    hydrateProjectSession,
    removeMediaAsset,
    clips,
    tracks,
    addTrack,
    removeTrack,
    projectDuration,
    selectedClipId,
    selectedClipIds,
    setSelectedClipId,
    setSelectedClipIds,
    selectAllClips,
    selectedClip,
    hasClipboard: clipboardClips.length > 0,
    playhead,
    setPlayhead,
    isPlaying,
    setIsPlaying,
    togglePlay,
    stepFrame,
    zoom,
    setZoom,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    pushHistory,
    setClipsLive,
    applyEdit,
    addMediaToTimeline,
    addTextClip,
    addCaptionClips,
    applyStyleToAllTextClips,
    updateClip,
    splitAtPlayhead,
    rippleDeleteLeft,
    rippleDeleteRight,
    deleteSelectedClip,
    copySelectedClips,
    pasteClips,
    duplicateSelectedClips,
  };
}
