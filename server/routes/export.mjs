// export: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleExportRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { LAUNCHPAD_PROFILES, buildBundleZip, calculateCollectionProvenance, duplicateImages, duplicates, exportDatasetZip, exportManifestCsv, generateMetadataPreview, generateShowcaseHtml, verifyProvenance } from "../../src/index.mjs";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readBody } from "../http.mjs";
import { send as sendResponse } from "../http.mjs";

export async function handleExportRoutes(ctx) {
  const { req, res, url, pathname, P, bundlesDir, chargeStage, listArchives, loadArchiveFile, loadPresetFileSafe, loadPresetForArchive, loadSeriesContext, readMarks, rejectSecrets, releaseArchive, resolveLocale, safeSetName, trackFunnel } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/export/manifest.csv" && req.method === "GET") {
    trackFunnel("export", { kind: "manifest" });
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      archive = loadArchiveFile(archiveName).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    if (!archive || !archive.recipes?.length) {
      return send(res, 400, { error: "No archive recipes available for manifest" });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const traitItems = preset?.traits?.items || preset?.traits || [];
    const profile = url.searchParams.get("profile") || "opensea";
    const zeroIndexed = url.searchParams.get("zeroIndexed") === "true" || url.searchParams.get("zeroIndex") === "true";
    const imageUriPrefix = url.searchParams.get("imageUriPrefix") || url.searchParams.get("imagePrefix") || "";
    const animationUriPrefix = url.searchParams.get("animationUriPrefix") || url.searchParams.get("animPrefix") || "";
    const namePrefix = url.searchParams.get("namePrefix") || `${archive.presetId || "Series"} #`;
    const description = url.searchParams.get("description") || `${preset?.name || archive.presetId || "Series"} — Series Lab export`;

    const csv = exportManifestCsv(archive.recipes, traitItems, {
      profile,
      zeroIndexed,
      imageUriPrefix,
      animationUriPrefix,
      namePrefix,
      description,
    });

    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="manifest-${archive.presetId || "series"}.csv"`,
    });
    return res.end(csv);
  }

  if (pathname === "/api/export/showcase.html" && req.method === "GET") {
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      archive = loadArchiveFile(archiveName).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    if (!archive || !archive.recipes?.length) {
      return send(res, 400, { error: "No archive recipes available for showcase" });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const html = generateShowcaseHtml(archive, preset || {});
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    return res.end(html);
  }

  if (pathname === "/api/export/preview-meta" && req.method === "POST") {
    const body = await readBody(req);
    const archiveName = body.archive || body.file;
    let archive = null;
    if (archiveName) {
      archive = loadArchiveFile(archiveName).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    if (!archive || !archive.recipes?.length) {
      return send(res, 400, { error: "No archive recipes available for preview" });
    }

    const recipe = archive.recipes[0];
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const traitItems = preset?.traits?.items || preset?.traits || [];
    const profileKey = body.profile || (body.format === "metaplex" ? "magiceden" : body.format === "ordinals" ? "ordinalsbot" : "opensea");
    const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
    const format = profile.format || body.format || "erc721";
    const opts = {
      profile: profileKey,
      creatorAddress: body.creatorAddress || null,
      zeroIndexed: Boolean(body.zeroIndexed || body.zeroIndex),
      imageUriPrefix: body.imageUriPrefix || body.imagePrefix || "",
      animationUriPrefix: body.animationUriPrefix || body.animPrefix || "",
      namePrefix: body.namePrefix || `${archive.presetId || "Series"} #`,
      symbol: body.symbol || profile.defaultSymbol || "LAB",
      sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? profile.defaultFee ?? 500,
      description: body.description || `${preset?.name || archive.presetId || "Series"} — Series Lab export`,
    };

    const preview = generateMetadataPreview(recipe, profileKey, opts, traitItems);
    return send(res, 200, { ok: true, edition: recipe.edition, format, profile: profileKey, preview });
  }

  if (pathname === "/api/export/bundle" && req.method === "POST") {
    trackFunnel("export", { kind: "bundle" });
    const body = await readBody(req);
    const archiveName = body.archive || body.file;
    if (!archiveName) return send(res, 400, { error: "archive required" });
    const profileKey = body.profile || (body.format === "metaplex" ? "magiceden" : body.format === "ordinals" ? "ordinalsbot" : "opensea");
    const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
    const format = profile.format || body.format || "erc721";
    const { archive, file: archiveFile } = loadArchiveFile(archiveName);
    const set = safeSetName(body.set);
    const setDir = join(P().out, set);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${set}` });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const marks = readMarks(set);
    const locale = resolveLocale(req, body);
    const onlyKeep = body.onlyKeep === undefined ? true : Boolean(body.onlyKeep);
    const bundleOpts = {
      format,
      profile: profileKey,
      creatorAddress: body.creatorAddress || null,
      zeroIndexed: Boolean(body.zeroIndexed || body.zeroIndex),
      onlyKeep,
      namePrefix: body.namePrefix || `${archive.presetId || "Series"} #`,
      symbol: body.symbol || profile.defaultSymbol || "LAB",
      sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? profile.defaultFee ?? 500,
      description:
        body.description ||
        `${preset?.name || archive.presetId || "Series"} — Series Lab export`,
      imageUriPrefix: body.imageUriPrefix || body.imagePrefix || "",
      animationUriPrefix: body.animationUriPrefix || body.animPrefix || "",
      locale,
      upscale: Boolean(body.upscale),
      aiMark: body.aiMark !== false,
      authorship: body.authorship && typeof body.authorship === "object" ? body.authorship : null,
    };
    try {
      const result = await buildBundleZip({
        archive: releaseArchive(archive, preset, setDir),
        preset,
        setDir,
        set,
        marks,
        bundlesDir: bundlesDir(),
        opts: { ...bundleOpts, gate: true },
      });
      let paid;
      try {
        paid = chargeStage("archive", { zip: true, storage: false });
      } catch (e) {
        try { unlinkSync(join(bundlesDir(), result.file)); } catch { /* already gone */ }
        throw e;
      }
      return send(res, 200, {
        ok: true,
        ready: result.ready === true,
        file: result.file,
        path: result.path,
        count: result.count,
        missing: result.missing || [],
        format: result.format,
        profile: result.profile,
        chain: result.chain,
        provenanceHash: result.provenanceHash || null,
        upscaled: result.upscaled,
        upscaleSkipped: result.upscaleSkipped || null,
        fallback: result.fallback || null,
        archive: archiveFile,
        set,
        downloadUrl: `/${result.path}`,
        preflight: result.preflight,
        report: result.preflight?.report || "",
        quote: paid.quote,
        chargedCredits: paid.charge?.amount || 0,
      });
    } catch (e) {
      if (e.extra?.code === "credits" || e.extra?.code === "auth" || e.status === 401) throw e;
      const status =
        e.status || (e.code === "bundle_select" || e.code === "bundle_empty" ? 400 : 500);
      return send(res, status, {
        error: e.report || String(e.message || e),
        code: e.code || e.extra?.code || "bundle",
        ready: false,
        preflight: e.preflight || null,
        report: e.report || e.preflight?.report || "",
        ...(e.extra || {}),
      });
    }
  }

  if (pathname === "/api/preflight" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return;
    const archiveName = body.archive || body.file;
    const profileKey = body.profile || (body.format === "metaplex" ? "magiceden" : body.format === "ordinals" ? "ordinalsbot" : "opensea");
    const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
    const format = profile.format || body.format || "erc721";
    let loaded;
    try {
      loaded = loadSeriesContext(archiveName);
    } catch (e) {
      return send(res, e.status || 404, { error: String(e.message || e) });
    }
    const set = safeSetName(body.set);
    const setDir = join(P().out, set);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${set}` });
    }
    const locale = resolveLocale(req, body);
    try {
      const result = await buildBundleZip({
        archive: releaseArchive(loaded.archive, loaded.preset, setDir),
        preset: loaded.preset,
        setDir,
        set,
        marks: readMarks(set),
        bundlesDir: bundlesDir(),
        opts: {
          format,
          profile: profileKey,
          creatorAddress: body.creatorAddress || null,
          zeroIndexed: Boolean(body.zeroIndexed || body.zeroIndex),
          onlyKeep: body.onlyKeep === undefined ? true : Boolean(body.onlyKeep),
          namePrefix: body.namePrefix || `${loaded.archive.presetId || "Series"} #`,
          symbol: body.symbol || profile.defaultSymbol || "LAB",
          sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? profile.defaultFee ?? 500,
          description: body.description || `${loaded.preset?.name || loaded.archive.presetId || "Series"} — Series Lab export`,
          imageUriPrefix: body.imageUriPrefix || "",
          animationUriPrefix: body.animationUriPrefix || "",
          locale,
          dryRun: true,
        },
      });
      return send(res, 200, {
        ok: true,
        ready: result.ready === true,
        count: result.count,
        chain: result.chain,
        profile: result.profile,
        preflight: result.preflight,
        report: result.preflight?.report || "",
      });
    } catch (e) {
      const status = e.status || (e.code === "bundle_select" || e.code === "bundle_empty" ? 400 : 500);
      return send(res, status, { error: String(e.message || e), code: e.code || "preflight", ready: false });
    }
  }

  if (pathname === "/api/export/provenance" && req.method === "GET") {
    const setName = safeSetName(url.searchParams.get("set") || url.searchParams.get("dir"));
    if (!setName) return send(res, 400, { error: "set parameter required" });
    const setDir = join(P().out, setName);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 404, { error: `set directory not found: ${setName}` });
    }
    const files = readdirSync(setDir);
    const images = [];
    for (const f of files) {
      const m = f.match(/^(\d+)\.(png|jpe?g|webp)$/i);
      if (m) images.push({ edition: Number(m[1]), path: join(setDir, f), file: f });
    }
    if (!images.length) {
      return send(res, 400, { error: `no image files found in set: ${setName}` });
    }
    const prov = calculateCollectionProvenance(images);
    return send(res, 200, { ok: true, set: setName, provenance: prov, duplicates: duplicateImages(prov.records), check: verifyProvenance(prov, setDir) });
  }

  if (pathname === "/api/export/dataset" && req.method === "POST") {
    trackFunnel("export", { kind: "dataset" });
    const body = await readBody(req);
    const archiveName = body.archive || body.file;
    if (!archiveName) return send(res, 400, { error: "archive required" });
    const { archive } = loadArchiveFile(archiveName);
    const setName = safeSetName(body.set);
    const setDir = join(P().out, setName);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${setName}` });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const marks = readMarks(setName);
    const triggerWord = body.triggerWord || body.trigger || "";
    const format = body.format === "prose" ? "prose" : "tags";
    const onlyKeep = body.onlyKeep === undefined ? false : Boolean(body.onlyKeep);

    mkdirSync(bundlesDir(), { recursive: true });
    const zipName = `dataset-${archive.presetId || "series"}-${setName}-${Date.now().toString(36)}.zip`;
    const outPath = join(bundlesDir(), zipName);

    try {
      const resData = await exportDatasetZip({
        archive,
        preset,
        setDir,
        marks,
        opts: {
          triggerWord,
          format,
          onlyKeep,
          outPath,
        },
      });
      return send(res, 200, {
        ok: true,
        file: zipName,
        path: `out/bundles/${zipName}`,
        downloadUrl: `/out/bundles/${zipName}`,
        count: resData.count,
        triggerWord: resData.triggerWord,
        format: resData.format,
      });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  return false;
}
