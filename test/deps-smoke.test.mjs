// The dependencies pinned through `overrides` in package.json (uuid under jayson, csv-parse under @irys/upload) still do their job:
// a Solana RPC round trip through @solana/web3.js, and the CSV parser of the Irys uploader. Local server only, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("@solana/web3.js talks JSON-RPC (jayson with the pinned uuid)", async () => {
  const { Connection, Keypair } = require("@solana/web3.js");
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const rpc = JSON.parse(body);
      seen.push(rpc.method);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { context: { slot: 1 }, value: 7_000_000 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const connection = new Connection(`http://127.0.0.1:${server.address().port}`);
    const lamports = await connection.getBalance(Keypair.generate().publicKey);
    assert.equal(lamports, 7_000_000);
    assert.deepEqual(seen, ["getBalance"]);
  } finally {
    server.close();
  }
});

test("the uploader's CSV parser works (csv-parse 7)", async () => {
  const { parse } = await import("csv-parse/sync");
  assert.deepEqual(parse("a,b\n1,2\n", { columns: true }), [{ a: "1", b: "2" }]);
});
