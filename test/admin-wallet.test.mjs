import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_WALLET, isAdmin } from "../src/platform/ops.mjs";

test("the operator wallet is admin even when ADMIN_WALLETS is empty", () => {
  const prev = process.env.ADMIN_WALLETS;
  delete process.env.ADMIN_WALLETS;
  try {
    assert.equal(isAdmin(ADMIN_WALLET), true);
    assert.equal(isAdmin("0x25267d871267bf1c2478d47d167aa6237fab1d1c"), false);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_WALLETS;
    else process.env.ADMIN_WALLETS = prev;
  }
});

test("ADMIN_WALLETS adds further admins without removing the operator", () => {
  const prev = process.env.ADMIN_WALLETS;
  process.env.ADMIN_WALLETS = "0x25267d871267bf1c2478d47d167aa6237fab1d1c";
  try {
    assert.equal(isAdmin(ADMIN_WALLET), true);
    assert.equal(isAdmin("0x25267d871267bf1c2478d47d167aa6237fab1d1c"), true);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_WALLETS;
    else process.env.ADMIN_WALLETS = prev;
  }
});
