import { useCallback, useEffect, useRef, useState } from 'react';
import { ExportModal } from './components/ExportModal';
import { HomeScreen } from './components/HomeScreen';
import { LeftSidebar } from './components/LeftSidebar';
import { PreviewPlayer } from './components/PreviewPlayer';
import { ProjectConfigModal } from './components/ProjectConfigModal';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RemoveSilenceModal } from './components/RemoveSilenceModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { ShortcutToast } from './components/ShortcutToast';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { useEditorState } from './hooks/useEditorState';
import { useMcpBridge } from './hooks/useMcpBridge';
import { useShortcuts } from './hooks/useShortcuts';
import type {
  AudioClip,
  GraphicClip,
  GraphicPreset,
  MediaAsset,
  ProjectRecord,
  ProjectSettings,
  SerializedMediaRef,
  SidebarTab,
  TimelineClip,
  VideoClip,
} from './types/editor';
import {
  createPresetFromClip,
  loadCustomGraphicPresets,
  saveCustomGraphicPresets,
} from './utils/graphicTemplates';
import { DEFAULT_PROJECT_SETTINGS } from './utils/projectConfig';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  loadMediaBlob,
  saveProject,
  saveProjectToLocalFolder,
  writeProjectJsonToFolder,
} from './utils/projectStorage';
import { eventToShortcutString, type ShortcutActionId } from './utils/shortcuts';
import { clamp, uid } from './utils/time';

