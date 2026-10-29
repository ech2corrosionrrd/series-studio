// versions-trash: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleVersionTrashRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { dropVersion, listVersions, setCurrent } from "../../src/versions.mjs";
import { join } from "node:path";
import { listTrash, purgeTrash, restoreTrash } from "../../src/trash.mjs";
import { httpError, readBody, send as sendResponse } from "../http.mjs";

export async function handleVersionTrashRoutes(ctx) {
  const { req, res, url, pathname, P, discardSelectionFiles, safeSetName, trashDir } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/versions/current" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    setCurrent(join(P().out, dir), body.edition, body.v);
    return send(res, 200, { ok: true, dir, ...listVersions(join(P().out, dir), dir, body.edition) });
  }

  if (pathname === "/api/versions/drop" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    const file = dropVersion(join(P().out, dir), body.edition, body.v);
    discardSelectionFiles([file]);
    return send(res, 200, { ok: true, dir, ...listVersions(join(P().out, dir), dir, body.edition) });
  }

  if (pathname === "/api/trash" && req.method === "GET") {
    return send(res, 200, { items: listTrash(trashDir()) });
  }

  if (pathname === "/api/trash/restore" && req.method === "POST") {
    const body = await readBody(req);
    const trashId = String(body.id || "");
    let item;
    try {
      item = restoreTrash({ root: P().root, trashDir: trashDir() }, trashId);
    } catch (e) {
      if (/already exists/.test(String(e.message))) throw httpError(409, "A file with this name already exists: move or delete it first.");
      throw e;
    }
    return send(res, 200, { ok: true, restored: item, items: listTrash(trashDir()) });
  }

  if (pathname === "/api/trash/purge" && req.method === "POST") {
    const body = await readBody(req);
    purgeTrash(trashDir(), String(body.id || ""));
    return send(res, 200, { ok: true, items: listTrash(trashDir()) });
  }

  return false;
}
