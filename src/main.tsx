import { render } from 'preact';
import { App } from './ui/App';

const root = document.getElementById('app');
if (root) render(<App />, root);

// Offline Fast mode (docs/PLAN.md Phase 6 task 4). Only registered for a
// production build: in `npm run dev` the service worker would cache Vite's
// dev-only module URLs and fight with hot reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus, not a requirement — a registration
      // failure (unsupported browser, blocked storage) must not break the
      // app itself.
    });
  });
}
