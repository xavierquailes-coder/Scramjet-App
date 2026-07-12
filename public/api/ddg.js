// SquiddCore DuckDuckGo Search Page - Vercel API route
// Usage: /api/ddg?q=anything
// Shows clean DuckDuckGo results inside MiiCore. Result clicks open through /api/web.

function esc(s=''){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function cleanQuery(q=''){
  return String(q).replace(/[\n\r<>]/g,' ').trim().slice(0,180);
}

function tiktokTerms(q=''){
  const raw=String(q||'').trim();
  if(!raw) return {is:false, term:''};
  const lower=raw.toLowerCase();
  let term='';
  if(lower==='tiktok' || lower==='tik tok') return {is:true, term:''};
  if(lower.startsWith('tiktok ')) term=raw.slice(7).trim();
  else if(lower.startsWith('tik tok ')) term=raw.slice(8).trim();
  else if(lower.includes(' tiktok')) term=raw.replace(/\btik\s*tok\b/ig,'').replace(/\btiktok\b/ig,'').trim();
  else return {is:false, term:''};
  return {is:true, term};
}
function tiktokQuickResults(q=''){
  const t=tiktokTerms(q);
  if(!t.is) return [];
  const term=t.term || '';
  const encoded=encodeURIComponent(term || q);
  const list=[];
  if(term){
    list.push({title:'Search TikTok for '+term, url:'https://www.tiktok.com/search?q='+encoded, host:'tiktok.com', snippet:'Open TikTok search results through the SquiddCore browser proxy.'});
    list.push({title:'TikTok videos for '+term, url:'https://www.tiktok.com/tag/'+encodeURIComponent(term.replace(/\s+/g,'')), host:'tiktok.com', snippet:'Open the TikTok hashtag page through the proxy.'});
  }else{
    list.push({title:'TikTok', url:'https://www.tiktok.com/', host:'tiktok.com', snippet:'Open TikTok through the SquiddCore browser proxy.'});
    list.push({title:'TikTok Explore', url:'https://www.tiktok.com/explore', host:'tiktok.com', snippet:'Open TikTok Explore through the proxy.'});
  }
  return list;
}
function duckQueryFor(q=''){
  const t=tiktokTerms(q);
  if(t.is && t.term) return 'site:tiktok.com '+t.term;
  return q;
}

function htmlDecode(str=''){
  return String(str)
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x2F;/g,'/').replace(/&#x27;/g,"'");
}
function stripTags(str=''){
  return htmlDecode(String(str).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
}
function unwrapDuckUrl(href=''){
  let out=htmlDecode(href);
  if(out.startsWith('//')) out='https:'+out;
  try{
    const u=new URL(out);
    const uddg=u.searchParams.get('uddg');
    if(uddg) return decodeURIComponent(uddg);
    return out;
  }catch{return out;}
}
function parseDuck(html='', limit=18){
  const results=[];
  const blocks=html.match(/<div class="result[\s\S]*?result__body[\s\S]*?<\/div>\s*<\/div>/g)||html.match(/<tr[\s\S]*?result-link[\s\S]*?<\/tr>/g)||[];
  for(const block of blocks){
    const a=block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if(!a) continue;
    const snippet=block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)||block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const rawUrl=unwrapDuckUrl(a[1]);
    if(!/^https?:\/\//i.test(rawUrl)) continue;
    let host='';
    try{host=new URL(rawUrl).hostname.replace(/^www\./,'');}catch{}
    results.push({title:stripTags(a[2]), url:rawUrl, host, snippet:snippet?stripTags(snippet[1]):''});
    if(results.length>=limit) break;
  }
  return results;
}
async function getDuck(q){
  const target='https://duckduckgo.com/html/?'+new URLSearchParams({q: duckQueryFor(q)}).toString();
  const workerUrl='https://proxytesting.xavierquailes.workers.dev/?url='+encodeURIComponent(target);
  try{
    const r=await fetch(workerUrl,{signal:AbortSignal.timeout(12000),headers:{
      'accept':'text/html,application/xhtml+xml'
    }});
    if(!r.ok) throw new Error('Cloudflare Worker returned '+r.status);
    return parseDuck(await r.text());
  }catch(workerError){
    const r=await fetch(target,{signal:AbortSignal.timeout(12000),headers:{
      'user-agent':'Mozilla/5.0 (SquiddCore DuckDuckGo Fallback)',
      'accept':'text/html,application/xhtml+xml'
    }});
    if(!r.ok) throw new Error('DuckDuckGo search failed: '+r.status);
    return parseDuck(await r.text());
  }
}
function page(q, results, error=''){
  const merged=[...tiktokQuickResults(q), ...results].filter((r,i,a)=>a.findIndex(x=>x.url===r.url)===i);
  const cards=merged.map(r=>`<a class="result" rel="noreferrer" target="_self" href="/api/web?url=${encodeURIComponent(r.url)}">
    <div class="title">${esc(r.title||r.url)}</div>
    <div class="url">${esc(r.host||r.url)}</div>
    <div class="snippet">${esc(r.snippet||'Open this result through SquiddCore proxy')}</div>
  </a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SquiddCore DuckDuckGo</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#05070b;color:#fff;font-family:Inter,Arial,sans-serif;overflow:auto}
    body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 20% 0%,rgba(80,90,255,.18),transparent 35%),radial-gradient(circle at 90% 20%,rgba(0,220,255,.12),transparent 30%);pointer-events:none}
    .wrap{position:relative;max-width:980px;margin:0 auto;padding:26px 18px 80px}.brand{display:flex;align-items:center;gap:10px;color:#aaa;font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}
    .orb{width:12px;height:12px;border-radius:50%;background:#5f6cff;box-shadow:0 0 24px #5f6cff}.search{display:flex;gap:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:10px;margin-bottom:18px;backdrop-filter:blur(10px)}
    input{flex:1;background:transparent;border:0;outline:0;color:white;font-size:18px;padding:10px 12px}button{border:0;border-radius:16px;background:#fff;color:#111;font-weight:800;padding:0 22px;cursor:pointer}.meta{color:#bbb;margin:8px 4px 18px;font-size:14px}.result{display:block;text-decoration:none;color:#fff;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:16px 18px;margin:12px 0;transition:.18s;box-shadow:0 16px 40px rgba(0,0,0,.18)}
    .result:hover{transform:translateY(-2px);background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.24)}.title{font-size:18px;font-weight:800;margin-bottom:5px}.url{font-size:13px;color:#8ee5ff;margin-bottom:8px}.snippet{font-size:14px;color:#d2d2d2;line-height:1.45}.empty{padding:40px;text-align:center;color:#ddd;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:22px}.err{color:#ffb4b4;margin-top:8px}
  </style></head><body><div class="wrap"><div class="brand"><span class="orb"></span>SquiddCore DuckDuckGo Proxy</div>
  <form class="search" action="/api/ddg" method="get"><input name="q" value="${esc(q)}" placeholder="Search anything..."><button>Search</button></form>
  <div class="meta">${q?`${tiktokTerms(q).is?'TikTok + DuckDuckGo results for':'DuckDuckGo results for'} <b>${esc(q)}</b>`:'Type anything to search with DuckDuckGo.'}${error?`<div class="err">${esc(error)}</div>`:''}</div>
  ${cards || `<div class="empty">No results loaded. <a style="color:#8ee5ff" href="https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web" target="_self">Open DuckDuckGo directly</a> or try another search.</div>`}</div></body></html>`;
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
  if(req.method!=='GET') return res.status(405).send('GET only');
  const q=cleanQuery(req.query.q||'');
  try{
    if(!q) return res.status(200).setHeader('Content-Type','text/html; charset=utf-8').send(page('',[]));
    const results=await getDuck(q);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(page(q,results));
  }catch(e){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(page(q,[],e?.message||'Search failed'));
  }
}
