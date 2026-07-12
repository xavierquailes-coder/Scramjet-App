
// MiiCore Music Proxy - Vercel API route
// Search full, public audio without a client ID. This does NOT bypass paid streaming services.

const AUDIO_RE = /\.(mp3|ogg|m4a|wav)$/i;
const BAD_AUDIO_RE = /(__ia_thumb|_spectrogram|_files\.xml|metadata|itemimage|thumb)/i;
const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;

function encPath(name = '') {
  return String(name).split('/').map(encodeURIComponent).join('/');
}

function cleanQuery(q = '') {
  return String(q).replace(/[\n\r<>]/g, ' ').trim().slice(0, 120);
}

function pickAudio(files = []) {
  const playable = files.filter(f => f && f.name && AUDIO_RE.test(f.name) && !BAD_AUDIO_RE.test(f.name));
  // Prefer normal MP3 files; otherwise use the first playable audio format.
  return playable.find(f => /\.mp3$/i.test(f.name)) || playable[0] || null;
}

function pickCover(identifier, files = []) {
  const cover = files.find(f => f && f.name && IMG_RE.test(f.name) && /cover|folder|album|front|thumb/i.test(f.name));
  if (!cover) return '';
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encPath(cover.name)}`;
}

async function searchInternetArchive(q, limit = 18) {
  const url = 'https://archive.org/advancedsearch.php?' + new URLSearchParams({
    q: `mediatype:audio AND (${q})`,
    'fl[]': 'identifier',
    rows: String(limit),
    page: '1',
    output: 'json'
  }).toString();

  const sr = await fetch(url, { headers: { 'user-agent': 'MiiCoreMusicProxy/1.0' } });
  if (!sr.ok) throw new Error(`Archive search failed: ${sr.status}`);
  const data = await sr.json();
  const docs = data?.response?.docs || [];
  const results = [];

  for (const doc of docs.slice(0, limit)) {
    if (!doc.identifier) continue;
    try {
      const mr = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, {
        headers: { 'user-agent': 'MiiCoreMusicProxy/1.0' }
      });
      if (!mr.ok) continue;
      const meta = await mr.json();
      const files = Array.isArray(meta.files) ? meta.files : [];
      const audio = pickAudio(files);
      if (!audio) continue;
      const md = meta.metadata || {};
      const identifier = meta.metadata?.identifier || doc.identifier;
      results.push({
        id: `${identifier}:${audio.name}`,
        title: Array.isArray(md.title) ? md.title[0] : (md.title || doc.identifier),
        artist: Array.isArray(md.creator) ? md.creator.join(', ') : (md.creator || 'Internet Archive'),
        album: Array.isArray(md.collection) ? md.collection[0] : (md.collection || 'Internet Archive'),
        source: 'Internet Archive',
        cover: pickCover(identifier, files),
        audio: `https://archive.org/download/${encodeURIComponent(identifier)}/${encPath(audio.name)}`,
        duration: audio.length || null,
        license: Array.isArray(md.licenseurl) ? md.licenseurl[0] : (md.licenseurl || '')
      });
      if (results.length >= 12) break;
    } catch (_) {}
  }
  return results;
}

export default async function handler(req, res) {
  try {
    const q = cleanQuery(req.query.q || req.query.search || '');
    const limit = Math.min(parseInt(req.query.limit || '18', 10) || 18, 30);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!q) return res.status(200).json({ results: [], source: 'MiiCore Proxy', message: 'Missing q search term' });
    const results = await searchInternetArchive(q, limit);
    return res.status(200).json({ results, source: 'MiiCore Proxy' });
  } catch (err) {
    return res.status(500).json({ results: [], error: err?.message || 'Proxy failed' });
  }
}
