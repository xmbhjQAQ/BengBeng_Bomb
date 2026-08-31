export async function copyText(value: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Some mobile browsers expose the API but reject it outside a user
    // gesture or secure context. Try the compatibility path below.
  }

  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    throw new Error('clipboard unavailable');
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('copy rejected');
  } finally {
    textarea.remove();
  }
}
