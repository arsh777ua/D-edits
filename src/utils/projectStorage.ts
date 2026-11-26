import type { ProjectRecord } from '../types/editor';
import { uid } from './time';

const DB_NAME = 'cutlite_workspace_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'mediaBlobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as ProjectRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as ProjectRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function duplicateProject(id: string): Promise<ProjectRecord | null> {
  const orig = await getProject(id);
  if (!orig) return null;
  const now = Date.now();
  const copy: ProjectRecord = {
    ...orig,
    id: uid('proj'),
    name: `${orig.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
    lastSavedAt: now,
  };
  await saveProject(copy);
  return copy;
}

export async function saveMediaBlob(id: string, file: File | Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    const store = tx.objectStore(STORE_MEDIA);
    const req = store.put({ id, file });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadMediaBlob(id: string): Promise<File | Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const store = tx.objectStore(STORE_MEDIA);
    const req = store.get(id);
    req.onsuccess = () => {
      const row = req.result as { id: string; file: File | Blob } | undefined;
      resolve(row?.file ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export interface PickedFolder {
  name: string;
  handle?: FileSystemDirectoryHandle;
}

export async function fetchDefaultProjectLocation(): Promise<string | null> {
  try {
    const res = await fetch('/api/default-location');
    if (!res.ok) return null;
    const data = (await res.json()) as { path?: string };
    return data.path ?? null;
  } catch {
    return null;
  }
}

export async function saveProjectToLocalFolder(
  folderPath: string,
  record: ProjectRecord
): Promise<void> {
  try {
    await fetch('/api/save-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath, record }),
    });
  } catch {
    // ignore if local server is offline
  }
}

export async function pickLocalFolder(): Promise<PickedFolder | null> {
  try {
    const res = await fetch('/api/pick-folder', { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { path?: string | null };
      if (data.path) return { name: data.path };
      return null;
    }
  } catch {
    // fallback to browser File System Access API
  }

  const win = window as Window & {
    showDirectoryPicker?: (opts?: {
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };

  if (typeof win.showDirectoryPicker === 'function') {
    try {
      const handle = await win.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });
      return { name: handle.name, handle };
    } catch {
      return null;
    }
  }
  return null;
}

export async function writeProjectJsonToFolder(
  handle: FileSystemDirectoryHandle,
  record: ProjectRecord
): Promise<void> {
  try {
    const safeName = (record.name || 'project').replace(/[^a-z0-9_-]/gi, '_');
    const fileHandle = await handle.getFileHandle(`${safeName}.cutlite.json`, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(record, null, 2));
    await writable.close();
  } catch {
    // ignore permission denial if user revoked folder access
  }
}
