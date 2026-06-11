// Temporary public Pro Max access for the /pro-max route.
// Remove this helper and the X-Temporary-Pro-Max-Access client headers when the campaign ends.
//
// オプトイン方式: ENABLE_TEMP_PRO_MAX_ACCESS=1 が明示的に設定されている環境でのみ有効。
// 未設定なら認証バイパスは常に無効 (キャンペーン継続中は Vercel 側でこの env var を設定すること)。
const { authenticateFromAuthorizationHeader, VerificationError } = require('./line');

const TEMP_PRO_MAX_HEADER = 'x-temporary-pro-max-access';
const TEMP_PRO_MAX_LINE_USER_ID = 'Utemp-pro-max-open-access';

function hasTemporaryProMaxAccess(req) {
  if (process.env.ENABLE_TEMP_PRO_MAX_ACCESS !== '1') return false;
  const value = req && req.headers ? req.headers[TEMP_PRO_MAX_HEADER] : null;
  return value === '1' || value === 'true';
}

async function authenticateWithTemporaryProMax(req) {
  try {
    return await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError && hasTemporaryProMaxAccess(req)) {
      return {
        lineUserId: TEMP_PRO_MAX_LINE_USER_ID,
        clientId: 'temporary-pro-max',
        expiresIn: null,
        temporary: true
      };
    }
    throw e;
  }
}

module.exports = {
  authenticateWithTemporaryProMax,
  hasTemporaryProMaxAccess,
  TEMP_PRO_MAX_LINE_USER_ID
};
