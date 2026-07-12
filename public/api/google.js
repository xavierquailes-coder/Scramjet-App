// MiiCore Google Search Page - Vercel API route
// Usage: /api/google?q=anything
// Shows clean Google results inside MiiCore. Result clicks open through /api/web.
//
// NOTE: Google is far more aggressive than DuckDuckGo/Bing about detecting
// and blocking scraped requests (it will serve CAPTCHA/"unusual traffic"
// pages to datacenter IPs, including Cloudflare Workers' IPs, if you send a
// lot of requests). This route uses Google's older "basic HTML" mode
// (gbv=1) because it's far simpler to parse and slightly less likely to be
// blocked, but treat this as best-effort — if Google starts blocking the
// Worker's IP you'll mostly get empty results or the "unusual traffic" page,
// and the UI falls back to a "open Google directly" link.

const WORKER_URL = 'https://proxytesting.xavierquailes.workers.dev/?url=';

function esc(s=''){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function cleanQuery(q=''){
  return String(q).replace(/[\n\r<>]/g,' ').trim().slice(0,180);
}
function htmlDecode(str=''){
  return String(str)
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x2F;/g,'/').replace(/&#x27;/g,"'");
}
function stripTags(str=''){
  return htmlDecode(String(str).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
}
function unwrapGoogleUrl(href=''){
  let out = htmlDecode(href);
  if (out.startsWith('//')) out = 'https:' + out;
  try{
    const u = new URL(out, 'https://www.google.com');
    if (u.hostname.includes('google.') && u.pathname === '/url') {
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (q) return q;
    }
    if (u.hostname.includes('google.')) return ''; // internal google link (images, maps, etc) - skip
    return u.href;
  }catch{ return out.startsWith('/') ? '' : out; }
}
function parseGoogle(html='', limit=18){
  const results = [];
  const seen = new Set();
  // Basic HTML mode wraps each organic result roughly as:
  // <div ...><a href="/url?q=TARGET&..."><h3>TITLE</h3></a> ... snippet text ...</div>
  const anchorRe = /<a[^>]+href="(\/url\?q=[^"]+|https?:\/\/(?!www\.google)[^"]+)"[^>]*>\s*(?:<h3[^>]*>)?([\s\S]*?)(?:<\/h3>)?<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) && results.length < limit) {
    const url = unwrapGoogleUrl(m[1]);
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    const title = stripTags(m[2]);
    if (!title || title.length < 2) continue;
    seen.add(url);
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./,''); } catch {}
    results.push({ title, url, host, snippet: '' });
  }
  return results;
}
async function getGoogle(q){
  const target = 'https://www.google.com/search?' + new URLSearchParams({ q, gbv: '1', num: '20' }).toString();
  const workerUrl = WORKER_URL + encodeURIComponent(target);
  try{
    const r = await fetch(workerUrl, { signal: AbortSignal.timeout(12000), headers: { 'accept': 'text/html,application/xhtml+xml' } });
    if (!r.ok) throw new Error('Cloudflare Worker returned ' + r.status);
    return parseGoogle(await r.text());
  }catch(workerError){
    const r = await fetch(target, { signal: AbortSignal.timeout(12000), headers: {
      'user-agent': 'Mozilla/5.0 (SquiddCore Google Fallback)',
      'accept': 'text/html,application/xhtml+xml'
    }});
    if (!r.ok) throw new Error('Google search failed: ' + r.status);
    return parseGoogle(await r.text());
  }
}
function page(q, results, error=''){
  const cards = results.map(r => `<a class="result" rel="noreferrer" target="_self" href="/api/web?url=${encodeURIComponent(r.url)}">
    <div class="title">${esc(r.title||r.url)}</div>
    <div class="url">${esc(r.host||r.url)}</div>
    <div class="snippet">${esc(r.snippet||'Open this result through MiiCore proxy')}</div>
  </a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MiiCore Google</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05070b;color:#fff;font-family:Inter,Arial,sans-serif;overflow:auto}
    body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 20% 0%,rgba(255,180,0,.15),transparent 35%),radial-gradient(circle at 90% 20%,rgba(0,220,255,.12),transparent 30%);pointer-events:none}
    .wrap{position:relative;max-width:980px;margin:0 auto;padding:26px 18px 80px}.brand{display:flex;align-items:center;gap:10px;color:#aaa;font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}
    .orb{width:12px;height:12px;border-radius:50%;background:#ffb400;box-shadow:0 0 24px #ffb400}.search{display:flex;gap:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:10px;margin-bottom:18px;backdrop-filter:blur(10px)}
    input{flex:1;background:transparent;border:0;outline:0;color:white;font-size:18px;padding:10px 12px}button{border:0;border-radius:16px;background:#fff;color:#111;font-weight:800;padding:0 22px;cursor:pointer}.meta{color:#bbb;margin:8px 4px 18px;font-size:14px}.result{display:block;text-decoration:none;color:#fff;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:16px 18px;margin:12px 0;transition:.18s;box-shadow:0 16px 40px rgba(0,0,0,.18)}
    .result:hover{transform:translateY(-2px);background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.24)}.title{font-size:18px;font-weight:800;margin-bottom:5px}.url{font-size:13px;color:#8ee5ff;margin-bottom:8px}.snippet{font-size:14px;color:#d2d2d2;line-height:1.45}.empty{padding:40px;text-align:center;color:#ddd;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:22px}.err{color:#ffb4b4;margin-top:8px}
  </style></head><body><div class="wrap"><div class="brand"><span class="orb"></span>MiiCore Google Proxy</div>
  <form class="search" action="/api/google" method="get"><input name="q" value="${esc(q)}" placeholder="Search anything..."><button>Search</button></form>
  <div class="meta">${q?`Google results for <b>${esc(q)}</b>`:'Type anything to search with Google.'}${error?`<div class="err">${esc(error)}</div>`:''}</div>
  ${cards || `<div class="empty">No results loaded (Google sometimes blocks scraped requests). <a style="color:#8ee5ff" href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_self">Open Google directly</a> or try another search.</div>`}</div></body></html>`;
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
  if(req.method!=='GET') return res.status(405).send('GET only');
  const q=cleanQuery(req.query.q||'');
  try{
    if(!q) return res.status(200).setHeader('Content-Type','text/html; charset=utf-8').send(page('',[]));
    const results=await getGoogle(q);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(page(q,results));
  }catch(e){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(page(q,[],e?.message||'Search failed'));
  }
}

export { getGoogle, parseGoogle };
