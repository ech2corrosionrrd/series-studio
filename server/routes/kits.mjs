// Release kits: launchpad profiles, portals and config, launch advisor, deploy kit and marketplace kit.
// Moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleKitRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// Everything that lives inside the studio process arrives in `ctx`.
import { buildDeployKit, deployChainChoice } from "../../src/deploy-kit.mjs";
import { buildCoreCandyConfig, buildSugarConfig, buildThirdwebConfig, getLaunchpadPortalUrls, getLaunchpadProfiles, readBundleItems } from "../../src/index.mjs";
import { writeFilesZip } from "../../src/kit-zip.mjs";
import { buildLaunchAdvisor } from "../../src/launch-advisor.mjs";
import { buildMarketplaceKit } from "../../src/marketplace-kit.mjs";
import { readBody, send as sendResponse } from "../http.mjs";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export async function handleKitRoutes(ctx) {
  const { req, res, url, pathname, P, bundlesDir, chargeStage, listArchives, loadArchiveFile, loadPresetFileSafe, loadSeriesContext, readMarks, refundStage, rejectSecrets, releaseArchive, resolveLocale, safeSetName } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/launchpads" && req.method === "GET") {
    return send(res, 200, { ok: true, profiles: getLaunchpadProfiles() });
  }

  if (pathname === "/api/release/portals" && req.method === "GET") {
    const profile = url.searchParams.get("profile") || "opensea";
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      try { archive = loadArchiveFile(archiveName).archive; } catch {}
    }
    const portal = getLaunchpadPortalUrls(profile, archive || {}, {
      imageUriPrefix: url.searchParams.get("imageUriPrefix") || "",
      creatorAddress: url.searchParams.get("creatorAddress") || "",
    });
    return send(res, 200, { ok: true, portal });
  }

  if (pathname === "/api/release/config" && req.method === "GET") {
    const profile = url.searchParams.get("profile") || "opensea";
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      try { archive = loadArchiveFile(archiveName).archive; } catch {}
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    let preset = null;
    if (archive?.presetId) {
      try { preset = loadPresetFileSafe(`${archive.presetId}.json`)?.preset || null; } catch {}
    }
    const opts = {
      creatorAddress: url.searchParams.get("creatorAddress") || "",
      zeroIndexed: url.searchParams.get("zeroIndexed") === "true",
      imageUriPrefix: url.searchParams.get("imageUriPrefix") || "",
      animationUriPrefix: url.searchParams.get("animationUriPrefix") || url.searchParams.get("animPrefix") || "",
      symbol: url.searchParams.get("symbol") || "LAB",
      sellerFeeBasisPoints: url.searchParams.get("sellerFeeBasisPoints") || 500,
      namePrefix: url.searchParams.get("namePrefix") || "",
    };

    const legacy = url.searchParams.get("legacy") === "1" || url.searchParams.get("legacy") === "true";
    if (profile === "launchmynft" || (profile === "magiceden" && legacy)) {
      const sugar = buildSugarConfig(archive || {}, preset || {}, opts);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="sugar.json"`,
      });
      return res.end(JSON.stringify(sugar, null, 2) + "\n");
    }
    if (profile === "magiceden") {
      const core = buildCoreCandyConfig(archive || {}, preset || {}, opts);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cm-config.json"`,
      });
      return res.end(JSON.stringify(core, null, 2) + "\n");
    }

    const tw = buildThirdwebConfig(archive || {}, preset || {}, opts);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="thirdweb.json"`,
    });
    return res.end(JSON.stringify(tw, null, 2) + "\n");
  }

  if (pathname === "/api/launch-advisor" && req.method === "GET") {
    const chain = url.searchParams.get("chain") || "solana";
    const locale = url.searchParams.get("locale") || resolveLocale(req, {});
    const licence = url.searchParams.get("licence") || "statement";
    const name = (url.searchParams.get("name") || "").slice(0, 120);
    const creator = (url.searchParams.get("creator") || "").slice(0, 120);
    const cap = (url.searchParams.get("cap") || "").slice(0, 20);
    return send(res, 200, { ok: true, ...buildLaunchAdvisor({ chain, locale, licence, name, creator, cap }) });
  }

  if ((pathname === "/api/deploy-kit" || pathname === "/api/marketplace-kit") && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return true;
    const kind = pathname.endsWith("marketplace-kit") ? "marketplace_kit" : "deploy_kit";
    let loaded;
    try {
      loaded = loadSeriesContext(body.archive || body.file);
    } catch (e) {
      return send(res, e.status || 404, { error: String(e.message || e) });
    }
    const set = safeSetName(body.set);
    const setDir = join(P().out, set);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${set}` });
    }
    const locale = resolveLocale(req, body);
    const choice = deployChainChoice(body.chain, body.legacy === true);
    const profileKey = body.profile || (choice.chain === "solana" ? "magiceden" : choice.chain === "bitcoin" ? "ordinalsbot" : "opensea");
    const onlyKeep = body.onlyKeep === undefined ? false : Boolean(body.onlyKeep);
    const relArchive = releaseArchive(loaded.archive, loaded.preset, setDir);
    const loadedItems = readBundleItems({
      archive: relArchive,
      setDir,
      marks: readMarks(set),
      onlyKeep,
    });
    if (loadedItems.error || !loadedItems.items.length) {
      return send(res, 400, { error: loadedItems.error || "no images" });
    }
    const sharedOpts = {
      chain: choice.chain,
      legacy: choice.legacy,
      profile: profileKey,
      format: body.format,
      creatorAddress: body.creatorAddress || "",
      symbol: body.symbol || loaded.preset?.symbol || "LAB",
      sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? 500,
      description: body.description || loaded.preset?.description || `${loaded.preset?.name || loaded.archive.presetId || "Series"} — Series Lab`,
      name: body.name || loaded.preset?.name || loaded.archive.presetId,
      namePrefix: body.namePrefix,
      price: body.price,
      includeHolderLicence: body.includeHolderLicence !== false,
      holderLicence: typeof body.holderLicence === "string" ? body.holderLicence : "",
      holderModel: typeof body.holderModel === "string" ? body.holderModel : "statement",
      holderCap: typeof body.holderCap === "string" || typeof body.holderCap === "number" ? String(body.holderCap).slice(0, 20) : "",
      allowlist: typeof body.allowlist === "string" ? body.allowlist : "",
      rehearsal: body.rehearsal === "skip" ? "skip" : "devnet",
    };
    const stamp = Date.now().toString(36);
    const file = `${kind === "deploy_kit" ? "deploy" : "market"}-${String(loaded.archive.presetId || "series").replace(/[^a-zA-Z0-9_-]/g, "")}-${stamp}.zip`;
    let paid;
    try {
      paid = chargeStage(kind);
    } catch (e) {
      return send(res, e.status || 402, { error: String(e.message || e), code: e.extra?.code || e.code || "credits", ...(e.extra || {}) });
    }
    try {
      const built = kind === "deploy_kit"
        ? buildDeployKit({
          archive: relArchive,
          preset: loaded.preset,
          items: loadedItems.items,
          opts: sharedOpts,
          locale,
        })
        : await buildMarketplaceKit({
          coverBuffer: loadedItems.items.slice().sort((a, b) => a.edition - b.edition)[0]?.buffer,
          opts: sharedOpts,
          locale,
          preset: loaded.preset,
          archive: relArchive,
        });
      await writeFilesZip(built.files, join(bundlesDir(), file));
      return send(res, 200, {
        ok: true,
        file,
        path: `out/bundles/${file}`,
        downloadUrl: `/out/bundles/${file}`,
        chain: built.chain,
        count: built.count ?? loadedItems.items.length,
        estimate: built.estimate || null,
        warnings: built.warnings || [],
        quote: paid.quote,
        chargedCredits: paid.charge?.amount || 0,
        guide: kind === "deploy_kit" ? built.guide : undefined,
      });
    } catch (e) {
      refundStage(paid);
      const status = e.status || (e.code === "secrets" ? 400 : 500);
      return send(res, status, { error: String(e.message || e), code: e.code || kind });
    }
  }

  return false;
}
