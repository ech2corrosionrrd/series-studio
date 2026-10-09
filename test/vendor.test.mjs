import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Keypair, SystemProgram, Transaction as RealTransaction } from "@solana/web3.js";
import { selfHostLoginImports } from "../server/platform.mjs";
import { buildCsp } from "../src/csp.mjs";

const vendor = (name) => resolve("server/ui/vendor", name);

test("EVM address helper matches the EIP-55 reference vectors", async () => {
  const { isAddress, getAddress, checksumAddress } = await import(pathToFileURL(vendor("evm-address.js")).href);
  const vectors = [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ];
  for (const v of vectors) {
    assert.equal(checksumAddress(v.toLowerCase()), v);
    assert.equal(getAddress(v.toLowerCase()), v);
    assert.equal(isAddress(v), true);
    assert.equal(isAddress(v.toLowerCase()), true, "all-lowercase is accepted");
  }
  // один символ іншого регістру ламає контрольну суму
  const bad = vectors[0].replace("aAeb", "AAeb");
  assert.equal(isAddress(bad), false);
  assert.equal(isAddress(bad, { strict: false }), true);
  for (const junk of ["", "0x", "0x123", "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xZZAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", null, 42]) {
    assert.equal(isAddress(junk), false, String(junk));
  }
  assert.throws(() => getAddress("0x123"), /invalid/i);
});

test("the bundled Transaction decodes what the real web3.js serializes", async () => {
  const { Transaction } = await import(pathToFileURL(vendor("solana-tx.js")).href);
  const payer = Keypair.generate();
  const tx = new RealTransaction({ feePayer: payer.publicKey, recentBlockhash: "11111111111111111111111111111111" }).add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1234 }),
  );
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const decoded = Transaction.from(raw);
  assert.equal(decoded.instructions.length, 1);
  assert.equal(decoded.feePayer.toBase58(), payer.publicKey.toBase58());
  assert.ok(Buffer.from(decoded.serialize({ requireAllSignatures: false, verifySignatures: false })).equals(Buffer.from(raw)));
});

test("no page loads code from a third-party CDN any more", () => {
  const app = readFileSync("server/ui/app.js", "utf8");
  assert.doesNotMatch(app, /esm\.sh/);
  assert.match(app, /\.\/vendor\/solana-tx\.js/);
  for (const f of readdirSync("server/ui/vendor")) assert.doesNotMatch(readFileSync(`server/ui/vendor/${f}`, "utf8"), /https?:\/\/esm\.sh/);
  const html = selfHostLoginImports('import { isAddress, getAddress } from "https://esm.sh/viem@2";');
  assert.equal(html, 'import { isAddress, getAddress } from "/studio/vendor/evm-address.js";');
  for (const path of ["/studio/", "/login"]) assert.doesNotMatch(buildCsp(path), /esm\.sh/);
});
