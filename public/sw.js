/* Dada Tracker service worker — 오프라인 셸 + 기록 리마인더 */
const VERSION = 'v4'
const SHELL_CACHE = `dada-shell-${VERSION}`
const SETTINGS_CACHE = 'dada-settings'
const SETTINGS_KEY = '/__reminder-settings'
const OFFLINE_URL = '/index.html'

const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('dada-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 동일 출처만 처리합니다. Firestore/Auth 요청은 SDK의 자체 오프라인 큐에 맡깁니다.
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error()),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached || Response.error())
    }),
  )
})

// ─── 리마인더 ──────────────────────────────────────────────────────────────
async function readSettings() {
  const cache = await caches.open(SETTINGS_CACHE)
  const res = await cache.match(SETTINGS_KEY)
  if (!res) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function writeSettings(settings) {
  const cache = await caches.open(SETTINGS_CACHE)
  await cache.put(
    SETTINGS_KEY,
    new Response(JSON.stringify(settings), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'REMINDER_SETTINGS') {
    event.waitUntil(writeSettings(msg.payload))
  }
  if (msg.type === 'SKIP_WAITING') self.skipWaiting()
})

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

async function maybeRemind() {
  const s = await readSettings()
  if (!s || !s.enabled) return

  const now = new Date()
  const today = localDateKey(now)
  if (s.lastNotifiedDate === today) return
  if (s.lastLoggedDate === today) return

  const [hh, mm] = String(s.time || '21:00').split(':').map(Number)
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const minutesTarget = (hh || 0) * 60 + (mm || 0)
  // 지정 시각 이후에만, 그리고 그날 안에만 알립니다.
  if (minutesNow < minutesTarget) return

  await self.registration.showNotification('오늘 기록이 아직 비어 있어요', {
    body: '기분과 에너지만 눌러도 1분이면 끝납니다.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'dada-daily-reminder',
    data: { url: '/?log=today' },
  })
  await writeSettings({ ...s, lastNotifiedDate: today })
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'dada-daily-reminder') event.waitUntil(maybeRemind())
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'dada-daily-reminder') event.waitUntil(maybeRemind())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
