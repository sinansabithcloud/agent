const CacheManager = require('./cache');

// Single-active-session enforcement.
//
// The current valid access-token version for each user is stored in the SHARED
// Redis (REDIS_URL) so every service's auth middleware can reject access tokens
// minted before the user's latest login — i.e. sign the user out everywhere the
// moment they log in on another device.
//
// Fail-open: if Redis is unavailable we skip the check rather than lock users
// out. A dedicated lazy client is used so this works in every service whether or
// not it wires a CacheManager elsewhere.
const key = (userId) => `auth:tv:${userId}`;
const TTL_SECONDS = parseInt(process.env.SESSION_VERSION_TTL_SECONDS, 10) || 8 * 24 * 3600;

let store;
function client() {
  if (store === undefined) {
    store = process.env.REDIS_URL ? new CacheManager(process.env.REDIS_URL) : null;
    if (store) {
      store.connect().catch(() => {});
    }
  }
  return store;
}

// Current valid token version for a user, or null when unknown/unavailable.
async function getSessionVersion(userId) {
  const cache = client();
  if (!cache) return null;
  return cache.get(key(userId));
}

// Record the user's current valid token version (called on login / password change).
async function setSessionVersion(userId, version) {
  const cache = client();
  if (!cache) return;
  await cache.set(key(userId), version, TTL_SECONDS);
}

module.exports = { getSessionVersion, setSessionVersion };
