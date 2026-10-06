import { Component, type ReactNode } from 'react';

export class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return (
      <main className="space-y-4 p-6">
        <p role="alert">The canvas could not load. Your saved drawings are kept locally.</p>
        <button className="rounded-md border border-border px-3 py-2 hover:bg-accent" onClick={() => location.reload()}>
          Reload canvas
        </button>
      </main>
    );

    return this.props.children;
  }
}
