// MiiCore Bing Search Page - Vercel API route
// Usage: /api/bing?q=anything
// Shows clean Bing results inside MiiCore. Result clicks open through /api/web.

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
// Bing wraps some result links in a redirect (bing.com/ck/a?...&u=a1...base64...).
// Most organic results are plain hrefs though, so just pass through if we can't unwrap.
function unwrapBingUrl(href=''){
  let out = htmlDecode(href);
  if (out.startsWith('//')) out = 'https:' + out;
  try{
    const u = new URL(out, 'https://www.bing.com');
    if (u.hostname.includes('bing.com') && u.pathname === '/ck/a') {
      const uParam = u.searchParams.get('u');
      if (uParam) {
        // Bing base64-encodes the target after an "a1" prefix, url-safe base64.
        let b64 = uParam.startsWith('a1') ? uParam.slice(2) : uParam;
        b64 = b64.replace(/-/g,'+').replace(/_/g,'/');
        while (b64.length % 4) b64 += '=';
        try {
          const decoded = Buffer.from(b64, 'base64').toString('utf8');
          if (/^https?:\/\//i.test(decoded)) return decoded;
        } catch {}
      }
      return u.href;
    }
    return u.href;
  }catch{ return out; }
}
function parseBing(html='', limit=18){
  const results = [];
  // Bing's organic results live in <li class="b_algo">...</li> blocks.
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const snippetMatch = block.match(/<p>([\s\S]*?)<\/p>/i) || block.match(/class="b_caption"[\s\S]*?<p>([\s\S]*?)<\/p>/i);
    const rawUrl = unwrapBingUrl(a[1]);
    if (!/^https?:\/\//i.test(rawUrl)) continue;
    let host = '';
    try { host = new URL(rawUrl).hostname.replace(/^www\./,''); } catch {}
    results.push({ title: stripTags(a[2]), url: rawUrl, host, snippet: snippetMatch ? stripTags(snippetMatch[1]) : '' });
    if (results.length >= limit) break;
  }
  return results;
}
async function getBing(q){
  const target = 'https://www.bing.com/search?' + new URLSearchParams({ q, form: 'QBLH' }).toString();
  const workerUrl = WORKER_URL + encodeURIComponent(target);
  try{
    const r = await fetch(workerUrl, { signal: AbortSignal.timeout(12000), headers: { 'accept': 'text/html,application/xhtml+xml' } });
    if (!r.ok) throw new Error('Cloudflare Worker returned ' + r.status);
    return parseBing(await r.text());
  }catch(workerError){
    const r = await fetch(target, { signal: AbortSignal.timeout(12000), headers: {
      'user-agent': 'Mozilla/5.0 (SquiddCore Bing Fallback)',
      'accept': 'text/html,application/xhtml+xml'
    }});
    if (!r.ok) throw new Error('Bing search failed: ' + r.status);
    return parseBing(await r.text());
  }
}
function page(q, results, error=''){
  const cards = results.map(r => `<a class="result" rel="noreferrer" target="_self" href="/api/web?url=${encodeURIComponent(r.url)}">
    <div class="title">${esc(r.title||r.url)}</div>
    <div class="url">${esc(r.host||r.url)}</div>
    <div class="snippet">${esc(r.snippet||'Open this result through MiiCore proxy')}</div>
  </a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MiiCore Bing</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05070b;color:#fff;font-family:Inter,Arial,sans-serif;overflow:auto}
    body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 20% 0%,rgba(0,150,255,.18),transparent 35%),radial-gradient(circle at 90% 20%,rgba(0,220,255,.12),transparent 30%);pointer-events:none}
    .wrap{position:relative;max-width:980px;margin:0 auto;padding:26px 18px 80px}.brand{display:flex;align-items:center;gap:10px;color:#aaa;font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}
    .orb{width:12px;height:12px;border-radius:50%;background:#00a6ff;box-shadow:0 0 24px #00a6ff}.search{display:flex;gap:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:10px;margin-bottom:18px;backdrop-filter:blur(10px)}
    input{flex:1;background:transparent;border:0;outline:0;color:white;font-size:18px;padding:10px 12px}button{border:0;border-radius:16px;background:#fff;color:#111;font-weight:800;padding:0 22px;cursor:pointer}.meta{color:#bbb;margin:8px 4px 18px;font-size:14px}.result{display:block;text-decoration:none;color:#fff;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:16px 18px;margin:12px 0;transition:.18s;box-shadow:0 16px 40px rgba(0,0,0,.18)}
    .result:hover{transform:translateY(-2px);background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.24)}.title{font-size:18px;font-weight:800;margin-bottom:5px}.url{font-size:13px;color:#8ee5ff;margin-bottom:8px}.snippet{font-size:14px;color:#d2d2d2;line-height:1.45}.empty{padding:40px;text-align:center;color:#ddd;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:22px}.err{color:#ffb4b4;margin-top:8px}
  </style></head><body><div class="wrap"><div class="brand"><span class="orb"></span>MiiCore Bing Proxy</div>
  <form class="search" action="/api/bing" method="get"><input name="q" value="${esc(q)}" placeholder="Search anything..."><button>Search</button></form>
  <div class="meta">${q?`Bing results for <b>${esc(q)}</b>`:'Type anything to search with Bing.'}${error?`<div class="err">${esc(error)}</div>`:''}</div>
  ${cards || `<div class="empty">No results loaded. <a style="color:#8ee5ff" href="https://www.bing.com/search?q=${encodeURIComponent(q)}" target="_self">Open Bing directly</a> or try another search.</div>`}</div></body></html>`;
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
  if(req.method!=='GET') return res.status(405).send('GET only');
  const q=cleanQuery(req.query.q||'');
  try{
    if(!q) return res.status(200).setHeader('Content-Type','text/html; charset=utf-8').send(page('',[]));
    const results=await getBing(q);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(page(q,results));
  }catch(e){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(page(q,[],e?.message||'Search failed'));
  }
}

export { getBing, parseBing };
