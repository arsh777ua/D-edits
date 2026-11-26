import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';

export const DEFAULT_BRIDGE_PORT = Number(process.env.CUTLITE_BRIDGE_PORT || 8766);

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

let activeServer = null;

export function startBridgeServer(port = DEFAULT_BRIDGE_PORT) {
  if (activeServer) return Promise.resolve(activeServer);

  /** @type {Set<http.ServerResponse>} */
  const sseClients = new Set();
  /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
  const pendingCommands = new Map();
  /** @type {Map<string, { filePath: string, name: string, mimeType: string }>} */
  const registeredFiles = new Map();
  let lastState = null;

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        port,
        connectedBrowsers: sseClients.size,
        hasState: lastState !== null,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      sendJson(res, 200, {
        ok: true,
        connected: sseClients.size > 0,
        state: lastState,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/state') {
      try {
        const body = await readJsonBody(req);
        lastState = { ...body, updatedAt: Date.now() };
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: String(err) });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      setCors(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);

      const keepAlive = setInterval(() => {
        if (!res.writableEnded) {
          res.write(': ping\n\n');
        }
      }, 15000);

      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/result') {
      try {
        const { id, ok, result, error } = await readJsonBody(req);
        const pending = pendingCommands.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingCommands.delete(id);
          pending.resolve({ ok: Boolean(ok), result, error });
        }
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: String(err) });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/command') {
      try {
        const { action, params = {}, timeoutMs = 30000 } = await readJsonBody(req);
        if (!action) {
          sendJson(res, 400, { ok: false, error: 'Missing action' });
          return;
        }
        if (sseClients.size === 0) {
          sendJson(res, 503, {
            ok: false,
            error:
              'No CutLite browser tab is connected. Open CutLite in your browser (e.g. http://localhost:5173) and try again.',
          });
          return;
        }

        // Send to the most recently connected browser tab
        const clients = Array.from(sseClients);
        const targetClient = clients[clients.length - 1];
        const id = crypto.randomUUID();

        const resultPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingCommands.delete(id);
            reject(new Error(`Timed out waiting for CutLite browser to execute "${action}"`));
          }, timeoutMs);
          pendingCommands.set(id, { resolve, reject, timer });
        });

        targetClient.write(
          `event: command\ndata: ${JSON.stringify({ id, action, params })}\n\n`
        );

        const response = await resultPromise;
        sendJson(res, response.ok ? 200 : 400, response);
      } catch (err) {
        sendJson(res, 504, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/media/register') {
      try {
        const { filePath } = await readJsonBody(req);
        if (!filePath || typeof filePath !== 'string') {
          sendJson(res, 400, { ok: false, error: 'Missing filePath' });
          return;
        }
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
          sendJson(res, 404, { ok: false, error: `File not found: ${resolved}` });
          return;
        }
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
          sendJson(res, 400, { ok: false, error: `Not a file: ${resolved}` });
          return;
        }
        const ext = path.extname(resolved).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const name = path.basename(resolved);
        const token = crypto.randomUUID();
        registeredFiles.set(token, { filePath: resolved, name, mimeType });

        sendJson(res, 200, {
          ok: true,
          token,
          name,
          mimeType,
          size: stat.size,
          url: `http://127.0.0.1:${port}/media/file?token=${encodeURIComponent(token)}`,
        });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/media/file') {
      const token = url.searchParams.get('token');
      if (!token || !registeredFiles.has(token)) {
        sendJson(res, 404, { ok: false, error: 'Invalid or expired media token' });
        return;
      }
      const entry = registeredFiles.get(token);
      if (!fs.existsSync(entry.filePath)) {
        sendJson(res, 404, { ok: false, error: 'File no longer exists on disk' });
        return;
      }
      const stat = fs.statSync(entry.filePath);
      setCors(res);
      res.writeHead(200, {
        'Content-Type': entry.mimeType,
        'Content-Length': stat.size,
      });
      fs.createReadStream(entry.filePath).pipe(res);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  return new Promise((resolve) => {
    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // Another instance (e.g. standalone bridge or another Vite) is already running.
        resolve(null);
        return;
      }
      console.error('[CutLite Bridge] Server error:', err);
      resolve(null);
    });

    server.listen(port, '127.0.0.1', () => {
      activeServer = server;
      console.log(`[CutLite Bridge] Listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

// Run standalone when executed directly: `node server/mcp-bridge.mjs`
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (isDirectRun) {
  startBridgeServer(DEFAULT_BRIDGE_PORT);
}
