import type { ApiEnvelope } from '../../shared/contracts';

export class ApiClientError extends Error { constructor(public readonly code: string, message: string) { super(message); } }
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...(options.body ? {'Content-Type':'application/json'}:{}), ...options.headers } });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!envelope.ok) throw new ApiClientError(envelope.error.code,envelope.error.message);
  return envelope.data;
}
export const post = <T>(path:string,body:unknown,token?:string) => apiRequest<T>(path,{method:'POST',body:JSON.stringify(body),headers:token?{Authorization:`Bearer ${token}`}:{}});
