/* JJOONI encrypted site service worker v1.
 * Public hosting only ever holds ciphertext (site.bin). The device keeps a
 * non-extractable AES key in IndexedDB and the ciphertext in Cache Storage.
 * Decrypted files exist only in this worker's memory and are served under ./v/. */
'use strict';
const VERSION = 'gh-site-v1';
const RAW = 'https://raw.githubusercontent.com/mauveplace/jjooni-dashboard-web/enc-site/';
const SCOPE = new URL('./', self.registration.scope).href;
const VIRT = new URL('v/', SCOPE).pathname;
const CACHE = 'jjooni-gh-site-v1';
const BIN_KEY = SCOPE + '__site.bin';
const META_KEY = SCOPE + '__site.json';
const AAD = new TextEncoder().encode('jjooni-gh-site-v1');
const MAGIC = 'JJGS1';
const TYPES = {html:'text/html; charset=utf-8',js:'application/javascript; charset=utf-8',mjs:'application/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',webmanifest:'application/manifest+json',png:'image/png',svg:'image/svg+xml',ico:'image/x-icon',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff2:'font/woff2',woff:'font/woff',md:'text/plain; charset=utf-8',txt:'text/plain; charset=utf-8',csv:'text/csv; charset=utf-8',gz:'application/gzip',map:'application/json'};

let site = null;          // {sha, entries: Map, buf: Uint8Array}
let pending = null;       // newer verified site, applied on the next navigation
let loading = null;
let lastCheck = 0;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('jjooni-gh', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}

const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');

async function decryptBin(bin, key) {
  const u = new Uint8Array(bin);
  if (new TextDecoder().decode(u.subarray(0, 5)) !== MAGIC) throw Error('SITE_FORMAT');
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: u.subarray(5, 17), additionalData: AAD, tagLength: 128}, key, u.subarray(17));
  return new Uint8Array(plain);
}

function parseZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw Error('ZIP_EOCD');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw Error('ZIP_CD');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    entries.set(name, {method, csize, usize, off});
    p += 46 + nl + el + cl;
  }
  return entries;
}

async function readEntry(e) {
  const dv = new DataView(site.buf.buffer, site.buf.byteOffset, site.buf.byteLength);
  if (dv.getUint32(e.off, true) !== 0x04034b50) throw Error('ZIP_LOCAL');
  const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
  const raw = site.buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw Error('ZIP_METHOD');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadFromCache() {
  const key = await kvGet('key');
  if (!key) return null;
  const cache = await caches.open(CACHE);
  const r = await cache.match(BIN_KEY), m = await cache.match(META_KEY);
  if (!r) return null;
  const bin = await r.arrayBuffer();
  const buf = await decryptBin(bin, key);
  const meta = m ? await m.json() : {};
  return {sha: meta.sha256 || hex(await crypto.subtle.digest('SHA-256', bin)), entries: parseZip(buf), buf};
}

function ensureSite() {
  if (site) return Promise.resolve(site);
  if (!loading) loading = loadFromCache().then(s => { site = s; loading = null; return s; }, err => { loading = null; throw err; });
  return loading;
}

async function checkUpdate(force) {
  const now = Date.now();
  if (!force && now - lastCheck < 60000) return 'SKIPPED';
  lastCheck = now;
  const key = await kvGet('key');
  if (!key) return 'LOCKED';
  const meta = await (await fetch(RAW + 'manifest.json?t=' + now, {cache: 'no-store'})).json();
  if (!/^[0-9a-f]{64}$/.test(meta.sha256 || '')) throw Error('MANIFEST');
  if ((pending || site) && (pending || site).sha === meta.sha256) return 'CURRENT';
  const r = await fetch(RAW + 'site.bin?s=' + meta.sha256, {cache: 'no-store'});
  if (!r.ok) throw Error('SITE_HTTP_' + r.status);
  const bin = await r.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', bin)) !== meta.sha256) throw Error('SITE_SHA');
  const buf = await decryptBin(bin, key);
  const entries = parseZip(buf);
  const cache = await caches.open(CACHE);
  await cache.put(BIN_KEY, new Response(bin));
  await cache.put(META_KEY, new Response(JSON.stringify(meta), {headers: {'Content-Type': 'application/json'}}));
  if (site) pending = {sha: meta.sha256, entries, buf}; else site = {sha: meta.sha256, entries, buf};
  return 'UPDATED';
}

self.addEventListener('message', e => {
  const port = e.ports && e.ports[0];
  const reply = v => port && port.postMessage(v);
  if (e.data === 'reload') { site = null; pending = null; e.waitUntil(ensureSite().then(s => reply({ok: !!s, sha: s && s.sha}), err => reply({ok: false, error: String(err && err.message || err)}))); }
  else if (e.data === 'update') { e.waitUntil(checkUpdate(true).then(state => reply({ok: true, state, sha: site && site.sha}), err => reply({ok: false, error: String(err && err.message || err)}))); }
  else if (e.data === 'lock') { site = null; pending = null; reply({ok: true}); }
  else if (e.data === 'status') { reply({ok: true, version: VERSION, loaded: !!site, sha: site && site.sha, files: site ? site.entries.size : 0}); }
});

async function serve(url, request) {
  let s;
  try { s = await ensureSite(); } catch (_) { s = null; }
  if (!s) return request.mode === 'navigate' ? Response.redirect(SCOPE + '?locked=1', 302) : new Response('LOCKED', {status: 401});
  let name = decodeURIComponent(url.pathname.slice(VIRT.length));
  if (name === '' || name.endsWith('/')) name += 'index.html';
  let e = s.entries.get(name);
  if (!e && !/\.[a-z0-9]+$/i.test(name) && s.entries.get(name + '/index.html')) return Response.redirect(url.pathname + '/' + url.search, 301);
  if (!e) return new Response('NOT_FOUND', {status: 404, headers: {'Content-Type': 'text/plain'}});
  const body = await readEntry(e);
  const ext = (name.split('.').pop() || '').toLowerCase();
  return new Response(body, {status: 200, headers: {'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(VIRT) || e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate' && pending) { site = pending; pending = null; }
  e.respondWith(serve(url, e.request));
  if (e.request.mode === 'navigate') e.waitUntil(checkUpdate(false).catch(() => {}));
});
