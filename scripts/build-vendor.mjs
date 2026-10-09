#!/usr/bin/env node
/**
 * Збирає браузерні бібліотеки з наших залежностей у server/ui/vendor/, щоб сторінки студії й входу
 * не підтягували код із чужої CDN (раніше https://esm.sh). Результат комітиться в репозиторій:
 * на сервері нічого збирати не треба. Перезбирати після оновлення @solana/web3.js або @noble/hashes:
 *   npm run vendor
 */
import { build } from "esbuild";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jobs = [
  { entry: "scripts/vendor/solana-tx.entry.mjs", out: "server/ui/vendor/solana-tx.js", what: "@solana/web3.js (Transaction)" },
  { entry: "scripts/vendor/evm-address.entry.mjs", out: "server/ui/vendor/evm-address.js", what: "перевірка адреси EVM (EIP-55)" },
];

for (const j of jobs) {
  await build({
    entryPoints: [join(root, j.entry)],
    outfile: join(root, j.out),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    define: { global: "globalThis", "process.env.NODE_ENV": '"production"' },
    banner: { js: `/* Згенеровано scripts/build-vendor.mjs (${j.what}). Не редагувати вручну: npm run vendor. */` },
    logLevel: "warning",
  });
  console.log(`${j.out}  ${(statSync(join(root, j.out)).size / 1024).toFixed(0)} KB  ${j.what}`);
}
