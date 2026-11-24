// Token-only authentication: FAIRDOC accepts the user's O365/Entra token as passed
// along by ANY host app (no per-app registration). Every request is validated:
//   1. signature against the tenant JWKS     3. not expired / not before
//   2. issuer == our tenant                  4. optional app allowlist (azp)
// Identity, roles and group membership come ONLY from the token's claims (oid, upn,
// roles, groups) — no Microsoft Graph lookups. The optional X-FairDoc-Group header
// is verified against the token's groups claim.
import crypto from 'node:crypto';

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createAuthenticator({ getJwks, issuer, allowedApps = null, adminRole = 'FairDoc.Admin', clockSkew = 60 }) {
  const keyCache = new Map();
  function keyFor(kid) {
    if (!keyCache.has(kid)) {
      const jwk = getJwks().keys.find((k) => k.kid === kid);
      if (!jwk) throw new AuthError(401, 'Unknown signing key');
      keyCache.set(kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
    return keyCache.get(kid);
  }

  function verify(token) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new AuthError(401, 'Malformed token');
    let header, payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch { throw new AuthError(401, 'Malformed token'); }
    // Microsoft Graph access tokens carry a "nonce" header and cannot be verified by
    // third parties. The institution does not issue Graph tokens to apps, so reject.
    if (header.nonce) throw new AuthError(401, 'Graph-audience tokens are not accepted');
    if (header.alg !== 'RS256') throw new AuthError(401, 'Unsupported alg');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), keyFor(header.kid), Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new AuthError(401, 'Bad signature');
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== issuer) throw new AuthError(401, 'Wrong issuer (not our tenant)');
    if (payload.exp + clockSkew < now) throw new AuthError(401, 'Token expired');
    if (payload.nbf && payload.nbf - clockSkew > now) throw new AuthError(401, 'Token not yet valid');
    const app = payload.azp || payload.appid || payload.aud;
    if (allowedApps && !allowedApps.includes(app)) throw new AuthError(403, `App ${app} not on allowlist`);
    return payload;
  }

  return function authenticate(req) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new AuthError(401, 'Missing bearer token');
    const claims = verify(h.slice(7).trim());
    const groups = claims.groups || [];
    const roles = claims.roles || [];
    const requestedGroup = req.headers['x-fairdoc-group'] || null;
    if (requestedGroup && !groups.includes(requestedGroup)) {
      throw new AuthError(403, 'User is not a member of the requested group');
    }
    return {
      oid: claims.oid, upn: claims.preferred_username, name: claims.name,
      groups, roles, isAdmin: roles.includes(adminRole),
      app: claims.azp || claims.appid || claims.aud, group: requestedGroup,
    };
  };
}
