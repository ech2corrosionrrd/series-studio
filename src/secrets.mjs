/**
 * Refuse bodies that try to hand the server a key or a reveal password.
 * Public addresses are fine. Series Lab never stores these values.
 */

const SECRET_FIELD = /^(privatekey|secretkey|mnemonic|seedphrase|secret|password)$/i;

export function containsSecretField(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return false;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return false;
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_FIELD.test(key) && inner) return true;
    if (inner && typeof inner === "object" && containsSecretField(inner, depth + 1)) return true;
  }
  return false;
}

export function assertNoSecrets(value) {
  if (!containsSecretField(value)) return;
  const err = new Error("Series Lab does not accept private keys, seed phrases, or secrets. Sign from your own wallet.");
  err.status = 400;
  err.code = "secrets";
  throw err;
}
