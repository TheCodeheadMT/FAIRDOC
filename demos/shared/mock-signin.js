// Stand-in for MSAL.js sign-in in the demo host apps. In a real app you would call
// msalInstance.acquireTokenSilent(...) and pass the resulting token to FAIRDOC.
// Here we ask the mock Entra endpoint for a token issued to this host app's client id.
export const FAIRDOC_URL = `${location.protocol}//${location.hostname}:4000`;

export async function mountSignIn(el, { clientId, onToken, defaultUser }) {
  const users = await (await fetch(`${FAIRDOC_URL}/mock-entra/users`)).json();
  el.innerHTML = `<label style="display:flex;gap:6px;align-items:center;font-size:13px">
      <span style="opacity:.75">Signed in (mock O365):</span>
      <select aria-label="Demo user" style="font:inherit;padding:4px 6px;border-radius:6px">${users.map((u) => `<option value="${u.id}">${u.name} — ${u.kind}${u.roles.length ? ` (${u.roles.join(',')})` : ''}</option>`).join('')}</select></label>`;
  const sel = el.querySelector('select');
  if (defaultUser) sel.value = defaultUser;
  const go = async () => {
    const r = await fetch(`${FAIRDOC_URL}/mock-entra/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: sel.value, clientId }) });
    const { access_token } = await r.json();
    onToken(access_token, users.find((u) => u.id === sel.value));
  };
  sel.addEventListener('change', go);
  await go();
}

/** Decode (NOT verify) a JWT payload — fine for UI hints; FAIRDOC does the real verification. */
export const peek = (t) => JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
