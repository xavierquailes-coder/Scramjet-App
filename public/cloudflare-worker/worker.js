// SquiddCore Search Proxy - Cloudflare Worker
//
// This Worker's ONLY job is to fetch a URL server-side (from Cloudflare's IPs
// instead of Vercel's) and hand the raw response back to your Vercel API
// routes (api/ddg.js, api/bing.js, api/google.js, api/web.js, etc).
// This is what lets you scrape DuckDuckGo/Bing/Google HTML without getting
// instantly blocked, since Vercel's serverless IP ranges are heavily
// rate-limited by the big search engines.
//
// Usage:  https://YOUR-WORKER.workers.dev/?url=https%3A%2F%2Fwww.bing.com%2Fsearch%3Fq%3Dcats
//
// Deploy:
//   1. npm install -g wrangler          (if you don't have it)
//   2. wrangler login
//   3. cd cloudflare-worker
//   4. wrangler deploy
//
// Then update WORKER_URL at the top of api/ddg.js, api/bing.js, api/google.js
// and api/search.js to match whatever URL wrangler prints out (this project
// is currently pointed at https://proxytesting.xavierquailes.workers.dev).

const ALLOWED_ORIGIN = '*'; // tighten this to your Vercel domain if you want
const TIMEOUT_MS = 15000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB cap

// Basic SSRF guard: block obviously-private/loopback/link-local hosts.
// (Workers can't do a real DNS-rebind-safe check the way Node's dns.lookup
// can, so this is a best-effort string/IP-literal check, not a hard guarantee.)
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '0.0.0.0' || h === '::1') return true;
  // IPv4 literal checks
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }
  return false;
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    ...extra,
  };
}

// Rotating desktop user-agents so DDG/Bing/Google see normal-looking traffic.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return new Response('GET only', { status: 405, headers: corsHeaders() });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      // Visiting the bare worker URL (no ?url=) with nothing else means someone
      // is just checking whether the Worker is alive. Give a friendly signal
      // instead of a bare error, so you can confirm deployment by just
      // opening https://YOUR-WORKER.workers.dev/ in a browser tab.
      return new Response(JSON.stringify({
        ok: true,
        message: 'SquiddCore proxy worker is running. Use ?url=https://example.com to fetch through it.',
        time: new Date().toISOString(),
      }, null, 2), {
        status: 200,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response('Invalid url', { status: 400, headers: corsHeaders() });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new Response('Only http/https allowed', { status: 400, headers: corsHeaders() });
    }
    if (isBlockedHost(parsed.hostname)) {
      return new Response('Blocked host', { status: 400, headers: corsHeaders() });
    }

    // Forward a couple of useful headers from the caller (e.g. accept) but
    // always set our own user-agent/accept-language so it looks like a
    // normal browser request instead of a bot.
    const acceptHeader = request.headers.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': pickUA(),
          'accept': acceptHeader,
          'accept-language': 'en-US,en;q=0.9',
        },
        cf: {
          // Don't let Cloudflare's edge cache stale search results too long.
          cacheTtl: 60,
          cacheEverything: false,
        },
      });
    } catch (err) {
      return new Response('Upstream fetch failed: ' + (err && err.message ? err.message : String(err)), {
        status: 502,
        headers: corsHeaders(),
      });
    }

    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > MAX_BYTES) {
      return new Response('Upstream response too large', { status: 413, headers: corsHeaders() });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return new Response('Upstream response too large', { status: 413, headers: corsHeaders() });
    }

    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    return new Response(buf, {
      status: upstream.status,
      headers: corsHeaders({
        'Content-Type': contentType,
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      }),
    });
  },
};
