// Configuration state: defaults <- localStorage <- URL hash. Saved (debounced) to both.
import { DEFAULTS } from './config.js';

const KEY = 'eurovan-viewer-config-v1';

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// keep only known keys with the right types
function sanitize(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!(k in obj)) continue;
    const v = obj[k];
    if (Array.isArray(def)) { if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string').slice(0, 64); }
    else if (typeof v === typeof def) out[k] = v;
  }
  if (typeof out.hour === 'number') out.hour = Math.max(0, Math.min(24, out.hour));
  for (const k of ['paint', 'doorHex', 'seatHex']) if (out[k] && !/^#[0-9a-f]{6}$/i.test(out[k])) delete out[k];
  return out;
}

export function loadState() {
  let stored = {}, fromHash = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { stored = {}; }
  try {
    const m = location.hash.match(/[#&]c=([A-Za-z0-9_-]+)/);
    if (m) fromHash = JSON.parse(b64urlDecode(m[1]));
  } catch (_) { fromHash = {}; }
  const s = { ...DEFAULTS, ...sanitize(stored), ...sanitize(fromHash) };
  s.hidden = [...(s.hidden || [])];
  return s;
}

function diff(s) {
  const d = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = s[k];
    if (Array.isArray(def) ? JSON.stringify(v) !== JSON.stringify(def) : v !== def) d[k] = v;
  }
  return d;
}

let timer = 0;
export function saveState(s) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const d = diff(s);
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) { /* private mode etc. */ }
    try {
      const hash = Object.keys(d).length ? '#c=' + b64urlEncode(JSON.stringify(d)) : '';
      const url = location.pathname + location.search + hash;
      history.replaceState(null, '', url);
    } catch (_) { /* ignore */ }
  }, 250);
}

export function shareUrl(s) {
  const d = diff(s);
  const hash = Object.keys(d).length ? '#c=' + b64urlEncode(JSON.stringify(d)) : '';
  return location.origin + location.pathname + location.search + hash;
}

export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
}
