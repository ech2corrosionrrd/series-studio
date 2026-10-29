// base: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleBaseRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { analyzeBaseImage } from "../../src/index.mjs";
import { basename, extname, join } from "node:path";
import { buildWishPrompt, engineCtx } from "../../src/engines.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { httpError, readBody, send } from "../http.mjs";
import { writeJsonAtomic } from "../../src/fs-safe.mjs";
import { send as sendResponse } from "../http.mjs";

export async function handleBaseRoutes(ctx) {
  const { req, res, url, pathname, P, assertWalletDisk, baseStatus, blockedPrompts, chargeCredits, inferRole, listBases, mimeOf, noteDiskWrite, nowIsoKyiv, readWish, refundCharge, runPrimaryGenerate, toTrash, visionCreditCost } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/base/status" && req.method === "GET") {
    return send(res, 200, baseStatus());
  }

  if (pathname === "/api/base/list" && req.method === "GET") {
    return send(res, 200, { files: listBases(), wish: readWish() });
  }

  if (pathname === "/api/base/upload" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.data) throw httpError(400, "data (base64) required");
    mkdirSync(P().input, { recursive: true });
    const orig = basename(String(body.filename || "primary.png"));
    const ext = extname(orig).toLowerCase() || ".png";
    const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    if (!allowed.has(ext)) throw new Error("image must be png/jpg/webp");
    const role = String(body.role || "primary");
    let name;
    if (role === "primary") {
      // If a main base already exists, keep it and store the new file as an extra
      // (matches Studio help: don’t silently overwrite the current primary).
      const hasPrimary = listBases().some((f) => f.primary);
      if (hasPrimary) {
        const stamp = Date.now().toString(36);
        const safe = orig.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "base";
        name = `extra-${stamp}-${safe}`;
        if (!name.endsWith(ext)) name += ext;
      } else {
        name = "primary" + ext;
      }
    } else if (role === "line") {
      const line = String(body.line || "a").replace(/[^a-zA-Z0-9_-]/g, "") || "a";
      name = `base-${line}${ext}`;
    } else if (role === "style") {
      const stamp = Date.now().toString(36);
      name = `style-${stamp}${ext}`;
    } else {
      const stamp = Date.now().toString(36);
      const safe = orig.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
      name = `extra-${stamp}-${safe}`;
      if (!name.endsWith(ext)) name += ext;
    }
    const buf = Buffer.from(body.data, "base64");
    if (buf.length < 32) throw new Error("empty image");
    assertWalletDisk(buf.length * (body.makePrimary ? 2 : 1));
    const outPath = join(P().input, name);
    if (existsSync(outPath)) toTrash([outPath], `overwritten by upload (${name})`);
    writeFileSync(outPath, buf);
    noteDiskWrite(buf.length);
    // optional: set as primary by renaming/copying
    if (body.makePrimary && role !== "primary") {
      const primaryName = "primary" + ext;
      if (existsSync(join(P().input, primaryName))) toTrash([join(P().input, primaryName)], "replaced primary (upload)");
      writeFileSync(join(P().input, primaryName), buf);
      name = primaryName;
    }
    return send(res, 200, {
      ok: true,
      path: `input/${name}`,
      file: name,
      bytes: buf.length,
      role: inferRole(name),
      files: listBases(),
    });
  }

  if (pathname === "/api/base/primary" && req.method === "POST") {
    const body = await readBody(req);
    const file = basename(String(body.file || ""));
    if (!file) throw httpError(400, "file required");
    const src = join(P().input, file);
    if (!existsSync(src)) throw new Error("file not found");
    const ext = extname(file).toLowerCase() || ".png";
    const destName = "primary" + ext;
    if (file === destName) return send(res, 200, { ok: true, file: destName, path: `input/${destName}`, files: listBases() });
    const buf = readFileSync(src);
    assertWalletDisk(buf.length);
    toTrash(
      readdirSync(P().input).filter((n) => /^(primary|mother)\./i.test(n)).map((n) => join(P().input, n)),
      `replaced primary (set ${file})`,
    );
    writeFileSync(join(P().input, destName), buf);
    return send(res, 200, { ok: true, file: destName, path: `input/${destName}`, files: listBases() });
  }

  if (pathname === "/api/base/delete" && req.method === "POST") {
    const body = await readBody(req);
    const file = basename(String(body.file || ""));
    if (!file || file.includes("..")) throw httpError(400, "bad file");
    const path = join(P().input, file);
    if (!existsSync(path)) throw new Error("not found");
    const trashed = toTrash([path], "base image deleted");
    return send(res, 200, { ok: true, trashId: trashed?.id ?? null, files: listBases() });
  }

  if (pathname === "/api/base/wish" && req.method === "GET") {
    return send(res, 200, { wish: readWish() });
  }

  if (pathname === "/api/base/wish" && req.method === "POST") {
    const body = await readBody(req);
    const text = String(body.wish || "").trim();
    if (!text) throw httpError(400, "wish text required");
    mkdirSync(P().input, { recursive: true });
    const wish = {
      wish: text,
      engine: body.engine || "kontext",
      strength: Number(body.strength ?? 0.45),
      updatedAt: nowIsoKyiv(),
    };
    writeJsonAtomic(join(P().input, "wish.json"), wish);
    return send(res, 200, { ok: true, wish });
  }

  if (pathname === "/api/base/generate" && req.method === "POST") {
    const body = await readBody(req);
    const text = String(body.wish || readWish()?.wish || "").trim();
    if (!text) throw httpError(400, "wish text required");
    {
      const assembled = buildWishPrompt(text);
      const blocked = blockedPrompts([`${assembled}\n${text}`]);
      if (blocked) return send(res, 400, blocked);
    }
    mkdirSync(P().input, { recursive: true });
    const wish = {
      wish: text,
      engine: body.engine || "openai",
      strength: Number(body.strength ?? 0.45),
      updatedAt: nowIsoKyiv(),
    };
    writeJsonAtomic(join(P().input, "wish.json"), wish);
    const result = await runPrimaryGenerate({
      wish: text,
      engine: body.engine || "openai",
      strength: body.strength,
      useRef: Boolean(body.useRef),
      makePrimary: body.makePrimary !== false,
      seed: body.seed != null ? Number(body.seed) : undefined,
    });
    return send(res, 200, { ...result, wish });
  }

  if (pathname === "/api/base/analyze" && req.method === "POST") {
    const body = await readBody(req);
    const bases = listBases();
    let baseFile = body.file ? basename(String(body.file)) : null;
    let target = bases.find((b) => b.file === baseFile) || bases.find((b) => b.primary) || bases[0];
    if (!target) return send(res, 400, { error: "No base image found to analyze" });
    const imgBuf = readFileSync(join(P().input, target.file));
    const mime = mimeOf(target.file);
    const paidVision = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    const charge = paidVision ? chargeCredits({ engine: "vision", credits: visionCreditCost(), note: "vision assist", rateLimited: false }) : null;
    let result;
    try {
      result = await analyzeBaseImage({ image: imgBuf, mime }, engineCtx(process.env));
    } catch (e) {
      refundCharge(charge);
      throw e;
    }
    if (charge && String(result?.provider || "").toLowerCase() === "heuristic") refundCharge(charge);
    return send(res, 200, { ...result, file: target.file });
  }

  return false;
}
