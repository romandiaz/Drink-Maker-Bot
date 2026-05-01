// Thin JSON fetch wrapper shared by the admin screens. Errors surface as
// thrown Error with the server's `error` field as the message when present,
// so callers can pass `e.message` straight into toast copy.

async function asError(res, verb) {
  let body = null;
  try { body = await res.json(); } catch {}
  const msg = (body && body.error) || `${verb} ${res.status}`;
  const err = new Error(msg);
  err.status = res.status;
  throw err;
}

export async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) await asError(res, "GET");
  return res.json();
}

export async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await asError(res, "POST");
  return res.json();
}

export async function putJSON(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await asError(res, "PUT");
  return res.json();
}

export async function delJSON(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) await asError(res, "DELETE");
  return res.json();
}
