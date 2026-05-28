// LIFF トークンをサーバー側で検証して LINE userId を取得する。
//
// 2系統に対応 (移行期のハイブリッド):
//   A) ID Token (JWT, "eyJ..." 形式)
//      → JWKS でオフライン検証 (LINE API 往復ゼロ)。新しい標準パス。
//   B) Access Token (不透明トークン)
//      → /oauth2/v2.1/verify + /v2/profile の2回直列コール (旧パス)。
//
// クライアントは liff.getIDToken() を使うことを推奨。
// 旧 liff.getAccessToken() も B 経由で引き続き動作するので、ロールアウト時の
// 段階移行が可能。
//
// 戻り値: { lineUserId, clientId, expiresIn }
// エラー時: VerificationError を throw (code に "invalid_token" / "expired_token" / "audience_mismatch" / "upstream_timeout" / "upstream_error")

const VERIFY_URL  = 'https://api.line.me/oauth2/v2.1/verify';
const PROFILE_URL = 'https://api.line.me/v2/profile';
const JWKS_URL    = 'https://api.line.me/oauth2/v2.1/certs';
const ID_TOKEN_ISSUER = 'https://access.line.me';
const UPSTREAM_TIMEOUT_MS = 5000;
const JWT_CLOCK_TOLERANCE_SEC = 30;