export function App() {
  const editor = useEditorState();
  const shortcutMgr = useShortcuts();

  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [folderHandle, setFolderHandle] = useState<
    FileSystemDirectoryHandle | undefined
  >(undefined);

  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<SidebarTab>('media');
  const [customGraphicPresets, setCustomGraphicPresets] = useState<
    GraphicPreset[]
  >(() => loadCustomGraphicPresets());

  const handleSaveGraphicPreset = useCallback(
    (clip: GraphicClip, name: string) => {
      const preset = createPresetFromClip(clip, name);
      setCustomGraphicPresets((prev) => {
        const next = [preset, ...prev];
        saveCustomGraphicPresets(next);
        return next;
      });
    },
    []
  );

  const handleDuplicateGraphicPreset = useCallback((preset: GraphicPreset) => {
    const copy: GraphicPreset = {
      ...structuredClone(preset),
      id: uid('gpreset'),
      name: `${preset.name} (Copy)`,
      createdAt: Date.now(),
    };
    setCustomGraphicPresets((prev) => {
      const next = [copy, ...prev];
      saveCustomGraphicPresets(next);
      return next;
    });
  }, []);

  const handleDeleteGraphicPreset = useCallback((presetId: string) => {
    setCustomGraphicPresets((prev) => {
      const next = prev.filter((p) => p.id !== presetId);
      saveCustomGraphicPresets(next);
      return next;
    });
  }, []);
  const [timelineHeight, setTimelineHeight] = useState(272);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [silenceClip, setSilenceClip] = useState<VideoClip | AudioClip | null>(
    null
  );

  const [toast, setToast] = useState<{
    id: number;
    key: string;
    label: string;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const refreshProjects = useCallback(async () => {
    const all = await listProjects().catch(() => []);
    setProjects(all);
  }, []);

  useEffect(() => {
    let active = true;
    listProjects()
      .then((all) => {
        if (active) setProjects(all);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const showShortcutToast = useCallback((key: string, label: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), key, label });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 1400);
  }, []);

  const buildCurrentRecord = useCallback(
    (base: ProjectRecord): ProjectRecord => {
      const mediaRefs: SerializedMediaRef[] = editor.mediaAssets.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        duration: a.duration,
        width: a.width,
        height: a.height,
        thumbnailUrl:
          a.type === 'video' ? a.thumbnailUrl : undefined,
        mimeType: a.mimeType,
      }));
      const firstThumb =
        editor.mediaAssets.find((a) => a.type === 'video' && a.thumbnailUrl)
          ?.thumbnailUrl ??
        editor.mediaAssets.find((a) => a.type === 'image')?.thumbnailUrl;

      const now = Date.now();
      return {
        ...base,
        name: editor.projectName,
        clips: editor.clips,
        mediaRefs,
        duration: editor.projectDuration,
        thumbnailUrl: firstThumb ?? base.thumbnailUrl,
        updatedAt: now,
        lastSavedAt: now,
      };
    },
    [
      editor.mediaAssets,
      editor.projectName,
      editor.clips,
      editor.projectDuration,
    ]
  );

  const persistCurrentProject = useCallback(async () => {
    if (!activeProject) return;
    setIsSaving(true);
    try {
      const record = buildCurrentRecord(activeProject);
      await saveProject(record);
      await saveProjectToLocalFolder(record.settings.locationLabel, record);
      if (folderHandle) {
        await writeProjectJsonToFolder(folderHandle, record);
      }
      setActiveProject(record);
      setLastSavedAt(record.lastSavedAt);
    } finally {
      setIsSaving(false);
    }
  }, [activeProject, buildCurrentRecord, folderHandle]);

  // Debounced autosave while editing
  const activeProjectId = activeProject?.id;
  useEffect(() => {
    if (screen !== 'editor' || !activeProjectId) return;
    const timer = window.setTimeout(() => {
      void persistCurrentProject();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    screen,
    activeProjectId,
    editor.projectName,
    editor.clips,
    editor.mediaAssets,
    persistCurrentProject,
  ]);

  const handleCreateProject = async (
    name: string,
    settings: ProjectSettings,
    handle?: FileSystemDirectoryHandle
  ) => {
    const now = Date.now();
    const record: ProjectRecord = {
      id: uid('proj'),
      name,
      settings,
      clips: [],
      mediaRefs: [],
      duration: 0,
      createdAt: now,
      updatedAt: now,
      lastSavedAt: now,
    };
    await saveProject(record);
    await saveProjectToLocalFolder(record.settings.locationLabel, record);
    if (handle) {
      await writeProjectJsonToFolder(handle, record);
    }
    setFolderHandle(handle);
    setActiveProject(record);
    setLastSavedAt(now);
    editor.hydrateProjectSession(record.name, [], []);
    setNewProjectModalOpen(false);
    setScreen('editor');
    void refreshProjects();
  };

  const handleOpenProject = async (record: ProjectRecord) => {
    const restoredAssets: MediaAsset[] = [];
    for (const ref of record.mediaRefs) {
      const blob = await loadMediaBlob(ref.id).catch(() => null);
      if (!blob) continue;
      const file =
        blob instanceof File
          ? blob
          : new File([blob], ref.name, { type: ref.mimeType });
      const url = URL.createObjectURL(file);
      restoredAssets.push({
        id: ref.id,
        name: ref.name,
        type: ref.type,
        file,
        url,
        duration: ref.duration,
        width: ref.width,
        height: ref.height,
        thumbnailUrl: ref.type === 'image' ? url : ref.thumbnailUrl,
        mimeType: ref.mimeType,
      });
    }

    setFolderHandle(undefined);
    setActiveProject(record);
    setLastSavedAt(record.lastSavedAt);
    editor.hydrateProjectSession(record.name, record.clips, restoredAssets);
    setScreen('editor');
  };

  const handleGoHome = async () => {
    editor.setIsPlaying(false);
    await persistCurrentProject();
    await refreshProjects();
    setScreen('home');
  };

  const handleUpdateProjectSettings = async (
    name: string,
    settings: ProjectSettings,
    handle?: FileSystemDirectoryHandle
  ) => {
    if (!activeProject) return;
    editor.setProjectName(name);
    if (handle) setFolderHandle(handle);
    const updated: ProjectRecord = {
      ...activeProject,
      name,
      settings,
      updatedAt: Date.now(),
    };
    setActiveProject(updated);
    setProjectSettingsOpen(false);
    const updatedRecord = buildCurrentRecord(updated);
    await saveProject(updatedRecord);
    await saveProjectToLocalFolder(updatedRecord.settings.locationLabel, updatedRecord);
  };

  const handleRenameFromHome = async (id: string, newName: string) => {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    await saveProject({ ...target, name: newName, updatedAt: Date.now() });
    await refreshProjects();
  };

  const handleDuplicateFromHome = async (id: string) => {
    await duplicateProject(id);
    await refreshProjects();
  };

  const handleDeleteFromHome = async (id: string) => {
    await deleteProject(id);
    await refreshProjects();
  };

  const {
    isPlaying,
    projectDuration,
    setPlayhead,
    setIsPlaying,
    togglePlay,
    stepFrame,
    undo,
    redo,
    canUndo,
    canRedo,
    deleteSelectedClip,
    splitAtPlayhead,
    rippleDeleteLeft,
    rippleDeleteRight,
    copySelectedClips,
    pasteClips,
    duplicateSelectedClips,
    selectAllClips,
    setSelectedClipId,
    zoom,
    setZoom,
  } = editor;

  const projectSettings = activeProject?.settings ?? DEFAULT_PROJECT_SETTINGS;

  useMcpBridge({
    editor,
    screen,
    activeProject,
    projects,
    projectSettings,
    customGraphicPresets,
    onCreateProject: (name, settings) => handleCreateProject(name, settings),
    onOpenProject: (record) => handleOpenProject(record),
    onUpdateProjectSettings: (name, settings) =>
      handleUpdateProjectSettings(name, settings),
    onSaveGraphicPreset: handleSaveGraphicPreset,
    onDeleteGraphicPreset: handleDeleteGraphicPreset,
    onSetExportOpen: setExportOpen,
  });

  // Playback rAF loop
  useEffect(() => {
    if (screen !== 'editor' || !isPlaying) return;

    let lastTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setPlayhead((prev) => {
        const next = prev + dt;
        if (projectDuration > 0 && next >= projectDuration) {
          setIsPlaying(false);
          return projectDuration;
        }
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [screen, isPlaying, projectDuration, setPlayhead, setIsPlaying]);

  const executeShortcutAction = useCallback(
    (actionId: ShortcutActionId, keyDisplay: string, actionName: string) => {
      let executed = true;

      switch (actionId) {
        case 'playPause':
          togglePlay();
          break;
        case 'undo':
          if (!canUndo) executed = false;
          else undo();
          break;
        case 'redo':
          if (!canRedo) executed = false;
          else redo();
          break;
        case 'split':
          executed = splitAtPlayhead();
          break;
        case 'rippleDeleteLeft':
          executed = rippleDeleteLeft();
          break;
        case 'rippleDeleteRight':
          executed = rippleDeleteRight();
          break;
        case 'delete':
        case 'deleteKey':
          executed = deleteSelectedClip();
          break;
        case 'copy':
          executed = copySelectedClips();
          break;
        case 'paste':
          executed = pasteClips();
          break;
        case 'duplicate':
          executed = duplicateSelectedClips();
          break;
        case 'selectAll':
          executed = selectAllClips();
          break;
        case 'prevFrame':
          stepFrame(-1, projectSettings.fps);
          break;
        case 'nextFrame':
          stepFrame(1, projectSettings.fps);
          break;
        case 'prev10Frames':
          stepFrame(-10, projectSettings.fps);
          break;
        case 'next10Frames':
          stepFrame(10, projectSettings.fps);
          break;
        case 'goToStart':
          setIsPlaying(false);
          setPlayhead(0);
          break;
        case 'goToEnd':
          setIsPlaying(false);
          setPlayhead(projectDuration);
          break;
        case 'zoomIn':
          setZoom(clamp(zoom + 15, 15, 160));
          break;
        case 'zoomOut':
          setZoom(clamp(zoom - 15, 15, 160));
          break;
        case 'deselect':
          setSelectedClipId(null);
          break;
      }

      if (executed) {
        showShortcutToast(keyDisplay, actionName);
      }
    },
    [
      togglePlay,
      canUndo,
      undo,
      canRedo,
      redo,
      splitAtPlayhead,
      rippleDeleteLeft,
      rippleDeleteRight,
      deleteSelectedClip,
      copySelectedClips,
      pasteClips,
      duplicateSelectedClips,
      selectAllClips,
      stepFrame,
      projectSettings.fps,
      setIsPlaying,
      setPlayhead,
      projectDuration,
      setZoom,
      zoom,
      setSelectedClipId,
      showShortcutToast,
    ]
  );

  // Centralized global keyboard shortcut listener (active only in editor)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        screen !== 'editor' ||
        exportOpen ||
        shortcutsOpen ||
        projectSettingsOpen ||
        newProjectModalOpen
      ) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isFormField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isFormField) return;

      const combo = eventToShortcutString(e);
      if (!combo) return;

      const matched = shortcutMgr.keyToActionMap.get(combo.toLowerCase());
      if (matched) {
        e.preventDefault();
        executeShortcutAction(matched.id, matched.key, matched.name);
        return;
      }

      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        executeShortcutAction('deleteKey', 'Backspace', 'Delete Selected Clip');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    screen,
    exportOpen,
    shortcutsOpen,
    projectSettingsOpen,
    newProjectModalOpen,
    shortcutMgr.keyToActionMap,
    executeShortcutAction,
  ]);

  if (screen === 'home') {
    return (
      <>
        <HomeScreen
          projects={projects}
          onNewProject={() => setNewProjectModalOpen(true)}
          onOpenProject={(p) => void handleOpenProject(p)}
          onRenameProject={(id, n) => void handleRenameFromHome(id, n)}
          onDuplicateProject={(id) => void handleDuplicateFromHome(id)}
          onDeleteProject={(id) => void handleDeleteFromHome(id)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />

        <ProjectConfigModal
          key={newProjectModalOpen ? 'create-open' : 'create-closed'}
          open={newProjectModalOpen}
          mode="create"
          onClose={() => setNewProjectModalOpen(false)}
          onConfirm={(name, settings, handle) =>
            void handleCreateProject(name, settings, handle)
          }
        />

        <ShortcutsModal
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          shortcuts={shortcutMgr.shortcuts}
          onUpdateShortcut={shortcutMgr.updateShortcutKey}
          onToggleEnabled={shortcutMgr.toggleShortcutEnabled}
          onResetDefaults={shortcutMgr.resetToDefaults}
        />
      </>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0e0f12] text-[#e8eaed] overflow-hidden">
      <TopBar
        projectName={editor.projectName}
        onRenameProject={editor.setProjectName}
        onGoHome={() => void handleGoHome()}
        onSaveProject={() => void persistCurrentProject()}
        lastSavedAt={lastSavedAt}
        isSaving={isSaving}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onOpenProjectSettings={() => {
          editor.setIsPlaying(false);
          setProjectSettingsOpen(true);
        }}
        onOpenShortcuts={() => {
          editor.setIsPlaying(false);
          setShortcutsOpen(true);
        }}
        onOpenExport={() => {
          editor.setIsPlaying(false);
          setExportOpen(true);
        }}
        hasClips={editor.clips.length > 0}
      />

      <main className="flex-1 min-h-0 flex overflow-hidden">
        <LeftSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          mediaAssets={editor.mediaAssets}
          clips={editor.clips}
          importStatus={editor.importStatus}
          onImportFiles={editor.addMediaFiles}
          onAddMediaToTimeline={(asset) => editor.addMediaToTimeline(asset)}
          onRemoveMedia={editor.removeMediaAsset}
          onAddTextClip={editor.addTextClip}
          customPresets={customGraphicPresets}
          onAddGraphic={(preset) => editor.addGraphicClip(preset)}
          onDuplicatePreset={handleDuplicateGraphicPreset}
          onDeletePreset={handleDeleteGraphicPreset}
          onAddCaptionClips={editor.addCaptionClips}
          onSeekTo={(t) => {
            editor.setIsPlaying(false);
            editor.setPlayhead(t);
          }}
        />

        <PreviewPlayer
          clips={editor.clips}
          mediaAssets={editor.mediaAssets}
          projectSettings={projectSettings}
          playhead={editor.playhead}
          projectDuration={editor.projectDuration}
          isPlaying={editor.isPlaying}
          selectedClipId={editor.selectedClipId}
          onSelectClip={(id) => editor.setSelectedClipId(id)}
          onTogglePlay={editor.togglePlay}
          onStepFrame={(dir) => editor.stepFrame(dir, projectSettings.fps)}
          onUpdateClip={editor.updateClip}
          onPushHistory={editor.pushHistory}
        />

        <PropertiesPanel
          selectedClip={editor.selectedClip}
          clips={editor.clips}
          mediaAssets={editor.mediaAssets}
          onUpdateClip={editor.updateClip}
          onApplyTextStyleToAll={editor.applyStyleToAllTextClips}
          onSaveGraphicPreset={handleSaveGraphicPreset}
          onRemoveSilence={(c) => {
            editor.setIsPlaying(false);
            setSilenceClip(c);
          }}
          onPushHistory={editor.pushHistory}
        />
      </main>

      <Timeline
        height={timelineHeight}
        onResizeHeight={setTimelineHeight}
        clips={editor.clips}
        tracks={editor.tracks}
        onAddTrack={editor.addTrack}
        onRemoveTrack={editor.removeTrack}
        mediaAssets={editor.mediaAssets}
        selectedClipId={editor.selectedClipId}
        selectedClipIds={editor.selectedClipIds}
        onSelectClip={editor.setSelectedClipId}
        onSelectClips={editor.setSelectedClipIds}
        playhead={editor.playhead}
        projectDuration={editor.projectDuration}
        onSeek={(t) => {
          editor.setIsPlaying(false);
          editor.setPlayhead(t);
        }}
        zoom={editor.zoom}
        onZoomChange={editor.setZoom}
        onSplit={editor.splitAtPlayhead}
        onDelete={editor.deleteSelectedClip}
        canRemoveSilence={Boolean(
          (editor.selectedClip &&
            (editor.selectedClip.trackType === 'audio' ||
              (editor.selectedClip.trackType === 'video' &&
                editor.selectedClip.mediaType === 'video'))) ||
            editor.clips.some(
              (c) =>
                c.trackType === 'audio' ||
                (c.trackType === 'video' && c.mediaType === 'video')
            )
        )}
        onRemoveSilence={() => {
          const target =
            editor.selectedClip &&
            (editor.selectedClip.trackType === 'audio' ||
              (editor.selectedClip.trackType === 'video' &&
                editor.selectedClip.mediaType === 'video'))
              ? editor.selectedClip
              : editor.clips.find(
                  (c): c is VideoClip | AudioClip =>
                    c.trackType === 'audio' ||
                    (c.trackType === 'video' && c.mediaType === 'video')
                ) ?? null;
          if (target) {
            editor.setIsPlaying(false);
            setSilenceClip(target);
          }
        }}
        onUpdateClip={editor.updateClip}
        onPushHistory={editor.pushHistory}
        onDropMedia={(asset, startTime, trackIndex) =>
          editor.addMediaToTimeline(asset, startTime, trackIndex)
        }
        onDropText={(preset, startTime, trackIndex) =>
          editor.addTextClip(preset, trackIndex, startTime)
        }
        onDropGraphic={(preset, startTime, trackIndex) =>
          editor.addGraphicClip(preset, trackIndex, startTime)
        }
      />

      <ShortcutToast toast={toast} />

      <ProjectConfigModal
        key={projectSettingsOpen ? 'edit-open' : 'edit-closed'}
        open={projectSettingsOpen}
        mode="edit"
        initialName={editor.projectName}
        initialSettings={projectSettings}
        hasClips={editor.clips.length > 0}
        onClose={() => setProjectSettingsOpen(false)}
        onConfirm={(name, settings, handle) =>
          void handleUpdateProjectSettings(name, settings, handle)
        }
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        shortcuts={shortcutMgr.shortcuts}
        onUpdateShortcut={shortcutMgr.updateShortcutKey}
        onToggleEnabled={shortcutMgr.toggleShortcutEnabled}
        onResetDefaults={shortcutMgr.resetToDefaults}
      />

      <ExportModal
        key={exportOpen ? 'export-open' : 'export-closed'}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        projectName={editor.projectName}
        projectSettings={projectSettings}
        clips={editor.clips}
        mediaAssets={editor.mediaAssets}
      />

      <RemoveSilenceModal
        open={Boolean(silenceClip)}
        clip={silenceClip}
        mediaAsset={
          silenceClip
            ? editor.mediaAssets.find((a) => a.id === silenceClip.mediaId) ?? null
            : null
        }
        onClose={() => setSilenceClip(null)}
        onApply={(targetId, replacementClips: TimelineClip[]) => {
          editor.applyEdit((prev) =>
            prev.flatMap((c) => (c.id === targetId ? replacementClips : [c]))
          );
          if (replacementClips[0]) {
            editor.setSelectedClipId(replacementClips[0].id);
          }
        }}
      />
    </div>
  );
}

export default App;
