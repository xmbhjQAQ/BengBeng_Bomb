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
    expect(screen.queryByText('本站使用匿名统计技术以提升用户体验')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '男娘测试' })).toHaveAttribute('href', 'https://femboy.test.nagisa.icu');
    expect(screen.getByRole('link', { name: '男娘测试' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: '男娘测试' })).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