class VerificationError extends Error {
  constructor(code, message, httpStatus = 401) {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function getAllowedChannelIds() {
  const raw = process.env.LINE_CHANNEL_IDS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new VerificationError('upstream_timeout', 'LINE API timed out', 502);
    }
    throw new VerificationError('upstream_error', `LINE API fetch failed: ${e.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  const m = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  return m ? m[1] : null;
}

// JWT 形式かを軽く判定 (ID Token は3セグメントの base64url、先頭は "eyJ" でほぼ確定)
function looksLikeJwt(token) {
  return typeof token === 'string' && token.startsWith('eyJ') && token.split('.').length === 3;
}

// ----------------------------------------------------------------
// A) ID Token (JWT) 検証パス — JWKS でオフライン検証
// ----------------------------------------------------------------

// jose は v5 から ESM-only。CommonJS の Vercel 関数からは動的 import で読み込む。
let _josePromise = null;
function getJose() {
  if (!_josePromise) _josePromise = import('jose');
  return _josePromise;
}

// JWKS は jose 内部でキャッシュされる (cacheMaxAge / cooldownDuration)。
// モジュールスコープで1度だけ生成すれば、ウォーム関数では LINE への鍵取得は1回で済む。
let _jwks = null;
async function getJwks() {
  if (_jwks) return _jwks;
  const jose = await getJose();
  _jwks = jose.createRemoteJWKSet(new URL(JWKS_URL), {
    cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
    cooldownDuration: 30 * 1000,      // 30s 内の再 fetch を抑制
    timeoutDuration: UPSTREAM_TIMEOUT_MS
  });
  return _jwks;
}

async function verifyIdToken(token) {
  const allowed = getAllowedChannelIds();
  if (allowed.length === 0) {
    throw new VerificationError('server_misconfigured', 'LINE_CHANNEL_IDS is empty', 500);
  }

  const jose = await getJose();
  const jwks = await getJwks();

  let payload;
  try {
    const result = await jose.jwtVerify(token, jwks, {
      issuer: ID_TOKEN_ISSUER,
      audience: allowed,
      clockTolerance: JWT_CLOCK_TOLERANCE_SEC
    });
    payload = result.payload;
  } catch (e) {
    const code = e && e.code;
    if (code === 'ERR_JWT_EXPIRED') {
      throw new VerificationError('expired_token', 'ID token expired', 401);
    }
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      // aud / iss 不一致など
      throw new VerificationError('audience_mismatch', `Claim validation failed: ${e.claim || ''}`, 401);
    }
    if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'
        || code === 'ERR_JWS_INVALID'
        || code === 'ERR_JWT_INVALID'
        || code === 'ERR_JWKS_NO_MATCHING_KEY') {
      console.warn('[line.verifyIdToken] invalid_token', { code, tokenPrefix: token.slice(0, 12) });
      throw new VerificationError('invalid_token', `ID token validation failed: ${code}`, 401);
    }
    if (code === 'ERR_JWKS_TIMEOUT') {
      throw new VerificationError('upstream_timeout', 'JWKS fetch timed out', 502);
    }
    console.error('[line.verifyIdToken] unexpected error:', e);
    throw new VerificationError('upstream_error', `JWT verify failed: ${e.message}`, 502);
  }

  const sub = payload && payload.sub;
  if (typeof sub !== 'string' || !sub.startsWith('U')) {
    throw new VerificationError('upstream_error', 'ID token sub missing or not a LINE userId', 502);
  }
  const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
  const expiresIn = typeof payload.exp === 'number'
    ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000))
    : null;

  return {
    lineUserId: sub,
    clientId:   String(aud || ''),
    expiresIn
  };
}

// ----------------------------------------------------------------
// B) Access Token 検証パス (旧来) — 移行が完了したら削除可
// ----------------------------------------------------------------

async function verifyAccessToken(token) {
  const allowed = getAllowedChannelIds();
  if (allowed.length === 0) {
    throw new VerificationError('server_misconfigured', 'LINE_CHANNEL_IDS is empty', 500);
  }

  const res = await fetchWithTimeout(`${VERIFY_URL}?access_token=${encodeURIComponent(token)}`);

  if (res.status === 400 || res.status === 401) {
    console.warn('[line.verify] LINE rejected token', { httpStatus: res.status, tokenPrefix: token.slice(0, 8) });
    throw new VerificationError('invalid_token', 'Token rejected by LINE verify', 401);
  }
  if (!res.ok) {
    throw new VerificationError('upstream_error', `LINE verify returned ${res.status}`, 502);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new VerificationError('upstream_error', 'Invalid JSON from LINE verify', 502);
  }

  const { client_id: clientId, expires_in: expiresIn } = payload;

  if (typeof expiresIn !== 'number' || expiresIn <= 0) {
    throw new VerificationError('expired_token', 'Access token has expired', 401);
  }
  if (!clientId || !allowed.includes(String(clientId))) {
    console.warn('[line.verify] audience_mismatch', { actualClientId: clientId, allowed });
    throw new VerificationError('audience_mismatch', 'Token is for a different LINE channel', 401);
  }

  return { clientId: String(clientId), expiresIn };
}

async function fetchProfile(token) {
  const res = await fetchWithTimeout(PROFILE_URL, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (res.status === 401) {
    throw new VerificationError('invalid_token', 'Profile request rejected', 401);
  }
  if (!res.ok) {
    throw new VerificationError('upstream_error', `LINE profile returned ${res.status}`, 502);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new VerificationError('upstream_error', 'Invalid JSON from LINE profile', 502);
  }

  if (!payload || typeof payload.userId !== 'string' || !payload.userId.startsWith('U')) {
    throw new VerificationError('upstream_error', 'Profile response missing userId', 502);
  }
  return { lineUserId: payload.userId };
}

// ----------------------------------------------------------------
// 公開 API: 形式を見て A/B どちらかにディスパッチ
// ----------------------------------------------------------------

async function authenticateFromAuthorizationHeader(authorizationHeader) {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new VerificationError('invalid_token', 'Missing Bearer token', 401);
  }
  if (looksLikeJwt(token)) {
    return await verifyIdToken(token);
  }
  const { clientId, expiresIn } = await verifyAccessToken(token);
  const { lineUserId } = await fetchProfile(token);
  return { lineUserId, clientId, expiresIn };
}

module.exports = {
  VerificationError,
  authenticateFromAuthorizationHeader,
  // exported for unit tests
  extractBearerToken,
  looksLikeJwt,
  verifyAccessToken,
  verifyIdToken,
  fetchProfile
};
