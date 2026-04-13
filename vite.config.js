import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { generatePostsIndex } from './scripts/build-posts-index.mjs'

// src/posts/**/*.md 변경 시 src/lib/posts-meta.json 자동 재생성.
// 빌드/dev 양쪽 진입점에서 훅을 걸어 클라이언트는 JSON만 import하면 된다.
function postsIndexPlugin() {
  let pending = false
  const regenerate = async (server) => {
    if (pending) return
    pending = true
    try {
      await generatePostsIndex()
      if (server) server.ws.send({ type: 'full-reload' })
    } finally {
      pending = false
    }
  }
  return {
    name: 'posts-index',
    async buildStart() {
      await generatePostsIndex()
    },
    configureServer(server) {
      const handler = (file) => {
        if (/src[/\\]posts[/\\].+\.md$/.test(file)) regenerate(server)
      }
      server.watcher.on('change', handler)
      server.watcher.on('add', handler)
      server.watcher.on('unlink', handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [postsIndexPlugin(), react()],
  base: '/',
})
