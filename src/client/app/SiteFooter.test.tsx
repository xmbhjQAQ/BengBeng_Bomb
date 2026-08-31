import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from './SiteFooter';

describe('SiteFooter', () => {
  it('renders the creator and repository links as secure external links', () => {
    render(<SiteFooter />);

    expect(screen.getByRole('contentinfo', { name: '网站信息' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'xmbhjQAQ' })).toHaveAttribute('href', 'https://space.bilibili.com/174355920');
    expect(screen.getByRole('link', { name: 'xmbhjQAQ' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'xmbhjQAQ' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Github' })).toHaveAttribute('href', 'https://github.com/xmbhjQAQ?tab=repositories');
    expect(screen.getByRole('link', { name: 'Github' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Github' })).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
