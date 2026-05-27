// Shared HTTP helpers for the REST layer. The route modules under routes/
// import these; index.js keeps only sendJson (for its 404 fallthrough).

export function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

export async function readJsonBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        rejectBody(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectBody(new Error("invalid json"));
      }
    });
    req.on("error", rejectBody);
  });
}

// Run an async handler and serialise its result as JSON, folding the
// try/catch boilerplate that every route used to repeat. The handler returns
// the body to send with `status` (200 by default; pass 201 for creates).
// Any thrown error becomes a JSON error response: a message ending in
// "not found" maps to 404, everything else to `errorStatus` (400 by default,
// 500 for routes that wrap a system call like nmcli).
export async function jsonRoute(res, fn, { status = 200, errorStatus = 400 } = {}) {
  try {
    sendJson(res, status, await fn());
  } catch (e) {
    const notFound = typeof e.message === "string" && e.message.endsWith("not found");
    sendJson(res, notFound ? 404 : errorStatus, { error: e.message });
  }
}
