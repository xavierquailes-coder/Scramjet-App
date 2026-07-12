// MiiCore Multi-Engine Search Proxy - Vercel API route
// Usage: /api/search?q=anything                (auto: tries DuckDuckGo, then Bing, then Google)
//        /api/search?q=anything&engine=ddg      (DuckDuckGo only)
//        /api/search?q=anything&engine=bing     (Bing only)
//        /api/search?q=anything&engine=google   (Google only)
//        /api/search?q=anything&engine=all      (DuckDuckGo + Bing + Google, merged)
// No Archive.org fallback. If every engine blocks scraping, returns useful non-Archive search links.

import { getBing } from './bing.js';
import { getGoogle } from './google.js';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
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
  if(term){
    return [
      {title:'Search TikTok for '+term, url:'https://www.tiktok.com/search?q='+encodeURIComponent(term), snippet:'Open TikTok search results through the MiiCore proxy.', source:'TikTok'},
      {title:'TikTok hashtag: '+term, url:'https://www.tiktok.com/tag/'+encodeURIComponent(term.replace(/\s+/g,'')), snippet:'Open the TikTok hashtag page through the proxy.', source:'TikTok'}
    ];
  }
  return [
    {title:'TikTok', url:'https://www.tiktok.com/', snippet:'Open TikTok through the MiiCore proxy.', source:'TikTok'},
    {title:'TikTok Explore', url:'https://www.tiktok.com/explore', snippet:'Open TikTok Explore through the proxy.', source:'TikTok'}
  ];
}
function duckQueryFor(q=''){
  const t=tiktokTerms(q);
  if(t.is && t.term) return 'site:tiktok.com '+t.term;
  return q;
}

