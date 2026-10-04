/**
 * Decide how the Generate panel leaves a live render.
 * A finished body must never stay on the 0% "stream active" label:
 * JSON with nothing to draw, or an SSE body that opened and then ended
 * without progress, both settle here.
 */

export function parseSseBuffer(buffer) {
  const parts = String(buffer).split("\n\n");
  const rest = parts.pop() ?? "";
  const events = [];
  for (const block of parts) {
    const match = block.match(/^data:\s*(.+)$/m);
    if (!match) continue;
    try {
      events.push(JSON.parse(match[1]));
    } catch {
      /* ignore a non-JSON keep-alive or a torn chunk */
    }
  }
  return { rest, events };
}

/**
 * @param {{ contentType?: string, bodyText?: string, events?: object[], aborted?: boolean }} input
 * @returns {{ state: "stopped"|"empty"|"done"|"error", percent?: number, payload?: object, message?: string, messageKey?: string, started?: boolean, progressed?: boolean }}
 */
export function settleGenerateStream({ contentType = "", bodyText = "", events = [], aborted = false } = {}) {
  if (aborted) return { state: "stopped" };

  const sse = String(contentType).includes("text/event-stream");
  const list = Array.isArray(events) ? events : [];

  if (!sse) {
    let parsed = null;
    if (bodyText) {
      try { parsed = JSON.parse(bodyText); } catch { parsed = null; }
    }
    if (parsed && parsed.ok === true && Number(parsed.count) === 0) {
      return { state: "empty", percent: 100, payload: parsed };
    }
    if (parsed && parsed.ok === true && (parsed.count != null || Array.isArray(parsed.results) || parsed.type === "done")) {
      return { state: "done", percent: 100, payload: parsed };
    }
    if (parsed && parsed.error) return { state: "error", message: String(parsed.error) };
    return { state: "error", messageKey: "render.streamEnded" };
  }

  const done = [...list].reverse().find((e) => e && e.type === "done");
  if (done) return { state: "done", percent: 100, payload: done };
  const err = [...list].reverse().find((e) => e && (e.type === "error" || e.error));
  if (err && (err.type === "error" || !done)) {
    return { state: "error", message: String(err.error || err.message || "error") };
  }
  const start = list.find((e) => e && e.type === "start");
  if (start && Number(start.total) === 0) {
    return { state: "empty", percent: 100, payload: { ok: true, count: 0, set: start.set, ...start } };
  }
  return {
    state: "error",
    messageKey: "render.streamEnded",
    started: Boolean(start),
    progressed: list.some((e) => e && e.type === "progress"),
  };
}
