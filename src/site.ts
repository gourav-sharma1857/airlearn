/** Shared page setup: nav state, footer year, analytics. */
// Styles are linked in each page's <head> so they apply before first paint.
import { initAnalytics } from './analytics';

export function initSite(): void {
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll<HTMLAnchorElement>('.site-nav a').forEach((a) => {
    const target = a.getAttribute('href')?.replace('./', '') || '';
    if (target === here || (here === '' && target === 'index.html')) a.setAttribute('aria-current', 'page');
  });
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
  initAnalytics();
}
