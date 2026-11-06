import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [health, setHealth] = useState('Checking backend…');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Health request failed');
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null ||
            !('status' in body) || body.status !== 'ok') {
          throw new Error('Unexpected health response');
        }
        if (active) setHealth('Backend connected');
      })
      .catch(() => {
        if (active) setHealth('Backend unavailable');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <main>
      <header><span className="wordmark">K / R</span><span>RSKD LABS · VESSEL REPLAY</span></header>
      <section>
        <p className="eyebrow">01 / FOUNDATION</p>
        <h1>Kappal<br /><em>Rewind.</em></h1>
        <p className="tagline">The sea has a replay button.</p>
        <div className="status" role="status">{health}</div>
        <p className="note">The application foundation is running.<br />Map and replay controls are planned for the next phases.</p>
      </section>
      <footer><span>BUILT TO REVISIT THE JOURNEY</span><span>DEVELOPMENT / 0.1</span></footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
