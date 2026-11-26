import {
  Clock,
  Copy,
  Film,
  FolderOpen,
  Keyboard,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Plus,
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectRecord } from '../types/editor';
import { formatAspectRatio } from '../utils/projectConfig';
import { formatDuration } from '../utils/time';

interface HomeScreenProps {
  projects: ProjectRecord[];
  onNewProject: () => void;
  onOpenProject: (project: ProjectRecord) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenShortcuts: () => void;
}

type HomeTab = 'home' | 'projects';
type SortBy = 'updatedAt' | 'name' | 'createdAt';
type ViewMode = 'grid' | 'list';

function formatRelativeDate(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function HomeScreen({
  projects,
  onNewProject,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onOpenShortcuts,
}: HomeScreenProps) {
  const [tab, setTab] = useState<HomeTab>('home');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ProjectRecord | null>(null);
  const [locationInfo, setLocationInfo] = useState<ProjectRecord | null>(null);

  const sortedProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'createdAt') return b.createdAt - a.createdAt;
        return b.updatedAt - a.updatedAt;
      });
  }, [projects, search, sortBy]);

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4),
    [projects]
  );

  const renderCard = (project: ProjectRecord) => {
    const resLabel =
      project.settings.resolutionPreset === 'custom'
        ? `${project.settings.width}×${project.settings.height}`
        : project.settings.resolutionPreset;
    const arLabel =
      project.settings.aspectRatioPreset === 'custom'
        ? formatAspectRatio(project.settings.width, project.settings.height)
        : project.settings.aspectRatioPreset;

    const isMenuOpen = openMenuId === project.id;
    const isRenaming = renamingId === project.id;

    if (viewMode === 'list') {
      return (
        <div
          key={project.id}
          onClick={() => onOpenProject(project)}
          className="group relative flex items-center gap-4 p-3 rounded-xl bg-[#16181d] border border-[#262932] hover:border-[#00d4c6]/60 transition-colors cursor-pointer"
        >
          <div className="w-28 aspect-video rounded-lg bg-[#0e0f12] overflow-hidden shrink-0 flex items-center justify-center border border-[#22252e]">
            {project.thumbnailUrl ? (
              <img
                src={project.thumbnailUrl}
                alt={project.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <Film className="w-5 h-5 text-[#4d5361]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                type="text"
                autoFocus
                value={renameValue}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) onRenameProject(project.id, renameValue.trim());
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (renameValue.trim()) onRenameProject(project.id, renameValue.trim());
                    setRenamingId(null);
                  } else if (e.key === 'Escape') {
                    setRenamingId(null);
                  }
                }}
                className="bg-[#1e2028] border border-[#00d4c6] rounded px-2 py-0.5 text-sm text-white outline-none w-60"
              />
            ) : (
              <h3 className="text-sm font-semibold text-white truncate">
                {project.name}
              </h3>
            )}
            <div className="flex items-center gap-2 text-[11px] text-[#8c92a0] mt-1">
              <span>{resLabel}</span>
              <span>•</span>
              <span>{project.settings.fps} FPS</span>
              <span>•</span>
              <span>{arLabel}</span>
              <span>•</span>
              <span>{formatDuration(project.duration)}</span>
            </div>
          </div>

          <span className="text-xs text-[#7e8494] hidden sm:block">
            {formatRelativeDate(project.updatedAt)}
          </span>

          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpenMenuId(isMenuOpen ? null : project.id)}
              aria-label="Project options"
              className="p-1.5 rounded-lg text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {isMenuOpen && renderMenu(project)}
          </div>
        </div>
      );
    }

    return (
      <div
        key={project.id}
        onClick={() => onOpenProject(project)}
        className="group relative rounded-xl bg-[#16181d] border border-[#262932] hover:border-[#00d4c6]/60 transition-all cursor-pointer flex flex-col"
      >
        {/* 16:9 Thumbnail */}
        <div className="aspect-video w-full rounded-t-xl bg-[#0e0f12] overflow-hidden relative flex items-center justify-center border-b border-[#22252e]">
          {project.thumbnailUrl ? (
            <img
              src={project.thumbnailUrl}
              alt={project.name}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-[#4d5361]">
              <Film className="w-7 h-7 stroke-[1.5]" />
              <span className="text-[10px] font-mono">{arLabel}</span>
            </div>
          )}

          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
            {formatDuration(project.duration)}
          </span>

          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-[#00d4c6]">
            {resLabel} · {project.settings.fps}fps
          </span>
        </div>

        {/* Metadata */}
        <div className="p-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                type="text"
                autoFocus
                value={renameValue}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) onRenameProject(project.id, renameValue.trim());
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (renameValue.trim()) onRenameProject(project.id, renameValue.trim());
                    setRenamingId(null);
                  } else if (e.key === 'Escape') {
                    setRenamingId(null);
                  }
                }}
                className="bg-[#1e2028] border border-[#00d4c6] rounded px-2 py-0.5 text-xs text-white outline-none w-full"
              />
            ) : (
              <h3 className="text-xs font-semibold text-white truncate">
                {project.name}
              </h3>
            )}
            <div className="flex items-center gap-1.5 text-[11px] text-[#7e8494] mt-1">
              <span>{arLabel}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeDate(project.updatedAt)}
              </span>
            </div>
          </div>

          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpenMenuId(isMenuOpen ? null : project.id)}
              aria-label="Project options"
              className="p-1 rounded-md text-[#8c92a0] hover:text-white hover:bg-[#232630] cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {isMenuOpen && renderMenu(project)}
          </div>
        </div>
      </div>
    );
  };

  const renderMenu = (project: ProjectRecord) => (
    <div className="absolute right-0 bottom-full mb-1 w-44 rounded-lg bg-[#1e2028] border border-[#2f333f] shadow-2xl py-1 z-30 text-xs">
      <button
        type="button"
        onClick={() => {
          setOpenMenuId(null);
          onOpenProject(project);
        }}
        className="w-full px-3 py-1.5 text-left text-white hover:bg-[#2a2d38] flex items-center gap-2 cursor-pointer"
      >
        <Film className="w-3.5 h-3.5 text-[#00d4c6]" />
        <span>Open Project</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setOpenMenuId(null);
          setRenamingId(project.id);
          setRenameValue(project.name);
        }}
        className="w-full px-3 py-1.5 text-left text-[#d0d4dc] hover:bg-[#2a2d38] flex items-center gap-2 cursor-pointer"
      >
        <Pencil className="w-3.5 h-3.5" />
        <span>Rename</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setOpenMenuId(null);
          onDuplicateProject(project.id);
        }}
        className="w-full px-3 py-1.5 text-left text-[#d0d4dc] hover:bg-[#2a2d38] flex items-center gap-2 cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5" />
        <span>Duplicate</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setOpenMenuId(null);
          setLocationInfo(project);
        }}
        className="w-full px-3 py-1.5 text-left text-[#d0d4dc] hover:bg-[#2a2d38] flex items-center gap-2 cursor-pointer"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        <span>Show Location</span>
      </button>
      <div className="h-px bg-[#2a2d38] my-1" />
      <button
        type="button"
        onClick={() => {
          setOpenMenuId(null);
          setConfirmDelete(project);
        }}
        className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2 cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Delete</span>
      </button>
    </div>
  );

  return (
    <div
      className="h-screen w-screen flex flex-col bg-[#0e0f12] text-[#e8eaed] overflow-hidden"
      onClick={() => openMenuId && setOpenMenuId(null)}
    >
      {/* Top Navigation */}
      <header className="h-14 shrink-0 bg-[#14161b] border-b border-[#262932] px-6 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00d4c6] text-[#091214] flex items-center justify-center shadow-sm">
              <Scissors className="w-4 h-4 stroke-[2.4]" />
            </div>
            <span className="font-semibold text-base tracking-tight text-white">
              D-EDITS
            </span>
          </div>

          <nav className="flex items-center gap-1">
            {(
              [
                { id: 'home', label: 'Home' },
                { id: 'projects', label: 'Projects' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  tab === item.id
                    ? 'bg-[#1e2028] text-white'
                    : 'text-[#8c92a0] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenShortcuts}
            title="Keyboard Shortcuts"
            className="p-2 rounded-lg text-[#9aa0ad] hover:text-white hover:bg-[#1e2028] transition-colors cursor-pointer"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <div className="px-2.5 py-1 rounded-full bg-[#1e2028] border border-[#2a2d36] text-[11px] text-[#9aa0ad]">
            Local Studio
          </div>
        </div>
      </header>

      {/* Main Dashboard */}
      <main className="flex-1 overflow-y-auto custom-scrollbar px-6 py-7">
        <div className="max-w-7xl mx-auto space-y-7">
          {/* Welcome + New Project */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Your Creative Workspace
              </h1>
              <p className="text-xs text-[#8c92a0] mt-1">
                Create, configure, and manage your local video editing projects.
              </p>
            </div>

            <button
              type="button"
              onClick={onNewProject}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#00d4c6] hover:bg-[#18e3d5] active:bg-[#00bfb3] text-[#091214] font-semibold text-sm shadow-lg shadow-[#00d4c6]/10 transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>New Project</span>
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#2c303a] bg-[#14161b]/70 py-20 px-6 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#1e2028] text-[#00d4c6] flex items-center justify-center">
                <Film className="w-6 h-6" />
              </div>
              <h2 className="text-base font-semibold text-white">
                No projects yet
              </h2>
              <p className="text-xs text-[#8c92a0] max-w-sm">
                Start a new project to choose your resolution, aspect ratio, and
                frame rate, then begin editing.
              </p>
              <button
                type="button"
                onClick={onNewProject}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00d4c6] hover:bg-[#18e3d5] text-[#091214] font-semibold text-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Create Your First Project</span>
              </button>
            </div>
          ) : (
            <>
              {/* Recent Projects (Home tab only when no search active) */}
              {tab === 'home' && !search.trim() && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
                    Recent Projects
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {recentProjects.map((p) => renderCard(p))}
                  </div>
                </section>
              )}

              {/* All Projects Toolbar + Grid/List */}
              <section className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9aa0ad]">
                    All Projects ({sortedProjects.length})
                  </h2>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#7e8494] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search projects..."
                        className="bg-[#16181d] border border-[#262932] focus:border-[#00d4c6] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white outline-none w-48"
                      />
                    </div>

                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortBy)}
                      aria-label="Sort projects"
                      className="bg-[#16181d] border border-[#262932] rounded-lg px-2.5 py-1.5 text-xs text-[#d0d4dc] outline-none"
                    >
                      <option value="updatedAt">Last Modified</option>
                      <option value="name">Name</option>
                      <option value="createdAt">Date Created</option>
                    </select>

                    <div className="flex items-center bg-[#16181d] border border-[#262932] rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setViewMode('grid')}
                        title="Grid view"
                        className={`p-1 rounded ${
                          viewMode === 'grid'
                            ? 'bg-[#262932] text-white'
                            : 'text-[#7e8494] hover:text-white'
                        } cursor-pointer`}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('list')}
                        title="List view"
                        className={`p-1 rounded ${
                          viewMode === 'list'
                            ? 'bg-[#262932] text-white'
                            : 'text-[#7e8494] hover:text-white'
                        } cursor-pointer`}
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {sortedProjects.length === 0 ? (
                  <p className="py-10 text-center text-xs text-[#6d7382]">
                    No projects match "{search}".
                  </p>
                ) : viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {sortedProjects.map((p) => renderCard(p))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sortedProjects.map((p) => renderCard(p))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#181a20] border border-[#2a2d36] p-5 space-y-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-white">Delete Project?</h2>
            <p className="text-xs text-[#9aa0ad]">
              Are you sure you want to delete{' '}
              <span className="text-white font-medium">
                {confirmDelete.name}
              </span>
              ? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs text-[#b0b5c0] hover:text-white hover:bg-[#232630] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteProject(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-600 text-white cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Location Info Modal */}
      {locationInfo && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#181a20] border border-[#2a2d36] p-5 space-y-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-white">
              Project Location
            </h2>
            <div className="p-3 rounded-lg bg-[#121419] border border-[#262932] text-xs font-mono text-[#00d4c6] break-all">
              {locationInfo.settings.locationLabel}
            </div>
            <p className="text-[11px] text-[#8c92a0]">
              Resolution: {locationInfo.settings.width}×{locationInfo.settings.height} ·{' '}
              {locationInfo.settings.fps} FPS
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setLocationInfo(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#232630] text-white hover:bg-[#2d313d] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
