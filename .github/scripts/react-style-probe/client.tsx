import '@expressive/react';
import { Component } from 'react';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ThirdDeepCase, ThirdParty } from './cases';

class Boundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: Error) {
    return { error: String(error?.message || error) };
  }

  render() {
    return this.state.error ? <pre className="third-error">{this.state.error}</pre> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
createRoot(document.getElementById('third-root')!).render(<Boundary><ThirdParty /></Boundary>);
setTimeout(() => createRoot(document.getElementById('third-deep-root')!).render(<Boundary><ThirdDeepCase /></Boundary>), 500);
