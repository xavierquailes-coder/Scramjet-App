// MiiCore General Proxy - Vercel API route
// Usage: /api/proxy?url=https%3A%2F%2Fexample.com%2Fdata.json
// GET-only. Blocks localhost/private IPs so it cannot be used to hit private networks.

import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap so the proxy does not crash on huge files
const TIMEOUT_MS = 15000;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if (ip.includes(':')) return false; // other IPv6 public-ish addresses
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function validatePublicUrl(raw) {
  if (!raw || String(raw).length > 2500) throw new Error('Missing or too long url');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid url'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are allowed');
  if (url.username || url.password) throw new Error('URLs with usernames/passwords are blocked');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local/private hosts are blocked');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private IPs are blocked');
  } else {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(r => isPrivateIp(r.address))) throw new Error('Private network targets are blocked');
  }
  return url;
}

function copyHeaders(upstreamHeaders, res) {
  const contentType = upstreamHeaders.get('content-type') || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  const length = upstreamHeaders.get('content-length');
  if (length && Number(length) <= MAX_BYTES) res.setHeader('Content-Length', length);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const target = await validatePublicUrl(req.query.url || '');
    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'MiiCoreGeneralProxy/1.0',
        'accept': req.headers.accept || '*/*'
      }
    });

    // Re-check final URL after redirects.
    await validatePublicUrl(upstream.url || target.toString());

    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) {
      return res.status(413).json({ error: 'Response too large for proxy', maxBytes: MAX_BYTES });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Response too large for proxy', maxBytes: MAX_BYTES });
    }

    copyHeaders(upstream.headers, res);
    res.status(upstream.status).send(buffer);
  } catch (err) {
    res.status(400).json({ error: err?.message || 'Proxy failed' });
  }
}
