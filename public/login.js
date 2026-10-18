document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      return;
    }
    status.textContent = (await res.json().catch(() => ({}))).error || 'Could not sign in.';
  } catch {
    status.textContent = 'Network error — try again.';
  }
  btn.disabled = false;
});
