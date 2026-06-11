// リクエスト読込・入力検証の共通ユーティリティ
// (openai-image / gemini-image / pickaxe-proxy / log-* / upload-character-image で共用)
const dns = require('dns').promises;
const net = require('net');

// テキスト系エンドポイントの body 上限。プロンプト+メタデータで十分な余裕を持たせる。
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
// プロンプト1本の上限文字数。カルーセル用の長文プロンプトでも 1万字には収まらない想定。
const MAX_PROMPT_CHARS = 20_000;

// 参照画像として受け入れる MIME タイプ
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// body を JSON として読む。content-length / 実受信量が maxBytes を超えたら null。
// (呼び出し側は null → 400 invalid_input で応答する)
async function readJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (req.body.length > maxBytes) return null;
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const declared = parseInt(req.headers['content-length'], 10);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  return new Promise((resolve) => {
    let buf = '';
    let overflow = false;
    req.on('data', chunk => {
      if (overflow) return;
      buf += chunk;
      if (buf.length > maxBytes) {
        overflow = true;
        buf = '';
      }
    });
    req.on('end', () => {
      if (overflow) return resolve(null);
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// プライベート/ループバック/リンクローカル/メタデータ系 IP かどうか
function isPrivateAddress(addr) {
  if (net.isIPv4(addr)) {
    const o = addr.split('.').map(Number);
    if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true;
    if (o[0] === 169 && o[1] === 254) return true;            // link-local / cloud metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    if (o[0] >= 240) return true; // 240.0.0.0/4 (予約) + 255.255.255.255
    return false;
  }
  const lower = addr.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7)); // IPv4-mapped
  return false;
}

// 参照画像 URL として安全か (SSRF 対策)。
// https のみ・既知ポートのみ・解決先がグローバル IP のときだけ true。
async function isSafeRefImageUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return !isPrivateAddress(host);
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) return false;
    return records.every(r => !isPrivateAddress(r.address));
  } catch {
    return false;
  }
}

// upstream から返ってきた content-type を安全な画像 MIME に正規化する
function sanitizeImageMime(contentType, fallback = 'image/png') {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_IMAGE_MIME.has(mime) ? mime : fallback;
}

module.exports = {
  readJsonBody,
  isSafeRefImageUrl,
  sanitizeImageMime,
  MAX_PROMPT_CHARS,
  DEFAULT_MAX_BODY_BYTES,
  ALLOWED_IMAGE_MIME
};
