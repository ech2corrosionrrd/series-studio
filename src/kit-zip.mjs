import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import JSZip from "jszip";

/** Write a flat map of path → string|Buffer into a zip file. */
export async function writeFilesZip(files, absPath) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files || {})) {
    if (data == null) continue;
    zip.file(name, data);
  }
  mkdirSync(dirname(absPath), { recursive: true });
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  writeFileSync(absPath, buf);
  return buf.length;
}
