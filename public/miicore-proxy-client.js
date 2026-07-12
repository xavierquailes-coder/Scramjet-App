// Optional helper for any MiiCore page/app.
// Include with: <script src="miicore-proxy-client.js"></script>
window.MiiCoreProxy = {
  go(query){
    return `/api/go?q=${encodeURIComponent(query || '')}`;
  },
  web(url){
    return `/api/web?url=${encodeURIComponent(url || '')}`;
  },

  // engine: 'ddg' (default, auto-cascades to Bing/Google if DDG is blocked) | 'bing' | 'google' | 'all' (merges all three)
  search(q, limit = 12, engine = 'ddg') {
    return fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=' + encodeURIComponent(limit) + '&engine=' + encodeURIComponent(engine)).then(r => r.json());
  },
  searchAll(q, limit = 12) {
    return this.search(q, limit, 'all');
  },
  fetchText(url) {
    return fetch('/api/proxy?url=' + encodeURIComponent(url)).then(r => r.text());
  },
  fetchJson(url) {
    return fetch('/api/proxy?url=' + encodeURIComponent(url)).then(r => r.json());
  },
  proxyUrl(url) {
    return '/api/proxy?url=' + encodeURIComponent(url);
  }
};
