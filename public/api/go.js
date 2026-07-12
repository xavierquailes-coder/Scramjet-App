// MiiCore GO route - URLs open through proxy, searches open the in-site DuckDuckGo results page.
function isUrlish(input){
  return /^https?:\/\//i.test(input) || (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(input) && !/\s/.test(input));
}
function targetFor(q){
  q=String(q||'').trim();
  if(!q) return '/api/ddg';
  if(/^https?:\/\//i.test(q)) return '/api/web?url=' + encodeURIComponent(q);
  if(isUrlish(q)) return '/api/web?url=' + encodeURIComponent('https://' + q);
  return '/api/ddg?q=' + encodeURIComponent(q);
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  const q=String(req.query.q||req.query.url||'');
  res.writeHead(302,{Location:targetFor(q)});
  res.end();
}
