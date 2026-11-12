/**
 * Minimal, anonymous event counting.
 *
 * Only these events exist: page_open, camera_allowed, grab (a count), time_on_page (seconds).
 * Each beacon carries just { event, page, value }. No IDs, no cookies, no device
 * fingerprint, no IP logging on our side, and never anything from the camera.
 * If VITE_ANALYTICS_ENDPOINT is empty, nothing is sent at all.
 */
import { ANALYTICS_ENDPOINT } from './config';

type EventName = 'page_open' | 'camera_allowed' | 'grab' | 'time_on_page';

const page = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
let grabs = 0;
const openedAt = performance.now();
let flushed = false;

function send(event: EventName, value = 1): void {
  const body = JSON.stringify({ event, page, value });
  if (!ANALYTICS_ENDPOINT) {
    if (import.meta.env.DEV) console.debug('[analytics:off]', body);
    return;
  }
  try {
    navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: 'text/plain' }));
  } catch {
    /* analytics must never break the page */
  }
}

export function track(event: 'page_open' | 'camera_allowed'): void {
  send(event);
}

/** Grabs are counted locally and sent as one number when the page closes. */
export function countGrab(): void {
  grabs++;
}

function flush(): void {
  if (flushed) return;
  flushed = true;
  if (grabs > 0) send('grab', grabs);
  send('time_on_page', Math.round((performance.now() - openedAt) / 1000));
}

export function initAnalytics(): void {
  track('page_open');
  addEventListener('pagehide', flush);
}
