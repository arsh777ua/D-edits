import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { startBridgeServer } from './server/mcp-bridge.mjs'
import { attachNativeExportMiddleware } from './server/native-export.mjs'

const SFX_DIR = path.resolve(process.cwd(), 'custom assets', 'sfx')
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac'])

function sfxLibraryPlugin(): Plugin {
  const attachMiddleware = (middlewares: {
    use: (
      path: string,
      handler: (
        req: { url?: string },
        res: {
          statusCode: number
          setHeader: (k: string, v: string) => void
          end: (data?: Buffer | string) => void
        },
        next: () => void
      ) => void
    ) => void
  }) => {
    middlewares.use('/api/sfx-list', (_req, res) => {
      try {
        if (!fs.existsSync(SFX_DIR)) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files: [] }))
          return
        }
        const entries = fs.readdirSync(SFX_DIR, { withFileTypes: true })
        const files = entries
          .filter(
            (e) =>
              e.isFile() &&
              AUDIO_EXTS.has(path.extname(e.name).toLowerCase())
          )
          .map((e) => ({
            fileName: e.name,
            name: e.name.replace(/\.[^.]+$/, ''),
            url: `/sfx/${encodeURIComponent(e.name)}`,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ files }))
      } catch {
        res.statusCode = 500
        res.end(JSON.stringify({ files: [] }))
      }
    })

    middlewares.use('/sfx/', (req, res, next) => {
      try {
        const rawName = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0])
        const safeName = path.basename(rawName)
        const fullPath = path.join(SFX_DIR, safeName)
        if (!safeName || !fs.existsSync(fullPath)) {
          next()
          return
        }
        const ext = path.extname(safeName).toLowerCase()
        const mime =
          ext === '.wav'
            ? 'audio/wav'
            : ext === '.ogg'
              ? 'audio/ogg'
              : ext === '.m4a'
                ? 'audio/mp4'
                : 'audio/mpeg'
        const buf = fs.readFileSync(fullPath)
        res.setHeader('Content-Type', mime)
        res.setHeader('Content-Length', String(buf.length))
        res.setHeader('Accept-Ranges', 'bytes')
        res.end(buf)
      } catch {
        next()
      }
    })
  }

  return {
    name: 'dedits-sfx-library',
    configureServer(server) {
      attachMiddleware(server.middlewares)
      attachNativeExportMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares)
      attachNativeExportMiddleware(server.middlewares)
    },
  }
}

function cutliteMcpBridgePlugin(): Plugin {
  return {
    name: 'cutlite-mcp-bridge',
    configureServer() {
      void startBridgeServer()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cutliteMcpBridgePlugin(), sfxLibraryPlugin()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
})
