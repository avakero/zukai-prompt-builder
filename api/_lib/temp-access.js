// Temporary public Pro Max access for the /pro-max route.
// Remove this helper and the X-Temporary-Pro-Max-Access client headers when the campaign ends.
const { authenticateFromAuthorizationHeader, VerificationError } = require('./line');

const TEMP_PRO_MAX_HEADER = 'x-temporary-pro-max-access';
const TEMP_PRO_MAX_LINE_USER_ID = 'Utemp-pro-max-open-access';

function hasTemporaryProMaxAccess(req) {
  if (process.env.DISABLE_TEMP_PRO_MAX_ACCESS === '1') return false;
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
