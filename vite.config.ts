import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Serves netlify/functions/<name>.mts at /api/<name> during `npm run dev`, with
 * .env loaded into process.env, so functions work locally without Netlify CLI.
 */
function netlifyFunctionsDev(): Plugin {
  return {
    name: 'netlify-functions-dev',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''))
      server.middlewares.use('/api', async (req, res) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        try {
          const mod = await server.ssrLoadModule(`/netlify/functions/${name}.mts`)
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const request = new Request(`http://localhost/api/${name}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
          })
          const response: Response = await mod.default(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'no-function', detail: String(err) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    netlifyFunctionsDev(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Orator',
        short_name: 'Orator',
        description: 'Daily articulation practice, journaling and reading.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121315',
        theme_color: '#121315',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // The Speech SDK chunk is large and only needed online; fetch it at runtime instead of precaching.
        globIgnores: ['**/microsoft.cognitiveservices*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
})
