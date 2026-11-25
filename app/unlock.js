'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const msg = (t, cls) => { const m = $('msg'); m.textContent = t; m.className = cls || ''; };
  const INFO = new TextEncoder().encode('jjooni-gh-site-v1');

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('jjooni-gh', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const t = fn(db.transaction('kv', mode).objectStore('kv')); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  }
  const getKey = () => kv('readonly', s => s.get('key'));
  const putKey = k => kv('readwrite', s => s.put(k, 'key'));
  const delKey = () => kv('readwrite', s => s.delete('key'));

  async function worker() {
    if (!('serviceWorker' in navigator)) throw Error('이 브라우저는 서비스워커를 지원하지 않습니다.');
    await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
    return (await navigator.serviceWorker.ready).active;
  }
  function ask(w, data, ms) {
    return new Promise((res, rej) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => rej(Error('TIMEOUT')), ms || 90000);
      ch.port1.onmessage = e => { clearTimeout(t); res(e.data); };
      w.postMessage(data, [ch.port2]);
    });
  }

  async function deriveKey(text) {
    const clean = text.replace(/\s+/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) throw Error('FORMAT');
    const raw = new Uint8Array(clean.match(/../g).map(h => parseInt(h, 16)));
    const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    raw.fill(0);
    return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  }

  async function register() {
    const btn = $('go'); btn.disabled = true;
    try {
      const key = await deriveKey($('key').value);
      $('key').value = '';
      msg('암호화된 화면을 내려받아 확인하는 중… (처음 한 번 약 10MB)');
      const w = await worker();
      await ask(w, 'lock', 5000);
      await putKey(key);
      const r = await ask(w, 'update');
      if (!r.ok) { await delKey(); throw Error(r.error || 'UPDATE'); }
      msg('등록 완료. 컨트롤타워를 엽니다.', 'good');
      location.replace('./v/');
    } catch (e) {
      const m = String(e && e.message || e);
      msg(m === 'FORMAT' ? '보안키는 64자리(0-9, a-f)입니다. 공백 없이 다시 붙여넣으세요.' : /OperationError|decrypt/i.test(m) || (e && e.name === 'OperationError') ? '보안키가 맞지 않습니다.' : '열기 실패: ' + m, 'bad');
    } finally { btn.disabled = false; }
  }

  async function refresh() {
    try { msg('최신 데이터 확인 중…'); const r = await ask(await worker(), 'update'); msg(r.ok ? (r.state === 'UPDATED' ? '새 데이터를 받았습니다. 화면을 다시 열면 적용됩니다.' : '최신 상태입니다.') : '확인 실패: ' + r.error, r.ok ? 'good' : 'bad'); }
    catch (e) { msg('확인 실패: ' + (e && e.message || e), 'bad'); }
  }
  async function lock() {
    try { const w = await worker(); await ask(w, 'lock', 5000); } catch (_) {}
    await delKey(); await caches.delete('jjooni-gh-site-v1');
    msg('이 기기에서 등록을 해제했습니다.', 'good'); show(false);
  }
  function show(ready) { $('unlock').hidden = ready; $('ready').hidden = !ready; }

  $('go').addEventListener('click', register);
  $('refresh').addEventListener('click', refresh);
  $('lock').addEventListener('click', lock);

  (async () => {
    let has = false;
    try { has = !!(await getKey()); } catch (_) {}
    show(has);
    if (has && !new URLSearchParams(location.search).has('locked')) {
      try {
        const w = await worker();
        let r = await ask(w, 'reload', 30000);
        if (!r.ok) { msg('최신 화면을 받는 중…'); r = await ask(w, 'update'); }
        if (r.ok) { location.replace('./v/'); return; }
      } catch (_) {}
      msg('저장된 화면을 열지 못했습니다. 최신 데이터 확인을 눌러주세요.', 'bad');
    }
  })();
})();
