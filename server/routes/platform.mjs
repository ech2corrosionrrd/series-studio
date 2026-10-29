// platform: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handlePlatformRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { ENGINES, TXT2IMG, listSelectableEngines, pickAvailableEngine } from "../../src/engines.mjs";
import { PACKAGES, creditCost, getBalance, referralCodeFor } from "../../src/platform/billing.mjs";
import { anonymizeRenderLog } from "../../src/spend.mjs";
import { basename, join, resolve } from "node:path";
import { eraseWalletRecords } from "../../src/platform/erase.mjs";
import { isAdmin } from "../../src/platform/ops.mjs";
import { isInsideDir } from "../../src/fs-safe.mjs";
import { projectQuota, projectsConfig } from "../../src/projects.mjs";
import { publishCollection } from "../../src/platform/site.mjs";
import { quoteStage } from "../../src/platform/stage-pricing.mjs";
import { readFileSync, rmSync } from "node:fs";
import { solPayInfo } from "../../src/platform/solpay.mjs";
import { testEngineConnection } from "../../src/connectors.mjs";
import { readBody, send as sendResponse } from "../http.mjs";

export async function handlePlatformRoutes(ctx) {
  const { req, res, url, pathname, DATA_DIR, KEYS_PATH, LOCAL_ONLY_ENGINES, P, PORT, PUBLIC_MODE, baseStatus, currentWallet, listSetImages, localGpuPolicy, readMarks, renderLog, safeSetName, storageInfo, trackFunnel, userPaths, walletProjects } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/account/delete-data" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 400, { error: "public mode only" });
    const wallet = currentWallet();
    if (!wallet) return send(res, 401, { error: "Sign in with your wallet first", code: "auth" });
    const body = await readBody(req);
    if (String(body.confirm || "") !== "DELETE") {
      return send(res, 400, { error: "confirmation required", code: "confirm" });
    }
    const usersRoot = join(DATA_DIR, "users");
    const walletRoot = userPaths(wallet).root;
    let filesRemoved = false;
    if (isInsideDir(usersRoot, walletRoot) && walletRoot !== resolve(usersRoot)) {
      rmSync(walletRoot, { recursive: true, force: true });
      filesRemoved = true;
    }
    const rows = eraseWalletRecords(wallet);
    const logLines = anonymizeRenderLog(renderLog(), wallet);
    console.warn(`[erase] data erased for ${String(wallet).slice(0, 6)}… (files ${filesRemoved ? "yes" : "no"}, rows ${Object.values(rows).reduce((a, b) => a + b, 0)}, log ${logLines})`);
    return send(res, 200, { ok: true, filesRemoved, rows, logLines });
  }

  if (pathname === "/api/me" && req.method === "GET") {
    const gpu = localGpuPolicy();
    if (!PUBLIC_MODE) {
      return send(res, 200, {
        mode: "local",
        admin: true,
        localGpu: gpu,
        creditCosts: Object.fromEntries(
          Object.keys(ENGINES).map((e) => [
            e,
            creditCost(e, { reference: true, costUsd: ENGINES[e].costUsd }),
          ]),
        ),
      });
    }
    const wallet = currentWallet();
    const code = referralCodeFor(wallet);
    return send(res, 200, {
      mode: "public",
      admin: isAdmin(wallet),
      wallet,
      balance: getBalance(wallet),
      storage: storageInfo(),
      projects: (() => {
        const q = projectQuota(walletProjects(), projectsConfig());
        return isAdmin(wallet) ? { ...q, needsCharge: false, exempt: true } : { ...q, exempt: false };
      })(),
      packages: Object.entries(PACKAGES).map(([id, p]) => ({ id, ...p })),
      solPay: solPayInfo(process.env, { admin: isAdmin(wallet) }),
      referral: code ? { code, link: `${process.env.AUTH_URI || "https://lab.w3ir.io"}/login?ref=${code}` } : null,
      localGpu: gpu,
      creditCosts: Object.fromEntries(
        Object.keys(ENGINES).map((e) => [
          e,
          LOCAL_ONLY_ENGINES.has(e) && !gpu.enabled
            ? null
            : creditCost(e, { reference: true, costUsd: ENGINES[e].costUsd }),
        ]),
      ),
    });
  }

  if (pathname === "/api/local-gpu" && req.method === "GET") {
    const gpu = localGpuPolicy();
    const probe = url.searchParams.get("probe") === "1" || url.searchParams.get("probe") === "true";
    if (!gpu.enabled) {
      return send(res, 200, {
        ok: true,
        ...gpu,
        probed: false,
        comfyui: { online: false, available: false },
        a1111: { online: false, available: false },
      });
    }
    if (!probe) {
      return send(res, 200, {
        ok: true,
        ...gpu,
        probed: false,
        comfyui: { online: null, url: gpu.urls.comfyui },
        a1111: { online: null, url: gpu.urls.a1111 },
      });
    }
    const [comfy, a1111] = await Promise.all([
      testEngineConnection("comfyui", process.env, globalThis.fetch),
      testEngineConnection("a1111", process.env, globalThis.fetch),
    ]);
    return send(res, 200, {
      ok: true,
      ...gpu,
      probed: true,
      probed_at: new Date().toISOString(),
      comfyui: { ...comfy, url: gpu.urls.comfyui, available: true },
      a1111: { ...a1111, url: gpu.urls.a1111, available: true },
    });
  }

  if (pathname === "/api/publish" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    const body = await readBody(req);
    const dir = safeSetName(body.dir);
    const marks = readMarks(dir);
    const onlyKeep = body.onlyKeep !== false && Object.values(marks).includes("keep");
    const images = listSetImages(dir).images
      .filter((img) => !onlyKeep || marks[String(img.edition)] === "keep")
      .map((img) => ({ name: img.file, bytes: readFileSync(join(P().out, dir, img.file)) }));
    const slug = publishCollection(String(body.title || dir), images, { subtitle: body.subtitle || "", wallet: currentWallet() });
    trackFunnel("publish", { slug, count: images.length });
    return send(res, 200, { ok: true, slug, url: `https://w3ir.io/c/${slug}`, path: `/c/${slug}` });
  }

  if (pathname === "/api/health") {
    return send(res, 200, {
      ok: true,
      product: "series-lab",
      layer: "lab+studio-ui",
      port: PORT,
      base: baseStatus(),
      keysConfigured: Boolean(KEYS_PATH),
      keysFileName: KEYS_PATH ? basename(KEYS_PATH) : null,
      engines: {
        edit: Object.keys(ENGINES),
        txt2img: Object.keys(TXT2IMG),
        availableEdit: pickAvailableEngine("kontext", process.env, ENGINES),
        availableTxt2img: pickAvailableEngine("openai", process.env, TXT2IMG),
        readyEdit: listSelectableEngines(process.env, ENGINES),
        readyTxt2img: listSelectableEngines(process.env, TXT2IMG),
      },
    });
  }

  if (pathname === "/api/stages/quotes" && req.method === "GET") {
    const count = Number(url.searchParams.get("count") || 1);
    const engine = url.searchParams.get("engine") || "kontext";
    const provider = url.searchParams.get("provider") || "heuristic";
    return send(res, 200, {
      ok: true,
      quotes: {
        generation: quoteStage("generation", { engine, count, reference: true }),
        curation: quoteStage("curation", { provider, count }),
        archive: quoteStage("archive", { zip: true }),
        archive_storage: quoteStage("archive", { zip: false, storage: true }),
        deploy_kit: quoteStage("deploy_kit"),
        marketplace_kit: quoteStage("marketplace_kit"),
      },
    });
  }

  if (pathname === "/api/stages/quote" && req.method === "GET") {
    const stage = url.searchParams.get("stage") || "archive";
    try {
      const quote = quoteStage(stage, {
        engine: url.searchParams.get("engine") || "kontext",
        count: Number(url.searchParams.get("count") || 1),
        reference: url.searchParams.get("reference") !== "0",
        provider: url.searchParams.get("provider") || "heuristic",
        storage: url.searchParams.get("storage") === "1" || url.searchParams.get("ipfs") === "1",
        zip: url.searchParams.get("zip") !== "0",
      });
      return send(res, 200, { ok: true, quote });
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
  }

  return false;
}
