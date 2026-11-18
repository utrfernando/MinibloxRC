import React from 'react';

/**
 * Last line of defence: if any page fails to load or crashes, show a friendly message
 * (and the technical reason, so it can be reported) instead of a blank white screen.
 * A page file that can't be downloaded (stale cache after an update) is retried once by reloading.
 */
export class AppGuard extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('App crashed', error);
    const chunkFail = /dynamically imported module|Importing a module script failed|Loading chunk|error loading/i.test(String(error?.message));
    try {
      if (chunkFail && !sessionStorage.getItem('chunk-retry')) { sessionStorage.setItem('chunk-retry', '1'); location.reload(); }
    } catch { /* ignore */ }
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '64px 20px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 48 }}>🧸</div>
        <h1 style={{ fontSize: 22, margin: '12px 0 6px' }}>Oops, this page couldn&rsquo;t open</h1>
        <p style={{ color: '#64748b' }}>Please try again, or go to the main shop.</p>
        <p style={{ margin: '20px 0' }}>
          <a href="/" style={{ background: '#14b8a6', color: '#fff', fontWeight: 800, padding: '12px 22px', borderRadius: 999, textDecoration: 'none', marginRight: 8 }}>Go to the shop</a>
          <button onClick={() => { try { sessionStorage.removeItem('chunk-retry'); } catch { /* ignore */ } location.reload(); }} style={{ border: '2px solid #cbd5e1', background: '#fff', fontWeight: 800, padding: '10px 20px', borderRadius: 999 }}>Try again</button>
        </p>
        <p style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-word' }}>{String(error?.message || error).slice(0, 300)}</p>
      </div>
    );
  }
}
