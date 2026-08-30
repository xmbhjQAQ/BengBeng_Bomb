import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BilibiliSourcePanel } from './BilibiliSourcePanel';

const selection = {
  bvid: 'BV1B7411m7LV',
  title: '测试视频',
  cover: 'https://cdn.example/cover.webp',
  pic: 'https://cdn.example/fallback.webp',
  directUrl: 'https://cdn.example/video.mp4',
};

describe('BilibiliSourcePanel', () => {
  it('sets no-referrer before loading the cover and only reports failure after candidates fail', () => {
    const { container } = render(
      <BilibiliSourcePanel
        selection={selection}
        loading={false}
        error={null}
        disabled={false}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    const image = container.querySelector('img');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', selection.cover);
    expect(image).toHaveProperty('referrerPolicy', 'no-referrer');
    fireEvent.error(image!);
    expect(container.querySelector('img')).toHaveAttribute('src', selection.pic);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByLabelText('视频封面加载失败')).toBeInTheDocument();
    expect(screen.queryByText('B站')).not.toBeInTheDocument();
  });
});
