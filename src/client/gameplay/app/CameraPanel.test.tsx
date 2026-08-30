import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CameraPanel } from './CameraPanel';

const baseProps = {
  cameraStatus: 'ready' as const,
  detectorStatus: 'error' as const,
  detectorError: 'MediaPipe 初始化失败（自动 SIMD：compile failed；无 SIMD：out of memory）',
  calibrationIssue: null,
  calibrationProgress: 0,
  calibrating: false,
  profile: null,
  canCalibrate: false,
  onOpen: vi.fn(),
  onRetryDetector: vi.fn(),
  onCalibrate: vi.fn(),
  setCameraElement: vi.fn(),
};

describe('CameraPanel detector diagnostics', () => {
  it('keeps the friendly error and puts sanitized detail in a collapsed disclosure', () => {
    render(<CameraPanel {...baseProps} />);

    expect(screen.getByText(/面部检测暂时没准备好/)).toBeInTheDocument();
    const detail = screen.getByText(baseProps.detectorError);
    const disclosure = detail.closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByText('查看错误详情')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新准备检测' })).toBeInTheDocument();
  });

  it('does not render technical detail outside the error state', () => {
    const { container } = render(
      <CameraPanel
        {...baseProps}
        detectorStatus="loading"
      />,
    );

    expect(container).not.toHaveTextContent('查看错误详情');
    expect(container).not.toHaveTextContent(baseProps.detectorError);
  });
});
