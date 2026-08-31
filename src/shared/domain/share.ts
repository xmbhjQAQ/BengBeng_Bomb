export function assertShareableUrl(url: string) {
  const normalized = url.toLowerCase();
  if (normalized.includes('/manage') || /(?:^|[/?#=&])b(?:m|gm)1\./.test(normalized)) {
    throw new Error('管理链接不能写入分享卡');
  }
  if (normalized.includes('/attempt') || /(?:attempt(?:token|id)?|attempt_token)=/.test(normalized)) {
    throw new Error('挑战凭证不能写入分享卡');
  }
}
