// storage: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleStorageRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { checkStorageStatus, uploadToIrys } from "../../src/index.mjs";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadKeys } from "../../src/keys.mjs";
import { readBody, send as sendResponse } from "../http.mjs";

export async function handleStorageRoutes(ctx) {
  const { req, res, url, pathname, P, chargeStage, refundStage, safeSetName } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/storage/status" && req.method === "GET") {
    loadKeys();
    return send(res, 200, checkStorageStatus(process.env));
  }

  if (pathname === "/api/storage/pin" && req.method === "POST") {
    loadKeys();
    const body = await readBody(req);
    const dir = safeSetName(body.dir || body.set);
    if (!dir) return send(res, 400, { error: "dir required" });
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${dir}` });
    }
    const name = body.name || `series-${dir}`;
    const paid = chargeStage("archive", { storage: true, zip: false });
    let result;
    try {
      result = await uploadToIrys({
        dir: setDir,
      });
    } catch (e) {
      refundStage(paid);
      throw e;
    }
    if (result && result.ok === false) refundStage(paid);
    return send(res, 200, { ...result, quote: paid.quote, chargedCredits: paid.charge?.amount || 0 });
  }

  return false;
}
