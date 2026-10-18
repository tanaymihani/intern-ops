document.getElementById('submit').addEventListener('click', async () => {
  const btn = document.getElementById('submit');
  const status = document.getElementById('status');
  const pw = document.getElementById('pw').value;
  const curl = document.getElementById('curl').value;
  if (!pw || !curl) { status.textContent = 'Fill in both fields.'; return; }
  btn.disabled = true;
  status.style.color = '';
  status.textContent = 'Updating…';
  try {
    const res = await fetch('/api/refresh-cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw, source: 'jobright', curl }),
    });
    const data = await res.json();
    status.textContent = res.ok ? `✓ ${data.message}` : `✗ ${data.error || 'Failed.'}`;
    status.style.color = res.ok ? 'var(--ok)' : 'var(--bad)';
    if (res.ok) { document.getElementById('curl').value = ''; document.getElementById('pw').value = ''; }
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    status.style.color = 'var(--bad)';
  }
  btn.disabled = false;
});
