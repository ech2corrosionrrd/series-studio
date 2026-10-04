/**
 * Fails fast, with a readable message, on a Node that is older than package.json "engines".
 * Import it FIRST in every entry point: ES module imports run in order, so this runs
 * before modules that use newer APIs (node:sqlite, fetch streams) and would fail with a cryptic error.
 */
export const MIN_NODE = [22, 13];

export function nodeVersionOk(version = process.versions.node, min = MIN_NODE) {
  const [major, minor] = String(version).split(".").map(Number);
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

if (!nodeVersionOk()) {
  console.error(`Series Lab needs Node ${MIN_NODE.join(".")} or newer (22 or 24 recommended); this shell runs Node ${process.versions.node}.`);
  console.error("Switch the shell first (for example: fnm use 24, nvm use 24), then run npm test / npm start again.");
  process.exit(1);
}
