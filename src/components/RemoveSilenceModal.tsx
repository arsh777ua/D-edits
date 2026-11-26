import { Loader2, Scissors, VolumeX, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  AudioClip,
  MediaAsset,
  TimelineClip,
  VideoClip,
} from '../types/editor';
import {
  buildClipsFromActiveSegments,
  decodeAssetAudioBuffer,
  detectActiveSegments,
  type SilenceRemovalOptions,
} from '../utils/silenceRemoval';

interface RemoveSilenceModalProps {
  open: boolean;
  clip: VideoClip | AudioClip | null;
  mediaAsset: MediaAsset | null;
  onClose: () => void;
  onApply: (targetClipId: string, replacementClips: TimelineClip[]) => void;
}

export function RemoveSilenceModal({
  open,
  clip,
  mediaAsset,
  onClose,
  onApply,
}: RemoveSilenceModalProps) {
  const [options, setOptions] = useState<SilenceRemovalOptions>({
    thresholdDb: -35,
    minSilenceSec: 0.5,
    paddingSec: 0.3,
    rippleCloseGaps: true,
  });
  const [decodedState, setDecodedState] = useState<{
    assetId: string;
    buffer: AudioBuffer | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open || !mediaAsset) return;
    let active = true;

    decodeAssetAudioBuffer(mediaAsset)
      .then((buf) => {
        if (active) {
          setDecodedState({ assetId: mediaAsset.id, buffer: buf, error: null });
        }
      })
      .catch(() => {
        if (active) {
          setDecodedState({
            assetId: mediaAsset.id,
            buffer: null,
            error:
              'Could not decode an audio track from this clip. Make sure the file contains audio.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [open, mediaAsset]);

  const isLoading =
    Boolean(open && mediaAsset) && decodedState?.assetId !== mediaAsset?.id;
  const audioBuffer =
    decodedState && decodedState.assetId === mediaAsset?.id
      ? decodedState.buffer
      : null;
  const error =
    decodedState && decodedState.assetId === mediaAsset?.id
      ? decodedState.error
      : null;

  const analysis = useMemo(() => {
    if (!audioBuffer || !clip) return null;
    return detectActiveSegments(audioBuffer, clip, options);
  }, [audioBuffer, clip, options]);

  if (!open || !clip) return null;

  const pctSaved =
    analysis && analysis.originalDuration > 0
      ? Math.round((analysis.removedSeconds / analysis.originalDuration) * 100)
      : 0;

  const handleConfirm = () => {
    if (!analysis || analysis.segments.length === 0) return;
    const replacement = buildClipsFromActiveSegments(
      clip,
      analysis.segments,
      options.rippleCloseGaps
    );
    onApply(clip.id, replacement);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[#16181d] border border-[#2a2d36] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[#262932] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#00d4c6]/15 text-[#00d4c6] flex items-center justify-center">
              <VolumeX className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Remove Silent Parts
              </h2>
              <p className="text-[11px] text-[#8c92a0] truncate max-w-[260px]">
                {clip.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {isLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-[#9aa0ad]">
              <Loader2 className="w-6 h-6 animate-spin text-[#00d4c6]" />
              <p className="text-xs">Analyzing audio waveform...</p>
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          ) : (
            <>
              {analysis && (
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#121419] border border-[#262932] text-center">
                  <div>
                    <p className="text-[10px] text-[#7e8494]">Kept Clips</p>
                    <p className="text-sm font-semibold text-white font-mono">
                      {analysis.segments.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#7e8494]">New Duration</p>
                    <p className="text-sm font-semibold text-[#00d4c6] font-mono">
                      {analysis.keptDuration.toFixed(1)}s
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#7e8494]">Silence Cut</p>
                    <p className="text-sm font-semibold text-[#fde047] font-mono">
                      -{analysis.removedSeconds.toFixed(1)}s ({pctSaved}%)
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#9aa0ad]">Silence Threshold</span>
                    <span className="font-mono text-white">
                      {options.thresholdDb} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-60}
                    max={-15}
                    step={1}
                    value={options.thresholdDb}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        thresholdDb: Number(e.target.value),
                      }))
                    }
                    className="editor-slider w-full"
                  />
                  <p className="text-[10px] text-[#6d7382]">
                    Audio quieter than this level is treated as silence.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#9aa0ad]">Min Silence Duration</span>
                    <span className="font-mono text-white">
                      {options.minSilenceSec.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.05}
                    value={options.minSilenceSec}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        minSilenceSec: Number(e.target.value),
                      }))
                    }
                    className="editor-slider w-full"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#9aa0ad]">Speech Padding</span>
                    <span className="font-mono text-white">
                      {options.paddingSec.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.02}
                    value={options.paddingSec}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        paddingSec: Number(e.target.value),
                      }))
                    }
                    className="editor-slider w-full"
                  />
                </div>

                <label className="flex items-center justify-between pt-1 cursor-pointer">
                  <span className="text-xs text-[#d0d4dc]">
                    Close gaps automatically (ripple)
                  </span>
                  <input
                    type="checkbox"
                    checked={options.rippleCloseGaps}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        rippleCloseGaps: e.target.checked,
                      }))
                    }
                    className="accent-[#00d4c6] w-4 h-4 cursor-pointer"
                  />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 bg-[#121419] border-t border-[#262932] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-[#232630] hover:bg-[#2c303c] text-xs font-medium text-[#d0d4dc] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              isLoading ||
              Boolean(error) ||
              !analysis ||
              analysis.segments.length === 0
            }
            onClick={handleConfirm}
            className="px-4 py-1.5 rounded-lg bg-[#00d4c6] hover:bg-[#00e8d8] disabled:opacity-40 disabled:pointer-events-none text-[#0e0f12] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Remove Silence</span>
          </button>
        </div>
      </div>
    </div>
  );
}