function cleanQuery(q=''){ return String(q).replace(/[\n\r<>]/g,' ').trim().slice(0,180); }
function htmlDecode(str=''){
  return String(str)
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x2F;/g,'/').replace(/&#x27;/g,"'");
}
function stripTags(str=''){ return htmlDecode(String(str).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()); }
function unwrapDuckUrl(href=''){
  let out=htmlDecode(href||'');
  if(out.startsWith('//')) out='https:'+out;
  try{
    const u=new URL(out, 'https://duckduckgo.com');
    const uddg=u.searchParams.get('uddg');
    if(uddg) return decodeURIComponent(uddg);
    if(u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l/')) return out;
    return u.href;
  }catch{ return out; }
}
function okay(url){
  if(!/^https?:\/\//i.test(url||'')) return false;
  try{
    const h=new URL(url).hostname.toLowerCase();
    if(h.includes('archive.org')) return false;
    if(h.includes('duckduckgo.com') && /\/y\.js|\/t\.js|\/l\//.test(new URL(url).pathname) && !url.includes('uddg=')) return false;
  }catch{return false;}
  return true;
}
function push(results, r, limit){
  if(!r || !okay(r.url)) return;
  if(results.some(x=>x.url===r.url)) return;
  results.push(r);
}
function parseDuck(html='', limit=14){
  const results=[];
  // Common DDG HTML result blocks
  const blockRe=/<div[^>]*class=["'][^"']*result[^"']*["'][\s\S]*?(?=<div[^>]*class=["'][^"']*result[^"']*["']|<\/body>|$)/gi;
  const blocks=html.match(blockRe)||[];
  for(const block of blocks){
    const a=block.match(/<a[^>]*(?:class=["'][^"']*result__a[^"']*["'][^>]*)href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
            block.match(/<a[^>]*href=["']([^"']+)["'][^>]*(?:class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i);
    if(!a) continue;
    const url=unwrapDuckUrl(a[1]);
    const sn=block.match(/<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    push(results,{title:stripTags(a[2]),url,snippet:sn?stripTags(sn[1]):'',source:'DuckDuckGo'},limit);
    if(results.length>=limit) return results;
  }
  // Lite fallback rows
  const rows=html.match(/<tr[\s\S]*?<\/tr>/gi)||[];
  for(const row of rows){
    const a=row.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if(!a) continue;
    const url=unwrapDuckUrl(a[1]);
    const title=stripTags(a[2]);
    if(!title || title.length<2) continue;
    push(results,{title,url,snippet:'DuckDuckGo result',source:'DuckDuckGo'},limit);
    if(results.length>=limit) return results;
  }
  return results;
}
async function fetchText(url){
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{
    'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language':'en-US,en;q=0.9'
  }});
  if(!r.ok) throw new Error('DuckDuckGo returned '+r.status);
  return await r.text();
}
async function duckSearch(q, limit){
  const directUrls=[
    'https://html.duckduckgo.com/html/?'+new URLSearchParams({q}).toString(),
    'https://duckduckgo.com/html/?'+new URLSearchParams({q}).toString(),
    'https://lite.duckduckgo.com/lite/?'+new URLSearchParams({q}).toString()
  ];
  const urls=[
    ...directUrls.map(u => 'https://proxytesting.xavierquailes.workers.dev/?url=' + encodeURIComponent(u)),
    ...directUrls
  ];
  let last='';
  for(const u of urls){
    try{ const found=parseDuck(await fetchText(u),limit); if(found.length) return found; }
    catch(e){ last=e?.message||String(e); }
  }
  throw new Error(last||'No DuckDuckGo results parsed');
}
function fallbackLinks(q){
  const e=encodeURIComponent(q);
  return [
    {title:'DuckDuckGo results for '+q, url:'https://duckduckgo.com/?q='+e+'&ia=web', snippet:'Open the real DuckDuckGo results page if the server-side results are blocked.', source:'Fallback'},
    {title:'Search YouTube for '+q, url:'https://www.youtube.com/results?search_query='+e, snippet:'Search videos directly.', source:'Fallback'},
    {title:'Search Wikipedia for '+q, url:'https://en.wikipedia.org/w/index.php?search='+e, snippet:'Search Wikipedia directly.', source:'Fallback'},
    {title:'Search Google for '+q, url:'https://www.google.com/search?q='+e, snippet:'Direct web search fallback.', source:'Fallback'},
    {title:'Search Bing for '+q, url:'https://www.bing.com/search?q='+e, snippet:'Direct web search fallback.', source:'Fallback'}
  ];
}
// Tag each engine's results with their source and interleave (round-robin)
// instead of just concatenating, so "all" results don't end up as one giant
// DuckDuckGo block followed by one giant Bing block.
function interleave(lists){
  const out=[];
  const max=Math.max(0,...lists.map(l=>l.length));
  for(let i=0;i<max;i++){
    for(const l of lists){ if(l[i]) out.push(l[i]); }
  }
  return out;
}

async function searchEngine(engine, q, limit){
  if(engine==='bing') return (await getBing(q)).map(r=>({...r, source:'Bing'}));
  if(engine==='google') return (await getGoogle(q)).map(r=>({...r, source:'Google'}));
  return (await duckSearch(q, limit)).map(r=>({...r, source: r.source || 'DuckDuckGo'}));
}

// Cascade through engines in order until one actually returns results. This is
// what makes plain-text search reliable: DuckDuckGo's HTML endpoint has gotten
// more aggressive about blocking scraped requests, so rather than surfacing
// that failure to the user, we quietly try Bing next, then Google, before
// finally giving up and showing static fallback links.
async function cascadeSearch(q, limit){
  const order=['ddg','bing','google'];
  const errors=[];
  for(const engine of order){
    try{
      const found=await searchEngine(engine, q, limit);
      if(found && found.length) return { results: found, source: engine==='ddg'?'DuckDuckGo':(engine==='bing'?'Bing':'Google'), error: errors.join(' | ') };
    }catch(e){
      errors.push(engine+': '+(e?.message||'failed'));
    }
  }
  return { results: [], source: 'Fallback links', error: errors.join(' | ')||'All engines failed' };
}

export default async function handler(req,res){
  cors(res); if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='GET') return res.status(405).json({error:'GET only',results:[]});
  const q=cleanQuery(req.query.q||req.query.search||'');
  const engine=String(req.query.engine||'ddg').toLowerCase(); // ddg (auto-cascades) | bing | google | all

  // MIICORE_TIKTOK_SPECIAL_RESULTS
  if (/^\s*(tik\s*tok|tiktok)(\s+.*)?$/i.test(q || '')) {
    const term = String(q || '').replace(/tik\s*tok/ig,'').trim() || 'trending';
    return res.status(200).json({results:[
      {title:'Search TikTok results', url:'https://duckduckgo.com/?q=' + encodeURIComponent('site:tiktok.com ' + term) + '&ia=web', snippet:'TikTok pages found through DuckDuckGo.'},
      {title:'TikTok search: ' + term, url:'https://www.tiktok.com/search?q=' + encodeURIComponent(term), snippet:'TikTok search page. TikTok may block full proxy embedding.'},
      {title:'TikTok hashtag: ' + term.replace(/\s+/g,''), url:'https://www.tiktok.com/tag/' + encodeURIComponent(term.replace(/\s+/g,'')), snippet:'TikTok hashtag page.'}
    ]});
  }

  const limit=Math.min(parseInt(req.query.limit||'14',10)||14,20);
  if(!q) return res.status(200).json({query:q,results:[],source:'DuckDuckGo',message:'Missing q'});

  let results=[], error='', source='';

  if(engine==='all'){
    const engines=['ddg','bing','google'];
    const settled=await Promise.allSettled(engines.map(e=>searchEngine(e, duckQueryFor(q), limit)));
    const lists=[]; const errors=[];
    settled.forEach((s,i)=>{
      if(s.status==='fulfilled' && s.value.length) lists.push(s.value);
      else if(s.status==='rejected') errors.push(engines[i]+': '+(s.reason?.message||'failed'));
    });
    results=interleave(lists);
    if(!results.length){ error=errors.join(' | ')||'All engines failed'; results=fallbackLinks(q); source='Fallback links'; }
    else { if(errors.length) error=errors.join(' | '); source='DuckDuckGo + Bing + Google'; }
  } else if(engine==='bing' || engine==='google'){
    try{ results=await searchEngine(engine, duckQueryFor(q), limit); source= engine==='bing'?'Bing':'Google'; }
    catch(e){ error=e?.message||(engine+' failed'); results=fallbackLinks(q); source='Fallback links'; }
  } else {
    // Default 'ddg' engine now auto-cascades to Bing then Google if DuckDuckGo
    // itself comes back empty or blocked, so a plain search almost always
    // returns something real instead of the "no results loaded" fallback.
    const outcome = await cascadeSearch(duckQueryFor(q), limit);
    results = outcome.results.length ? outcome.results : fallbackLinks(q);
    source = outcome.results.length ? outcome.source : 'Fallback links';
    error = outcome.error;
  }

  // Add TikTok quick results when the user searches TikTok.
  results=[...tiktokQuickResults(q), ...results].filter((r,i,a)=>a.findIndex(x=>x.url===r.url)===i);
  // Absolute guarantee: no archive.org search results in general Browser search.
  results=results.filter(r=>!String(r.url||'').includes('archive.org')).slice(0,limit);
  res.status(200).json({query:q,results,source,error,engine});
}
