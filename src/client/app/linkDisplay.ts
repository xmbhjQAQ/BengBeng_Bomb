/**
 * Capability URLs can contain a long, random token.  Keep the complete value
 * in the copy handler, but expose only a compact, non-sensitive preview in
 * the page.  In particular, never render a manage token in the DOM.
 */
export function compactLink(value: string, privateLink = false): string {
  try {
    const url = new URL(value, window.location.origin);
    const origin = url.origin === window.location.origin ? '' : url.origin;
    if (privateLink || url.pathname === '/manage') return `${origin}/manage#••••`;

    const path = `${url.pathname}${url.search}`;
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments.at(-1) ?? '';
    if (segments[0] === 'c' && last) return `${origin}/c/…${last.slice(-4)}`;
    if (segments[0] === 'report' && last) return `${origin}/report/…${last.slice(-4)}`;
    if (path.length <= 34) return `${origin}${path}`;
    return `${origin}${path.slice(0, 18)}…${path.slice(-8)}`;
  } catch {
    if (privateLink) return '私密结果入口（已隐藏）';
    if (value.length <= 34) return value;
    return `${value.slice(0, 18)}…${value.slice(-8)}`;
  }
}
