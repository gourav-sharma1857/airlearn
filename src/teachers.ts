import { initSite } from './site';
import { FORMSPREE_ID } from './config';

initSite();

const form = document.getElementById('pilot-form') as HTMLFormElement;
const status = document.getElementById('form-status') as HTMLElement;

function setStatus(kind: 'ok' | 'err' | '', text: string): void {
  status.className = kind ? `form-status ${kind}` : '';
  status.textContent = text;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = form.elements.namedItem('name') as HTMLInputElement;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  if (!name.value.trim()) {
    setStatus('err', 'Please add your name.');
    name.focus();
    return;
  }
  if (!email.value.trim() || !email.checkValidity()) {
    setStatus('err', 'Please add a valid email address so we can reply.');
    email.focus();
    return;
  }
  if (!FORMSPREE_ID) {
    setStatus('err', 'The signup form is not connected yet. (Site owner: set VITE_FORMSPREE_ID in .env.)');
    return;
  }
  const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  button.disabled = true;
  setStatus('', 'Sending…');
  try {
    const res = await fetch(`https://formspree.io/f/${encodeURIComponent(FORMSPREE_ID)}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new FormData(form),
    });
    if (!res.ok) throw new Error(String(res.status));
    form.reset();
    setStatus('ok', "Thanks! You're on the list. We'll be in touch by email.");
  } catch {
    setStatus('err', "Sorry, that didn't go through. Please check your connection and try again.");
  } finally {
    button.disabled = false;
  }
});
