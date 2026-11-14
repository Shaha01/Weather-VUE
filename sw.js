// SHA Weather — service worker: сайт открывается без сети с последними данными.
//  · оболочка (HTML, JS, CSS, иконки) — из кэша, обновляется в фоне;
//  · погода и воздух (OpenWeather) — сначала сеть, без сети — последний ответ;
//  · тайлы карты — из кэша, если уже загружались (с ограничением размера).
const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const DATA = `data-${VERSION}`
const TILES = `tiles-${VERSION}`
const BASE = new URL('./', self.location).pathname // /Weather-VUE/

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([BASE, `${BASE}manifest.webmanifest`, `${BASE}icon-192.png`, `${BASE}icon-512.png`])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, TILES].includes(k)).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: false })
    if (hit) return hit
    throw err
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  const net = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
      return res
    })
    .catch(() => hit)
  return hit || net
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // страница: свежая из сети, без сети — сохранённая
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL).catch(() => caches.match(BASE)))
    return
  }
  // собственные файлы сайта
  if (url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    e.respondWith(staleWhileRevalidate(req, SHELL))
    return
  }
  // данные погоды и воздуха (геопоиск не кэшируем)
  if (url.hostname === 'api.openweathermap.org' && !url.pathname.startsWith('/geo/')) {
    e.respondWith(networkFirst(req, DATA))
    return
  }
  // шрифты
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, SHELL))
    return
  }
  // тайлы подложки карты
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    e.respondWith(staleWhileRevalidate(req, TILES).finally(() => trim(TILES, 400)))
  }
})
