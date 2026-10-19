const source = document.getElementById('source');
const showSteps = () => {
  document.getElementById('steps-handshake').hidden = source.value !== 'handshake';
  document.getElementById('steps-jobright').hidden = source.value !== 'jobright';
};
source.addEventListener('change', showSteps);
if (new URLSearchParams(location.search).get('source') === 'jobright') source.value = 'jobright';
showSteps();

document.getElementById('submit').addEventListener('click', async () => {
  const btn = document.getElementById('submit');
  const status = document.getElementById('status');
  const password = document.getElementById('pw').value;
  const curl = document.getElementById('curl').value;
  if (!password || !curl) { status.textContent = 'Paste the request and enter your password.'; return; }
  btn.disabled = true;
  status.style.color = '';
  status.textContent = 'Saving…';
  try {
    const res = await fetch('/api/refresh-cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, source: source.value, curl }),
    });
    const data = await res.json().catch(() => ({}));
    status.textContent = res.ok ? `✓ ${data.message}` : `✗ ${data.error || 'Failed.'}`;
    status.style.color = res.ok ? 'var(--ok)' : '#f87171';
    if (res.ok) { document.getElementById('curl').value = ''; document.getElementById('pw').value = ''; }
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    status.style.color = '#f87171';
  }
  btn.disabled = false;
});
