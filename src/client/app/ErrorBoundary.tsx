import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('[app-render-error]', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="page"><section className="section"><h1>页面暂时无法显示</h1><p>刚才的页面遇到了一点问题。可以重试，或回到首页重新开始。</p><div className="button-row"><button type="button" onClick={() => this.setState({ failed: false })}>重试</button><a className="button-link" href="/">回到首页</a></div></section></main>;
  }
}
