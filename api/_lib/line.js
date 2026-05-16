// LIFF access token をサーバー側で検証して LINE userId を取得する。
//
// フロー:
//   1) /oauth2/v2.1/verify で token の有効性と client_id (= LINEログインチャネルID) を確認
//   2) /v2/profile で userId を取得 (verify 単体では userId は返らない)
//
// 戻り値: { lineUserId, clientId, expiresIn }
// エラー時: VerificationError を throw (code に "invalid_token" / "expired_token" / "audience_mismatch" / "upstream_timeout" / "upstream_error")

const VERIFY_URL  = 'https://api.line.me/oauth2/v2.1/verify';
const PROFILE_URL = 'https://api.line.me/v2/profile';
const UPSTREAM_TIMEOUT_MS = 5000;

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

async function authenticateFromAuthorizationHeader(authorizationHeader) {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new VerificationError('invalid_token', 'Missing Bearer token', 401);
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
  verifyAccessToken,
  fetchProfile
};
