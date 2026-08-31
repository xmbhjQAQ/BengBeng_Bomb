import type { ApiEnvelope } from '../../shared/contracts';

export class ApiClientError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

const friendlyMessages: Record<string, string> = {
  INVALID_TOKEN: '这个挑战链接无效，请重新打开或让发起者重新生成。',
  TOKEN_EXPIRED: '这个挑战链接已失效，请让发起者重新生成。',
  INVALID_MANAGE_TOKEN: '私密结果入口无效或已失效，请使用保存的入口。',
  INVALID_REPORT_TOKEN: '这条公开战报已失效或无法打开。',
  INVALID_VIDEO: '视频信息暂时无法读取，请重新选择视频。',
  INVALID_SCORE_TRACE: '本次结果的变化记录暂时无法读取，请稍后重试。',
  SCORE_TRACE_TOO_LARGE: '本次结果记录过长，暂时无法读取。',
  INVALID_ATTEMPT: '本轮挑战已经失效，请重新开始。',
  INVALID_GROUP_TOKEN: '这个群组挑战链接无效，请重新打开邀请链接。',
  INVALID_GROUP_ENTRY_TOKEN: '这个群组入口链接无效，请重新获取分享链接。',
  INVALID_GROUP_RESULT_TOKEN: '群组结果链接无效或已失效，请重新获取结果链接。',
  INVALID_GROUP_MANAGE_TOKEN: '群组管理入口无效或已失效，请使用发起时保存的入口。',
  GROUP_NOT_FOUND: '这个群组挑战已经结束或不存在。',
  GROUP_ENDED: '这个群组挑战已经结束，暂时不能继续参与。',
  GROUP_EXPIRED: '这个群组挑战已到期，暂时不能继续参与。',
  INVALID_GROUP_ATTEMPT: '本轮参与记录已经失效，请重新进入群组挑战。',
  GROUP_COMPLETE_CONFLICT: '结果正在保存，请刷新结果页确认。',
  GROUP_START_CONFLICT: '暂时无法开始这次挑战，请稍后重试。',
  MISSING_AUTHORIZATION: '私密结果入口不完整，请使用保存的链接。',
  NOT_FOUND: '页面不存在或已失效。',
  INVALID_JSON: '请求内容有误，请稍后重试。',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试。',
};

function userMessage(code: string, message: string, path: string): string {
  const known = friendlyMessages[code];
  if (known) return known;
  // Keep endpoint/identifier terminology out of the ordinary UI while
  // retaining the server's more specific copy for other validation errors.
  if (/凭证|B站|BV|CID|分P|报告|接口/.test(message)) {
    if (path.includes('/bilibili/parse')) return '请粘贴有效的 B 站视频页面地址。';
    if (path.includes('/reports/resolve')) return '这条公开战报已失效或无法打开。';
    if (path.includes('/manage')) return '私密结果入口无效或已失效，请使用保存的入口。';
    return '请求信息不完整，请重新操作。';
  }
  return message || '请求没有成功，请稍后重试。';
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...(options.body ? {'Content-Type':'application/json'}:{}), ...options.headers } });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', '暂时无法连接服务，请检查网络后重试。');
  }
  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError('INVALID_RESPONSE', '服务暂时无法响应，请稍后重试。');
  }
  if (!envelope?.ok) {
    const error = envelope?.error;
    const code = error?.code || String(response.status);
    throw new ApiClientError(code, userMessage(code, error?.message || '', path));
  }
  return envelope.data;
}
export const post = <T>(path:string,body:unknown,token?:string) => apiRequest<T>(path,{method:'POST',body:JSON.stringify(body),headers:token?{Authorization:`Bearer ${token}`}:{}});
