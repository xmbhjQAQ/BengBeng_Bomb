import { useState } from 'react';
import { copyText } from './copyText';

type CopyState = 'idle' | 'success' | 'error';

interface CopyButtonProps {
  value: string;
  className?: string;
  label?: string;
}

/**
 * Copy a complete capability URL while keeping the result of the action
 * visible. The full value is never persistent page content; the compatibility
 * input is removed immediately after the copy attempt.
 */
export function CopyButton({ value, className = 'secondary', label = '复制链接' }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  const copy = async () => {
    try {
      await copyText(value);
      setState('success');
    } catch {
      setState('error');
    }
  };

  const text = state === 'success'
    ? '已复制'
    : state === 'error'
      ? '复制失败，请重试'
      : label;

  return (
    <button
      type="button"
      className={className}
      data-copy-state={state}
      aria-live="polite"
      onClick={() => void copy()}
    >
      {text}
    </button>
  );
}
