import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyGoogleCredential } from '../src/auth.ts';
import { createAccountStore } from '../src/account-store.ts';
import { emptyAccount, fund, openPosition } from '../src/engine.ts';
// Synthetic identities/keys are test fixtures only, never a runtime sign-in bypass.
const client = 'test-client.apps.googleusercontent.com';
const nonce = 'test-nonce';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.kid = 'test-key';
const keys = createLocalJWKSet({ keys: [jwk] });
async function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({ sub:'google-user-a', name:'Test user', email:'test@example.test', nonce, ...claims })
    .setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://accounts.google.com').setAudience(client).setIssuedAt().setExpirationTime('1h').sign(privateKey);
}
test('valid signed credential returns stable Google subject and profile', async () => {
  const user = await verifyGoogleCredential(await token(),client,nonce,keys);
  assert.equal(user.id,'google-user-a'); assert.equal(user.email,'test@example.test');assert.ok(user.expiresAt>Date.now());
});
test('wrong client, nonce, authorized party, and missing config are rejected', async () => {
  const signed = await token();
  await assert.rejects(verifyGoogleCredential(signed,'other-client',nonce,keys));
  await assert.rejects(verifyGoogleCredential(signed,client,'other-nonce',keys));
  await assert.rejects(verifyGoogleCredential(await token({azp:'other-client'}),client,nonce,keys));
  await assert.rejects(verifyGoogleCredential(signed,'',nonce,keys));
});
test('expired, wrong issuer, and future-issued credentials are rejected', async () => {
  const sign = (issuer: string, expiration: number) => new SignJWT({sub:'user-a',nonce}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(issuer).setAudience(client).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  await assert.rejects(verifyGoogleCredential(await sign('https://accounts.google.com',Math.floor(Date.now()/1000)-1),client,nonce,keys));
  await assert.rejects(verifyGoogleCredential(await sign('https://untrusted.example',Math.floor(Date.now()/1000)+3600),client,nonce,keys));
  const future = await new SignJWT({sub:'user-a',nonce}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://accounts.google.com').setAudience(client).setIssuedAt(Math.floor(Date.now()/1000)+3600).setExpirationTime('2h').sign(privateKey);
  await assert.rejects(verifyGoogleCredential(future,client,nonce,keys));
});
test('forged signature and unsigned credentials are rejected', async () => {
  const other = await generateKeyPair('RS256');
  const forged = await new SignJWT({sub:'user-a',nonce}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://accounts.google.com').setAudience(client).setIssuedAt().setExpirationTime('1h').sign(other.privateKey);
  await assert.rejects(verifyGoogleCredential(forged,client,nonce,keys));
  await assert.rejects(verifyGoogleCredential('eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.',client,nonce,keys));
});
function storage() {const values = new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
test('Google users have separate persistent balances, positions, and history', () => {
  const s=storage(), a=createAccountStore('user-a',s), b=createAccountStore('user-b',s);
  a.write(openPosition(fund(emptyAccount(),1000),'USD/JPY','buy',100,{date:'2026-10-18',rates:{USD:1,JPY:100}})); b.write(fund(emptyAccount(),250));
  assert.notEqual(a.key,b.key);assert.equal(a.read().cash,900);assert.equal(b.read().cash,250);assert.equal(a.read().positions.length,1);assert.equal(b.read().positions.length,0);
  assert.equal(createAccountStore('user-a',s).read().events.length,2);assert.equal(b.read().events.length,1);
  a.clear();assert.equal(a.read().cash,0);assert.equal(b.read().cash,250);
});
test('legacy shared account is never assigned to a signed-in user', () => {
  const s=storage();s.setItem('tradesense.paper.v1',JSON.stringify(fund(emptyAccount(),9999)));
  const a=createAccountStore('user-a',s);assert.deepEqual(a.read(),emptyAccount());
  a.clear();assert.ok(s.getItem('tradesense.paper.v1'));
});
test('user keys cannot collide through special characters or empty subjects', () => {
  const s=storage();assert.notEqual(createAccountStore('a/b',s).key,createAccountStore('a%2Fb',s).key);
  assert.throws(()=>createAccountStore('',s));
});
test('one user’s corrupt data does not affect another user', () => {
  const s=storage(),a=createAccountStore('user-a',s),b=createAccountStore('user-b',s);
  s.setItem(a.key,'invalid');b.write(fund(emptyAccount(),250));
  assert.throws(()=>a.read());assert.equal(b.read().cash,250);
});
