export function assertShareableUrl(url: string) {
  if (url.includes('/manage') || url.includes('bm1.')) {
    throw new Error('管理链接不能写入分享卡');
  }
}
