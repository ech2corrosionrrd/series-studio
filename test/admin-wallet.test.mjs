import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_WALLET,
  DEFAULT_TEAM_WALLETS,
  isAdmin,
  isInternal,
} from "../src/platform/ops.mjs";

const TEAM_ONLY = "DE1gBEaqA11uYdySmF5LRmN8QsvXvnYJYHDVXeAY15Vh";
const EXTRA = "0x1111111111111111111111111111111111111111";

function withEnv(patch, fn) {
  const keys = ["ADMIN_WALLETS", "TEAM_WALLETS", "OPERATOR_WALLET", "DOGFOOD_WALLETS"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, patch);
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("unset ADMIN_WALLETS keeps the default operator as admin", () => {
  withEnv({}, () => {
    assert.equal(isAdmin(ADMIN_WALLET), true);
    assert.equal(isAdmin(TEAM_ONLY), false);
    assert.equal(isAdmin(EXTRA), false);
  });
});

test("ADMIN_WALLETS replaces the default operator instead of only adding", () => {
  withEnv({ ADMIN_WALLETS: EXTRA }, () => {
    assert.equal(isAdmin(ADMIN_WALLET), false);
    assert.equal(isAdmin(EXTRA), true);
  });
});

test("ADMIN_WALLETS can list the operator plus further admins", () => {
  withEnv({ ADMIN_WALLETS: `${ADMIN_WALLET},${EXTRA}` }, () => {
    assert.equal(isAdmin(ADMIN_WALLET), true);
    assert.equal(isAdmin(EXTRA), true);
  });
});

test("empty ADMIN_WALLETS removes every admin", () => {
  withEnv({ ADMIN_WALLETS: "" }, () => {
    assert.equal(isAdmin(ADMIN_WALLET), false);
    assert.equal(isAdmin(EXTRA), false);
  });
});

test("unset TEAM_WALLETS keeps the default team as internal", () => {
  withEnv({}, () => {
    for (const w of DEFAULT_TEAM_WALLETS) assert.equal(isInternal(w), true, w);
    assert.equal(isInternal(EXTRA), false);
    assert.equal(isAdmin(TEAM_ONLY), false);
  });
});

test("TEAM_WALLETS replaces the default team list; the default admin stays internal", () => {
  withEnv({ TEAM_WALLETS: EXTRA }, () => {
    assert.equal(isInternal(EXTRA), true);
    assert.equal(isInternal(TEAM_ONLY), false);
    assert.equal(isAdmin(ADMIN_WALLET), true);
    assert.equal(isInternal(ADMIN_WALLET), true, "whoever is admin is internal");
  });
});

test("an admin from ADMIN_WALLETS is internal even when missing from TEAM_WALLETS", () => {
  withEnv({ ADMIN_WALLETS: EXTRA, TEAM_WALLETS: TEAM_ONLY }, () => {
    assert.equal(isAdmin(EXTRA), true);
    assert.equal(isInternal(EXTRA), true);
    assert.equal(isInternal(TEAM_ONLY), true);
    assert.equal(isInternal(ADMIN_WALLET), false);
    assert.equal(isAdmin(ADMIN_WALLET), false);
  });
});

test("OPERATOR_WALLET and DOGFOOD_WALLETS still add internal wallets", () => {
  withEnv({ OPERATOR_WALLET: EXTRA, DOGFOOD_WALLETS: "0x2222222222222222222222222222222222222222" }, () => {
    assert.equal(isInternal(EXTRA), true);
    assert.equal(isInternal("0x2222222222222222222222222222222222222222"), true);
    assert.equal(isAdmin(EXTRA), false);
  });
});
