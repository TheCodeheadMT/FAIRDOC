// Mock Entra ID (O365) identity provider — DEMO ONLY.
// Issues RS256-signed JWTs shaped like real Entra v2.0 tokens and publishes a JWKS,
// so the FAIRDOC server can validate tokens exactly as it would against
// https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys in production.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TENANT_ID = '00000000-demo-4fa1-8d0c-000000000001';
export const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

export const GROUPS = {
  'a1b2c3d4-0001-4000-8000-bio101000001': 'BIO 101 – Fall 2026',
  'a1b2c3d4-0002-4000-8000-genomicslab1': 'Genomics Research Lab',
  'a1b2c3d4-0003-4000-8000-advising0001': 'Student Advising Office',
  'a1b2c3d4-0004-4000-8000-curriculum01': 'Curriculum Committee',
};
const G = Object.keys(GROUPS);

export const USERS = {
  'u-0001-srivera': { name: 'Sam Rivera', upn: 'srivera@demo.edu', kind: 'Student', groups: [G[0]], roles: [] },
  'u-0002-achen': { name: 'Alex Chen', upn: 'achen@demo.edu', kind: 'Student', groups: [G[0], G[1]], roles: [] },
  'u-0003-okafor': { name: 'Dr. Jordan Okafor', upn: 'jokafor@demo.edu', kind: 'Faculty', groups: [G[0], G[1], G[2], G[3]], roles: ['FairDoc.Faculty'] },
  'u-0004-admin': { name: 'Pat Morgan (IT Admin)', upn: 'pmorgan@demo.edu', kind: 'Staff', groups: [G[2], G[3]], roles: ['FairDoc.Admin'] },
};

let keyPair;
let kid;
export function initKeys(dataDir) {
  const file = path.join(dataDir, 'mock-entra-key.pem');
  if (fs.existsSync(file)) {
    const priv = crypto.createPrivateKey(fs.readFileSync(file));
    keyPair = { privateKey: priv, publicKey: crypto.createPublicKey(priv) };
  } else {
    keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  }
  kid = crypto.createHash('sha256').update(keyPair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

export function jwks() {
  return { keys: [{ ...keyPair.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] };
}

const b64u = (b) => Buffer.from(b).toString('base64url');

// clientId = the host app's own Entra app id. FAIRDOC never needs it registered;
// it only reads it from the token (azp) for audit attribution.
export function issueToken({ userId, clientId, ttlSeconds = 3600 }) {
  const u = USERS[userId];
  if (!u) throw new Error('unknown user');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = {
    iss: ISSUER, tid: TENANT_ID, aud: clientId, azp: clientId,
    iat: now, nbf: now, exp: now + ttlSeconds,
    oid: userId, sub: userId, name: u.name, preferred_username: u.upn,
    groups: u.groups, roles: u.roles, ver: '2.0',
  };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), keyPair.privateKey);
  return `${input}.${b64u(sig)}`;
}

export function publicUsers() {
  return Object.entries(USERS).map(([id, u]) => ({ id, name: u.name, upn: u.upn, kind: u.kind, roles: u.roles, groups: u.groups.map((g) => ({ id: g, name: GROUPS[g] })) }));
}
