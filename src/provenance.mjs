import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Calculates SHA-256 hash of a file or buffer.
 * @param {string | Buffer} input - File path or buffer
 * @returns {string} Hex SHA-256 string
 */
export function calculateImageSha256(input) {
  const hash = crypto.createHash("sha256");
  if (Buffer.isBuffer(input)) {
    hash.update(input);
  } else if (typeof input === "string") {
    const data = fs.readFileSync(input);
    hash.update(data);
  } else {
    throw new TypeError("Input must be a buffer or a valid file path string");
  }
  return hash.digest("hex");
}

/**
 * Generates a collection-wide provenance record from an array of image descriptors.
 *
 * Each item in `images`:
 * { edition: number, file?: string, path?: string, buffer?: Buffer }
 *
 * Concatenates individual image sha256 strings in edition order, then hashes the result.
 *
 * @param {Array<{ edition: number, file?: string, path?: string, buffer?: Buffer }>} images
 * @returns {{
 *   provenanceHash: string,
 *   algorithm: string,
 *   count: number,
 *   concatenatedHashes: string,
 *   timestamp: string,
 *   records: Array<{ edition: number, file: string, sha256: string }>
 * }}
 */
export function calculateCollectionProvenance(images = [], extra = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("calculateCollectionProvenance requires a non-empty array of image records");
  }

  // Sort deterministically by edition ascending
  const sorted = [...images].sort((a, b) => Number(a.edition) - Number(b.edition));

  const records = [];
  let concatenated = "";

  for (const item of sorted) {
    const edition = Number(item.edition);
    const fileName = item.file || (item.path ? path.basename(item.path) : `${edition}.png`);
    let fileHash;

    if (item.buffer) {
      fileHash = calculateImageSha256(item.buffer);
    } else if (item.path) {
      fileHash = calculateImageSha256(item.path);
    } else {
      throw new Error(`Record for edition ${edition} lacks both path and buffer`);
    }

    records.push({
      edition,
      file: fileName,
      sha256: fileHash,
    });

    concatenated += fileHash;
  }

  const provenanceHash = crypto.createHash("sha256").update(concatenated).digest("hex");

  const record = {
    provenanceHash,
    algorithm: "sha256",
    count: records.length,
    concatenatedHashes: concatenated,
    timestamp: new Date().toISOString(),
    records,
  };
  if (extra?.presetSeed != null && String(extra.presetSeed) !== "") {
    record.presetSeed = String(extra.presetSeed);
  }
  return record;
}

/**
 * Verifies that the files in `targetDir` or provided file list match the recorded provenance.
 *
 * @param {{ provenanceHash: string, records: Array<{ edition: number, file: string, sha256: string }> }} provenanceData
 * @param {string | Map<string, Buffer>} targetDirOrBuffers - Directory path containing images or Map of filename -> Buffer
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function verifyProvenance(provenanceData, targetDirOrBuffers) {
  const errors = [];

  if (!provenanceData || !provenanceData.provenanceHash || !Array.isArray(provenanceData.records)) {
    return { valid: false, errors: ["Invalid provenance data structure"] };
  }

  let concatenated = "";

  for (const record of provenanceData.records) {
    const fileName = record.file;
    let actualHash = "";

    try {
      if (typeof targetDirOrBuffers === "string") {
        const filePath = path.join(targetDirOrBuffers, fileName);
        if (!fs.existsSync(filePath)) {
          errors.push(`File missing: ${fileName}`);
          continue;
        }
        actualHash = calculateImageSha256(filePath);
      } else if (targetDirOrBuffers instanceof Map) {
        const buf = targetDirOrBuffers.get(fileName);
        if (!buf) {
          errors.push(`Buffer missing for: ${fileName}`);
          continue;
        }
        actualHash = calculateImageSha256(buf);
      } else {
        errors.push("Invalid targetDirOrBuffers argument");
        break;
      }

      if (actualHash !== record.sha256) {
        errors.push(
          `Hash mismatch for edition #${record.edition} (${fileName}): expected ${record.sha256}, got ${actualHash}`
        );
      }
      concatenated += actualHash;
    } catch (err) {
      errors.push(`Error checking ${fileName}: ${err.message}`);
    }
  }

  const finalHash = crypto.createHash("sha256").update(concatenated).digest("hex");
  if (finalHash !== provenanceData.provenanceHash) {
    errors.push(
      `Provenance hash mismatch: expected ${provenanceData.provenanceHash}, recomputed ${finalHash}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
