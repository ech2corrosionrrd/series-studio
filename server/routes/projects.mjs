// projects: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleProjectRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { describeProjects, isProject, listDeletedProjects, moveSetBetweenProjects, projectAssetStats, projectQuota, projectsConfig, purgeDeletedProject, readActiveProject, saveProjects, trashDaysLeft, trashProject, trashRetentionDays, writeActiveProject } from "../../src/projects.mjs";
import { httpError, readBody, send } from "../http.mjs";
import { isAdmin } from "../../src/platform/ops.mjs";
import { join } from "node:path";
import { send as sendResponse } from "../http.mjs";

export async function handleProjectRoutes(ctx) {
  const { req, res, url, pathname, P, PUBLIC_MODE, currentWallet, restoreProjectFromTrash, safeSetName, storageInfo, walletProjects } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/projects" && req.method === "GET") {
    const list = walletProjects();
    const cfg = projectsConfig();
    const quota = projectQuota(list, cfg);
    const exempt = !PUBLIC_MODE || isAdmin(currentWallet());
    const rows = describeProjects(P(), list).map((p) => ({ ...p, assets: projectAssetStats(P(), p.file) }));
    return send(res, 200, {
      projects: rows,
      deleted: listDeletedProjects(P()).map((d) => ({ ...d, daysLeft: trashDaysLeft(d.at) })),
      trashDays: trashRetentionDays(),
      active: readActiveProject(P()),
      assetsPerProject: PUBLIC_MODE,
      storage: storageInfo(),
      quota: { ...quota, needsCharge: exempt ? false : quota.needsCharge, exempt },
    });
  }

  if (pathname === "/api/projects/open" && req.method === "POST") {
    const body = await readBody(req);
    const file = String(body.file || "");
    const list = walletProjects();
    if (!isProject(list, file)) return send(res, 404, { error: "project not found" });
    writeActiveProject(P(), file); // every asset route now works on this project (base, layers, sets, archive)
    return send(res, 200, { ok: true, active: file });
  }

  if (pathname === "/api/projects/move-set" && req.method === "POST") {
    const body = await readBody(req);
    const from = String(body.from || readActiveProject(P()) || "");
    const to = String(body.to || "");
    const list = walletProjects();
    if (!PUBLIC_MODE) throw httpError(400, "projects keep separate sets only on the hosted studio");
    if (!isProject(list, from) || !isProject(list, to)) return send(res, 404, { error: "project not found" });
    try {
      return send(res, 200, { ok: true, ...moveSetBetweenProjects(P(), from, to, safeSetName(body.dir || "")) });
    } catch (e) {
      throw e.status ? httpError(e.status, e.message) : e;
    }
  }

  if (pathname === "/api/projects/delete" && req.method === "POST") {
    const body = await readBody(req);
    const file = String(body.file || "");
    if (!/^[a-zA-Z0-9._-]+\.json$/.test(file) || file.includes("..")) throw httpError(400, "bad file");
    const list = walletProjects();
    if (!isProject(list, file)) return send(res, 404, { error: "project not found" });
    if (body.confirm !== true) throw httpError(400, "confirmation required");
    // Reversible: the preset, the recipe archive and the project's own base image, layers and frame sets go to the trash together.
    const trashId = trashProject(P(), file, { legacyArchive: PUBLIC_MODE ? null : join(P().out, file) });
    const next = list.filter((p) => p.file !== file);
    saveProjects(P(), next);
    if (readActiveProject(P()) === file) writeActiveProject(P(), next[0]?.file || null);
    return send(res, 200, { ok: true, file, trashId, active: readActiveProject(P()), quota: projectQuota(next, projectsConfig()) });
  }

  if (pathname === "/api/projects/purge" && req.method === "POST") {
    const body = await readBody(req);
    if (body.confirm !== true) throw httpError(400, "confirmation required");
    try {
      purgeDeletedProject(P(), String(body.id || ""));
    } catch (e) {
      throw e.status ? httpError(e.status, e.message) : e;
    }
    return send(res, 200, { ok: true, id: String(body.id) });
  }

  if (pathname === "/api/projects/restore" && req.method === "POST") {
    const body = await readBody(req);
    const done = restoreProjectFromTrash(String(body.id || ""), body);
    return send(res, 200, { ok: true, ...done, project: { new: true, charged: done.charged } });
  }

  return false;
}
