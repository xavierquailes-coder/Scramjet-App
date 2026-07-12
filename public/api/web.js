// MiiCore Web Proxy Browser - Vercel API route
// Usage: /api/web?url=https%3A%2F%2Fexample.com
// This is a general PUBLIC WEB proxy for browsing/searching from MiiCore.
// It blocks localhost/private networks and rewrites normal HTML links/assets back through the proxy.

import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 18000;

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Accept');
}
function isPrivateIp(ip){
  if(!ip) return true;
  if(ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if(ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if(ip.includes(':')) return false;
  const p=ip.split('.').map(Number);
  if(p.length!==4 || p.some(n=>Number.isNaN(n))) return true;
  const [a,b]=p;
  return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || a>=224;
}
async function validatePublicUrl(raw){
  if(!raw || String(raw).length>3500) throw new Error('Missing or too long url');
  let u; try{u=new URL(raw)}catch{throw new Error('Invalid url')}
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Only http/https allowed');
  if(u.username || u.password) throw new Error('Username/password URLs are blocked');
  const host=u.hostname.toLowerCase();
  if(host==='localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local/private hosts are blocked');
  if(net.isIP(host)){ if(isPrivateIp(host)) throw new Error('Private IPs are blocked'); }
  else{
    const rec=await dns.lookup(host,{all:true,verbatim:true});
    if(!rec.length || rec.some(r=>isPrivateIp(r.address))) throw new Error('Private network targets are blocked');
  }
  return u;
}
function proxify(url){ return '/api/web?url=' + encodeURIComponent(url); }
function resolveUrl(value, base){
  if(!value) return value;
  const v=String(value).trim();
  if(!v || v.startsWith('#') || v.startsWith('data:') || v.startsWith('blob:') || v.startsWith('mailto:') || v.startsWith('tel:') || v.startsWith('javascript:')) return v;
  try{return new URL(v, base).toString();}catch{return v;}
}
function rewriteSrcset(srcset, base){
  return String(srcset).split(',').map(part=>{
    const bits=part.trim().split(/\s+/);
    if(!bits[0]) return part;
    const full=resolveUrl(bits[0], base);
    if(/^https?:\/\//i.test(full)) bits[0]=proxify(full);
    return bits.join(' ');
  }).join(', ');
}
function rewriteHtml(html, baseUrl){
  const base=baseUrl.toString();
  let out=html;
  // Make forms submit back through the proxy where possible.
  out=out.replace(/<head(\s[^>]*)?>/i, m => `${m}<base href="${base}"><script>window.__MIICORE_PROXY_BASE=${JSON.stringify(base)};</script>`);
  out=out.replace(/\s(href|src|poster|action)=(['"])(.*?)\2/gi, (m, attr, q, val)=>{
    const full=resolveUrl(val, base);
    if(/^https?:\/\//i.test(full)) return ` ${attr}=${q}${proxify(full)}${q}`;
    return m;
  });
  out=out.replace(/\s(srcset)=(['"])(.*?)\2/gi, (m, attr, q, val)=>` ${attr}=${q}${rewriteSrcset(val, base)}${q}`);
  // MiiCore no-new-tab patch: keep target=_blank links inside the same proxy frame.
  out=out.replace(/\s(target)=(['"])(_blank|blank|new)\2/gi, ' target=\"_self\"');
  // Tiny client helper: catch normal link clicks/forms that were missed and keep them inside proxy.
  const patch = `<script>(function(){try{window.open=function(u){ if(u){ location.href=p(u); } return null; };}catch(e){} function p(u){try{var x=new URL(u, window.__MIICORE_PROXY_BASE||location.href); if(/^https?:$/.test(x.protocol)) return '/api/web?url='+encodeURIComponent(x.href);}catch(e){} return u;} document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]'); if(!a) return; var h=a.getAttribute('href'); if(!h||h[0]==='#'||h.startsWith('/api/web')) return; var n=p(h); if(n!==h){e.preventDefault(); location.href=n;}},true); document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.action) return; var method=(f.method||'get').toLowerCase(); if(method!=='get') return; e.preventDefault(); var u=new URL(f.action, window.__MIICORE_PROXY_BASE||location.href); new FormData(f).forEach(function(v,k){u.searchParams.set(k,v)}); location.href=p(u.href);},true);})();</script>`;
  if(/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, patch + '</body>');
  else if(/<\/html>/i.test(out)) out = out.replace(/<\/html>/i, patch + '</html>');
  else out += patch;
  return out;
}
export default async function handler(req,res){
  cors(res); if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  try{
    const target=await validatePublicUrl(req.query.url||'');

    const upstream=await fetch(target.toString(),{
      redirect:'follow', signal:AbortSignal.timeout(TIMEOUT_MS),
      headers:{'user-agent':'Mozilla/5.0 (MiiCore Web Proxy)','accept':req.headers.accept||'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}
    });
    await validatePublicUrl(upstream.url||target.toString());
    const type=upstream.headers.get('content-type')||'application/octet-stream';
    const len=Number(upstream.headers.get('content-length')||0);
    if(len>MAX_BYTES) return res.status(413).send('MiiCore proxy: file too large');
    const buf=Buffer.from(await upstream.arrayBuffer());
    if(buf.length>MAX_BYTES) return res.status(413).send('MiiCore proxy: file too large');
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=1800');
    res.setHeader('X-Frame-Options','ALLOWALL');
    if(type.includes('text/html')){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.status(upstream.status).send(rewriteHtml(buf.toString('utf8'), new URL(upstream.url||target.toString())));
    }else{
      res.setHeader('Content-Type',type);
      res.status(upstream.status).send(buf);
    }
  }catch(err){
    res.status(400).send(`<!doctype html><html><body style="background:#050505;color:white;font-family:Arial;padding:30px"><h2>MiiCore proxy could not open that.</h2><p>${String(err?.message||'Proxy failed').replace(/[<>]/g,'')}</p><p>Try a different site or search term.</p></body></html>`);
  }
}
