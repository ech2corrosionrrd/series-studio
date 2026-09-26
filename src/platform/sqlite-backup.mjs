/**
 * Online SQLite snapshot.
 * `node:sqlite` exports `backup` from Node 22.16 and Node 24.
 * Older 22.x (the package allows >=22.13) falls back to VACUUM INTO, which
 * writes a consistent copy without modifying the source.
 */
import * as sqlite from "node:sqlite";

export const { DatabaseSync } = sqlite;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function backupDatabase(src, destPath) {
  if (typeof sqlite.backup === "function") return sqlite.backup(src, destPath);
  src.exec(`VACUUM INTO ${sqlString(destPath)}`);
  return 0;
}
