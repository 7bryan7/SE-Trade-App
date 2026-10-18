import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
export type GoogleUser = { id: string; name: string; email: string; expiresAt: number };
export const AUTH_SESSION_KEY = 'tradesense.google.session.v1';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
// Signature validation also applies when restoring the tab's session. Merely decoding a JWT is insufficient.
export async function verifyGoogleCredential(credential: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<GoogleUser> {
  if (!clientId || !nonce) throw new Error('Google sign-in configuration is missing.');
  const { payload } = await jwtVerify(credential, keys, {
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
  });
  if (payload.nonce !== nonce || (payload.azp !== undefined && payload.azp !== clientId) || !payload.sub || payload.sub.length > 255 || !payload.exp || (payload.iat ?? Infinity) > Date.now() / 1000 + 60) throw new Error('Invalid Google sign-in response.');
  return {
    id: payload.sub,
    name: typeof payload.name === 'string' && payload.name ? payload.name : 'Google user',
    email: typeof payload.email === 'string' ? payload.email : '',
    expiresAt: payload.exp * 1000,
  };
}
