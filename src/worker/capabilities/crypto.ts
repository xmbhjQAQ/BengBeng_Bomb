const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
export function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export const decodeText = (value: string) => decoder.decode(base64UrlDecode(value));
async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}
export async function sign(secret: string, domain: string, value: string) { return base64UrlEncode(await hmac(secret, `${domain}\0${value}`)); }
export async function verify(secret: string, domain: string, value: string, signature: string) {
  let actual: Uint8Array; try { actual = base64UrlDecode(signature); } catch { return false; }
  const expected = await hmac(secret, `${domain}\0${value}`);
  if (actual.length !== expected.length) return false;
  let difference = 0; for (let index = 0; index < actual.length; index += 1) difference |= actual[index]! ^ expected[index]!;
  return difference === 0;
}
export async function sha256(value: string) { return base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
export function randomToken(bytes = 24) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return base64UrlEncode(value); }
