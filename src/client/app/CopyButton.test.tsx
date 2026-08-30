import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';
import { compactLink } from './linkDisplay';

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('copies the complete value and gives visible success feedback', async () => {
    render(<CopyButton value="https://example.com/c/bc1-a-very-long-token" />);

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));

    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    expect(writeText).toHaveBeenCalledWith('https://example.com/c/bc1-a-very-long-token');
  });

  it('shows a retryable failure when the browser rejects copying', async () => {
    writeText.mockRejectedValueOnce(new Error('permission denied'));
    render(<CopyButton value="https://example.com/c/token" />);

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));

    expect(await screen.findByRole('button', { name: '复制失败，请重试' })).toBeVisible();
  });

  it('uses a compatibility copy path when Clipboard API is unavailable', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    render(<CopyButton value="https://example.com/manage#m1-private-token" />);
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));

    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.queryByDisplayValue('https://example.com/manage#m1-private-token')).not.toBeInTheDocument();
  });
});

describe('compactLink', () => {
  it('hides capability tokens without changing what the copy action receives', () => {
    expect(compactLink('https://example.com/c/bc1-this-is-a-long-token-1234'))
      .toBe('https://example.com/c/…1234');
    expect(compactLink('https://example.com/manage#m1-a-very-long-private-token', true))
      .toBe('https://example.com/manage#••••');
  });
});
