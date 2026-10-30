// layers: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleLayerRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { CSV_LIMITS, mergeTraitItems, traitsFromCsv, traitsFromLayerFiles, traitsToCsv } from "../../src/traits-import.mjs";
import { LAYER_LIMITS, LayersZipError, clearLayers, importLayersZip, layerRelPaths, layersStatus, listLayerFiles } from "../../src/layers-zip.mjs";
import { basename, join, resolve } from "node:path";
import { previewEdition } from "../../src/layers.mjs";
import { startLayersJob } from "../../src/layers-job.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { frameOffsetFor, readFrameOffsets, writeFrameOffset } from "../../src/frame-offsets.mjs";
import { isInsideDir } from "../../src/fs-safe.mjs";
import { attachStopOnDisconnect, readBody, send as sendResponse, writeSse } from "../http.mjs";

/** Projects that have a bulk compose running, and how many run at all: a thousand frames is minutes of one CPU core. */
const composing = new Set();
const MAX_COMPOSE_JOBS = 2;

export async function handleLayerRoutes(ctx) {
  const { req, res, url, pathname, P, assertWalletDisk, forgetDiskUsage, baseStatus, loadPresetByFile, loadSeriesContext, readRawBody, rejectSecrets, safeSetName, toTrash } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  /**
   * The bulk compose (every frame of a series) on a worker thread. With `Accept: text/event-stream` the answer is a live
   * stream (`start`, `progress`, then `done` or `error`); without it the same work ends in the JSON the old call returned.
   * Closing the connection (the Stop button) stops the job between frames and keeps what was composed.
   */
  /** Size of the biggest PNG among the first few of a set: what one composed frame will weigh. */
  const setFrameBytes = (dir) => {
    try {
      return Math.max(0, ...readdirSync(dir).filter((f) => /^\d+\.png$/i.test(f)).slice(0, 5).map((f) => statSync(join(dir, f)).size));
    } catch {
      return 0;
    }
  };

  async function runBulkCompose(kind, args, total, finish, frameBytes = 0) {
    // every frame is about as large as the picture it is drawn on: refuse now, with numbers, instead of failing half way
    try {
      assertWalletDisk(total * frameBytes);
    } catch (e) {
      return send(res, e.status || 413, { error: String(e.message || e), code: e.code || "disk_quota" });
    }
    const key = P().root;
    if (composing.has(key)) return send(res, 409, { error: "A compose of this project is already running.", code: "compose_busy" });
    if (composing.size >= MAX_COMPOSE_JOBS) return send(res, 503, { error: "The server is composing other series now; try again in a minute.", code: "compose_capacity" });
    composing.add(key);
    const stream = String(req.headers.accept || "").includes("text/event-stream");
    const stop = new AbortController();
    let job;
    try {
      if (stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
        res.flushHeaders?.();
        writeSse(res, { type: "start", total });
      }
      job = startLayersJob(kind, args, { onProgress: (p) => stream && writeSse(res, { type: "progress", ...p }) });
      attachStopOnDisconnect(res, stop);
      stop.signal.addEventListener("abort", () => job.stop());
      const report = await job.promise;
      forgetDiskUsage?.(); // the worker wrote these: the next quota check walks the folder again
      const payload = finish(report);
      if (stream) {
        writeSse(res, { type: "done", ...payload });
        res.end();
      } else {
        send(res, 200, payload);
      }
    } catch (e) {
      const message = String(e.message || e);
      if (stream) {
        writeSse(res, { type: "error", error: message, code: "compose" });
        res.end();
      } else {
        send(res, 400, { error: message, code: "compose" });
      }
    } finally {
      composing.delete(key);
    }
    return true;
  }

  // ---- PNG layers as a ZIP (the hosted studio gives the user no file system) ----
  /** Traits that the coverage is measured against: the built archive's preset, or (Constructor, before any recipes) a saved preset. */
  const layerTraitItems = () => {
    const archiveName = url.searchParams.get("archive");
    const presetName = url.searchParams.get("preset");
    try {
      if (archiveName) return loadSeriesContext(archiveName).preset?.traits?.items || null;
      if (presetName) return loadPresetByFile(presetName).preset?.traits?.items || null;
    } catch {
      /* no such series: no coverage */
    }
    return null;
  };

  if (pathname === "/api/layers/status" && req.method === "GET") {
    return send(res, 200, { ok: true, limits: LAYER_LIMITS, ...layersStatus(P().layers, layerTraitItems()) });
  }

  if (pathname === "/api/layers/upload" && req.method === "POST") {
    try {
      const buffer = await readRawBody(req, LAYER_LIMITS.zipBytes);
      assertWalletDisk(buffer.length * 2); // the ZIP is unpacked into the layers folder
      const result = await importLayersZip(buffer, P().layers, {
        clear: url.searchParams.get("clear") === "1",
        // Replacing is reversible: the old layers go to the trash (Resources → Trash), like other deletions.
        onClear: (dir) => {
          const old = listLayerFiles(dir);
          if (old.length) toTrash(old, "layers replaced");
        },
      });
      return send(res, 200, { ok: true, ...result, status: layersStatus(P().layers, layerTraitItems()) });
    } catch (e) {
      if (e instanceof LayersZipError) return send(res, e.status, { error: e.message, code: `layers_${e.code}` });
      throw e;
    }
  }

  // Зсув шарів для одного кадру набору (`<набір>/layer-offsets.json`); 0/0 знімає його. Нічого не видаляє.
  if (pathname === "/api/layers/frame-offset" && req.method === "POST") {
    const body = await readBody(req);
    let setName;
    try {
      setName = safeSetName(body.set || body.dir || "");
    } catch {
      return send(res, 400, { error: "bad set name" });
    }
    if (!setName) return send(res, 400, { error: "set required" });
    const setDir = join(P().out, setName);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: `set directory not found: ${setName}` });
    if (!/^[1-9]\d{0,8}$/.test(String(body.edition ?? ""))) return send(res, 400, { error: "edition must be a whole number from 1" });
    try {
      const { offset, offsets } = writeFrameOffset(setDir, Number(body.edition), body.x, body.y);
      return send(res, 200, { ok: true, set: setName, edition: Number(body.edition), offset, frames: Object.keys(offsets).length });
    } catch (e) {
      return send(res, 400, { error: String(e.message || e) });
    }
  }

  if (pathname === "/api/layers/clear" && req.method === "POST") {
    const old = listLayerFiles(P().layers);
    const trashed = old.length ? toTrash(old, "layers cleared") : null;
    clearLayers(P().layers);
    return send(res, 200, { ok: true, removed: old.length, trashId: trashed?.id ?? null });
  }

  // Trait table from the layers folder or a CSV sheet. Both merge into `items` (the table in the editor) and
  // return the result; nothing is saved here, the author reviews it and saves the preset as usual.
  if (pathname === "/api/traits/from-layers" && req.method === "POST") {
    const body = await readBody(req);
    if (body.items !== undefined && !Array.isArray(body.items)) return send(res, 400, { error: "items must be an array" });
    const { items: found, skipped } = traitsFromLayerFiles(layerRelPaths(P().layers));
    if (!found.length) return send(res, 400, { error: "no layer PNGs found: upload a ZIP of <trait>/<value>.png first", code: "no_layers" });
    const merged = mergeTraitItems(body.items || [], found, { overwrite: false });
    // `replace`: the table becomes what the layers folder holds (typed weights and prompts of the same values stay);
    // without it, what has no layer is only reported, so a hybrid series keeps the traits the model draws.
    const files = new Set(layerRelPaths(P().layers));
    const has = (t, o) => files.has(o.layer || `${t.key}/${o.value}.png`);
    const without = [];
    let items = merged.items;
    let traitsRemoved = 0;
    let optionsRemoved = 0;
    if (body.replace === true) {
      const keep = new Map(found.map((t) => [t.key, new Set(t.options.map((o) => String(o.value)))]));
      items = items.filter((t) => keep.has(t.key));
      traitsRemoved = merged.items.length - items.length;
      for (const t of items) {
        const before = t.options.length;
        t.options = t.options.filter((o) => keep.get(t.key).has(String(o.value)) || has(t, o));
        optionsRemoved += before - t.options.length;
      }
    } else {
      for (const t of items) for (const o of t.options || []) if (!has(t, o)) without.push(`${t.key}/${o.value}`);
    }
    return send(res, 200, { ok: true, items, ...merged.stats, traitsRemoved, optionsRemoved, withoutLayers: without.slice(0, 20), withoutLayersCount: without.length, skipped: skipped.slice(0, 20), skippedCount: skipped.length });
  }

  if (pathname === "/api/traits/from-csv" && req.method === "POST") {
    const body = await readBody(req);
    if (typeof body.csv !== "string" || !body.csv.trim()) return send(res, 400, { error: "csv text is required" });
    if (body.items !== undefined && !Array.isArray(body.items)) return send(res, 400, { error: "items must be an array" });
    if (body.csv.length > CSV_LIMITS.chars) return send(res, 413, { error: `csv is larger than ${CSV_LIMITS.chars} characters` });
    const parsed = traitsFromCsv(body.csv);
    if (parsed.errors.length) {
      return send(res, 400, { error: `row ${parsed.errors[0].row}: ${parsed.errors[0].message}`, code: "csv", errors: parsed.errors.slice(0, 10), errorCount: parsed.errors.length });
    }
    const merged = mergeTraitItems(body.items || [], parsed.items, { overwrite: true });
    return send(res, 200, { ok: true, items: merged.items, ...merged.stats });
  }

  if (pathname === "/api/traits/to-csv" && req.method === "POST") {
    const body = await readBody(req);
    if (!Array.isArray(body.items)) return send(res, 400, { error: "items must be an array" });
    return send(res, 200, { ok: true, csv: traitsToCsv(body.items) });
  }

  if (pathname === "/api/compose" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return;
    let loaded;
    try {
      loaded = loadSeriesContext(body.archive || body.file);
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
    const items = loaded.preset?.traits?.items;
    if (!Array.isArray(items) || !items.length) {
      return send(res, 400, { error: "preset traits are required to compose layers" });
    }
    const root = resolve(P().root);
    const layerDir = body.layers ? resolve(root, String(body.layers)) : resolve(P().layers);
    if (!isInsideDir(root, layerDir)) {
      return send(res, 400, { error: "layers directory must stay inside the project" });
    }
    if (!existsSync(layerDir)) {
      return send(res, 400, { error: `layers directory not found: ${layerDir}` });
    }
    // Перегляд одного кадру: складаємо одне видання в пам'яті, нічого не пишемо на диск.
    const previewing = body.preview !== undefined && body.preview !== null && body.preview !== "";
    if (previewing && !/^\d{1,9}$/.test(String(body.preview))) {
      return send(res, 400, { error: "preview must be an edition number" });
    }
    // Гібрид: ручні шари поверх кадрів, які вже намалювала модель (набір `out/<over>`).
    if (body.over) {
      let setName;
      try {
        setName = safeSetName(body.over);
      } catch {
        return send(res, 400, { error: "bad set name" });
      }
      const setDir = join(P().out, setName);
      if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
        return send(res, 404, { error: `set directory not found: ${setName}` });
      }
      const only = Array.isArray(body.only) ? body.only.map((k) => String(k)).filter((k) => items.some((i) => i.key === k)) : null;
      const outName = `${setName}-layers`;
      // Підгонка шару під кадр (`layerAlign` на рисі) порівнює кадр із базою, на якій шар намальовано.
      let alignRef = null;
      if (items.some((i) => i.layerAlign === true)) {
        const alignName = body.base ? basename(String(body.base)) : baseStatus().file;
        const alignPath = alignName ? join(P().input, alignName) : "";
        if (alignPath && existsSync(alignPath)) alignRef = readFileSync(alignPath);
      }
      if (previewing) {
        const frameFile = join(setDir, `${Number(body.preview)}.png`);
        if (!existsSync(frameFile)) {
          return send(res, 404, { error: `frame not found: ${setName}/${Number(body.preview)}.png` });
        }
        try {
          const frameOffset = frameOffsetFor(readFrameOffsets(setDir), body.preview);
          const frame = previewEdition({ archive: loaded.archive, items, edition: body.preview, basePng: readFileSync(frameFile), layerDir, only, skipMissing: true, alignRef, frameOffset });
          return send(res, 200, {
            ok: true,
            mode: "preview",
            over: setName,
            edition: Number(body.preview),
            layers: frame.layers.filter((l) => l !== "base"),
            skipped: frame.skipped,
            align: frame.align,
            frameOffset,
            sha256: frame.sha256,
            png: `data:image/png;base64,${frame.png.toString("base64")}`,
          });
        } catch (e) {
          return send(res, e.status || 400, { error: String(e.message || e), code: "compose" });
        }
      }
      const recipeCount = loaded.archive?.recipes?.length || 0;
      return runBulkCompose(
        "overlay",
        { archive: loaded.archive, items, setDir, layerDir, outDir: join(P().out, outName), only, limit: body.limit, alignRef },
        body.limit ? Math.min(Number(body.limit), recipeCount) : recipeCount,
        (report) => ({
          ok: true,
          mode: "overlay",
          count: report.count,
          ...(report.stopped ? { stopped: true, total: report.total } : {}),
          painted: report.painted,
          unpainted: report.unpainted,
          aligned: report.aligned,
          alignSkipped: report.alignSkipped,
          frameOffsetFrames: report.frameOffsetFrames,
          missingFrames: report.missingFrames.slice(0, 20),
          missingFramesCount: report.missingFrames.length,
          dir: `out/${outName}`,
          set: outName,
        }),
        setFrameBytes(setDir),
      );
    }
    const base = baseStatus();
    const baseName = body.base ? basename(String(body.base)) : base.file;
    const basePath = join(P().input, baseName);
    if (!existsSync(basePath)) {
      return send(res, 400, { error: `base image not found: input/${baseName}` });
    }
    if (previewing) {
      try {
        const frame = previewEdition({ archive: loaded.archive, items, edition: body.preview, basePng: readFileSync(basePath), layerDir });
        return send(res, 200, {
          ok: true,
          mode: "preview",
          over: null,
          edition: Number(body.preview),
          layers: frame.layers.filter((l) => l !== "base"),
          skipped: frame.skipped,
          sha256: frame.sha256,
          png: `data:image/png;base64,${frame.png.toString("base64")}`,
        });
      } catch (e) {
        return send(res, e.status || 400, { error: String(e.message || e), code: "compose" });
      }
    }
    const outDir = join(P().out, "layers");
    const recipeCount = loaded.archive?.recipes?.length || 0;
    return runBulkCompose(
      "compose",
      { archive: loaded.archive, items, basePng: readFileSync(basePath), layerDir, outDir, limit: body.limit },
      body.limit ? Math.min(Number(body.limit), recipeCount) : recipeCount,
      (report) => ({ ok: true, count: report.count, ...(report.stopped ? { stopped: true, total: report.total } : {}), dir: "out/layers", editions: report.editions }),
      statSync(basePath).size,
    );
  }

  return false;
}
