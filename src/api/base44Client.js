// Local stand-in for the Base44 SDK.
// Data is seeded from /churches.json on first load, then saved in the browser's localStorage
// so visited/notes/removed changes persist between visits.
//
// If you later connect to a real Base44 app, replace this file with the real client:
//   import { createClient } from '@base44/sdk';
//   export const base44 = createClient({ appId: 'YOUR_APP_ID' });

const STORAGE_KEY = 'coweta-churches-v3';

async function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const res = await fetch(`${import.meta.env.BASE_URL}churches.json`);
  const seed = await res.json();
  const rows = seed.map((c, i) => ({
    id: String(c.id ?? c.church_id ?? i + 1),
    church_id: c.church_id ?? i + 1,
    visited: false,
    excluded: false,
    notes: '',
    ...c,
  }));
  saveAll(rows);
  return rows;
}

function saveAll(rows) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch {}
}

function matches(row, query) {
  return Object.entries(query || {}).every(([k, v]) => (row[k] ?? false) === v);
}

const CowetaChurch = {
  async filter(query, sortField, limit = 1000) {
    const rows = (await loadAll()).filter(r => matches(r, query));
    if (sortField) {
      const desc = sortField.startsWith('-');
      const f = desc ? sortField.slice(1) : sortField;
      rows.sort((a, b) => ((a[f] ?? 0) > (b[f] ?? 0) ? 1 : (a[f] ?? 0) < (b[f] ?? 0) ? -1 : 0) * (desc ? -1 : 1));
    }
    return rows.slice(0, limit);
  },
  async update(id, patch) {
    const rows = await loadAll();
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) throw new Error(`Church ${id} not found`);
    rows[idx] = { ...rows[idx], ...patch };
    saveAll(rows);
    return rows[idx];
  },
};

// Local version of the "verifyCowetaChurchUrls" backend function.
// The original used AI web search on the server; in the browser we can only clean up URLs:
// trim whitespace, add a missing https://, and drop obviously invalid values.
const BATCH = 10;
function normalizeUrl(url) {
  if (!url) return url;
  let u = String(url).trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { return ''; }
}

const functions = {
  async invoke(name, { offset = 0 } = {}) {
    if (name !== 'verifyCowetaChurchUrls') throw new Error(`Unknown function ${name}`);
    const rows = await loadAll();
    const active = rows.filter(r => !r.excluded);
    const batch = active.slice(offset, offset + BATCH);
    const changes = [];
    for (const c of batch) {
      const fixed = normalizeUrl(c.website);
      if (c.website && fixed !== c.website) {
        changes.push({ id: c.id, name: c.name, old: c.website, new: fixed });
        await CowetaChurch.update(c.id, { website: fixed });
      }
    }
    await new Promise(r => setTimeout(r, 150));
    const processed = Math.min(offset + BATCH, active.length);
    return { data: { processed, total: active.length, changes, done: processed >= active.length, nextOffset: processed } };
  },
};

export const base44 = { entities: { CowetaChurch }, functions };
