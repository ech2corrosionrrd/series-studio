/**
 * Where a set of frames came from. A hybrid compose (`overlaySet`) writes `<set>-layers` with a `dna.json` whose `source` is
 * `layers-over-set` and whose `over` names the set the layers were painted over. Reading that back lets Review show
 * "painted over set X (N of M changed)" on the new set and "a layers version exists: Y" on the original.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function readReport(dir) {
  const file = join(dir, "dna.json");
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return doc && doc.source === "layers-over-set" && typeof doc.over === "string" ? doc : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} outDir the folder that holds the sets
 * @param {string} name the set to describe
 * @returns {{ derivedFrom: { set: string, painted: number, count: number }|null, derived: Array<{ set: string, painted: number, count: number }> }}
 */
export function readSetLineage(outDir, name) {
  const info = (setName, r) => ({ set: setName, painted: Number(r.painted) || 0, count: Number(r.count) || 0 });
  const own = readReport(join(outDir, name));
  const derived = [];
  if (existsSync(outDir)) {
    for (const entry of readdirSync(outDir)) {
      if (entry === name) continue;
      const dir = join(outDir, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const r = readReport(dir);
      if (r && r.over === name) derived.push(info(entry, r));
    }
  }
  return { derivedFrom: own ? info(own.over, own) : null, derived: derived.sort((a, b) => a.set.localeCompare(b.set)) };
}
