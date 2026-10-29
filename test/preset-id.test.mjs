// A preset id becomes a file name. The studio turns a typed name into a Latin id (Ukrainian is transliterated), and the validation
// refuses an id that is not one (BETA-REVIEW B5: "тест" and "my heroes" used to pass as «Перевірка OK»).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ID_PATTERN, slugifyId, transliterate } from "../server/ui/slug.js";
import { PRESET_ID_PATTERN, validatePresetSemantics } from "../src/validate.mjs";

const preset = (id) => ({ id, traits: { items: [{ key: "hair", options: [{ value: "Short", weight: 1 }] }] } });

describe("slugifyId", () => {
  it("transliterates Ukrainian names instead of returning an empty slug", () => {
    assert.equal(slugifyId("Мої герої"), "moi-heroi");
    assert.equal(slugifyId("Тест"), "test");
    assert.equal(slugifyId("Щасливий їжак"), "shchaslyvyi-izhak");
    assert.equal(slugifyId("Ґанок"), "ganok");
    assert.equal(slugifyId("Єва"), "ieva");
  });
  it("keeps Latin names, collapses everything else to single dashes and trims", () => {
    assert.equal(slugifyId("My Heroes!"), "my-heroes");
    assert.equal(slugifyId("  Мій NFT #1 "), "mii-nft-1");
    assert.equal(slugifyId("a___b"), "a-b");
  });
  it("answers an empty string when nothing usable is left, and caps the length at 64", () => {
    assert.equal(slugifyId("!!!"), "");
    assert.equal(slugifyId(""), "");
    assert.equal(slugifyId(null), "");
    assert.equal(slugifyId("x".repeat(100)).length, 64);
  });
  it("transliterate leaves non-Cyrillic text as it is and drops the soft sign and apostrophe", () => {
    assert.equal(transliterate("Abc 123"), "Abc 123");
    assert.equal(transliterate("п'ять"), "piat");
    assert.equal(transliterate("день"), "den");
  });
  it("every slug it makes is a valid id (or empty)", () => {
    for (const name of ["Мої герої", "Тест 2", "!!!", "Ürün", "日本語", "Hello, World"]) {
      const s = slugifyId(name);
      assert.ok(s === "" || ID_PATTERN.test(s), `${name} -> ${s}`);
    }
  });
});

describe("the id rule", () => {
  it("the browser and the server use the same pattern", () => {
    assert.equal(ID_PATTERN.source, PRESET_ID_PATTERN.source);
  });
  it("refuses Cyrillic, spaces and a leading dot, with the id in the message", () => {
    for (const id of ["тест", "my heroes", ".hidden", "-dash", "a/b", "a\\b", ""]) {
      const r = validatePresetSemantics(preset(id));
      assert.equal(r.ok, false, `"${id}" must be refused`);
      assert.match(String(r.errors), /preset id/);
    }
  });
  it("accepts Latin letters, digits, dot, dash and underscore", () => {
    for (const id of ["test", "my-heroes", "Demo_1.v2", "a", "7up", "pfp-portrait"]) {
      assert.equal(validatePresetSemantics(preset(id)).ok, true, id);
    }
  });
  it("a preset without an id is not judged here (the schema decides)", () => {
    assert.equal(validatePresetSemantics({ traits: { items: [] } }).ok, true);
  });
});
