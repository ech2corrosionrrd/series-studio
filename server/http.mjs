// HTTP-помічники сервера Lab: відповідь JSON/текстом, SSE, тіло запиту, помилка зі статусом.
// Винесено з server/index.mjs без зміни поведінки (docs/QUALITY-REVIEW.md, план розрізання).

export function send(res, status, body, type = "application/json; charset=utf-8", extraHeaders = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(data);
}

export function writeSse(res, payload) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/** Abort the batch when the browser drops the live stream (Stop). */
export function attachStopOnDisconnect(res, stop) {
  const onGone = () => {
    if (res.writableEnded || stop.signal.aborted) return;
    stop.abort(new Error("stopped"));
  };
  res.on("close", onGone);
  res.on("error", onGone);
  const req = res.req;
  if (req) {
    req.on("aborted", onGone);
    req.on("error", onGone);
  }
}

export function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 25 * 1024 * 1024;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}
