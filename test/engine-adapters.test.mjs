// Contract tests for the provider adapters, with no network: a fake fetch plays the provider.
// They pin what we SEND (host, auth header, the fields a provider needs, the strength scale) and how we READ replies
// (binary, base64 JSON, URL download, queued prediction) and how errors surface (provider named, status and body kept).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENGINES, TXT2IMG } from "../src/engines.mjs";
import { createMockPng } from "../src/mock-image.mjs";

const IMG = createMockPng({ seed: 5, title: "frame" });
const BASE = createMockPng({ seed: 9, title: "base" });

/** @param {(url: string, init: any) => Response | Promise<Response>} handler */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const png = (body = IMG) => new Response(body, { status: 200, headers: { "content-type": "image/png" } });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const fail = (status, body) => new Response(body, { status });
const formEntries = (init) => Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `[file ${v.type}]`]));
const input = (extra = {}) => ({ prompt: "a red hat", image: BASE, mime: "image/png", seed: 7, strength: 0.45, ...extra });

describe("missing key: every cloud engine refuses before touching the network", () => {
  const cloud = [
    ["edit", ENGINES, ["kontext", "fal", "openai", "stability", "pollinations"]],
    ["txt2img", TXT2IMG, ["openai", "fal", "stability", "pollinations", "kontext", "schnell"]],
  ];
  for (const [kind, table, names] of cloud) {
    for (const name of names) {
      it(`${kind}/${name}`, async () => {
        if (!table[name]) return; // a name the table does not have is not a contract
        const f = fakeFetch(() => assert.fail("must not call the network without a key"));
        await assert.rejects(table[name].generate(input(), { fetch: f, env: {} }), /missing|key|token/i);
        assert.equal(f.calls.length, 0);
      });
    }
  }
});

describe("kontext (Replicate)", () => {
  it("creates a prediction with the token and the base as a data URL, then downloads the output", async () => {
    const f = fakeFetch((url) => (url.includes("/predictions") ? json({ status: "succeeded", output: "https://cdn.example/out.png" }) : png()));
    const out = await ENGINES.kontext.generate(input(), { fetch: f, env: { REPLICATE_API_TOKEN: "tok" } });
    assert.ok(Buffer.isBuffer(out) && out.equals(IMG));
    const [create, download] = f.calls;
    assert.match(create.url, /replicate\.com\/.*flux-kontext-pro\/predictions/);
    assert.equal(create.init.headers.Authorization, "Token tok");
    const body = JSON.parse(create.init.body).input;
    assert.match(body.input_image, /^data:image\/png;base64,/);
    assert.match(body.prompt, /a red hat/);
    assert.equal(body.seed, 7);
    assert.equal(body.output_format, "png");
    assert.equal(download.url, "https://cdn.example/out.png");
  });
  it("waits for a queued prediction (processing then succeeded)", async () => {
    let polls = 0;
    const f = fakeFetch((url) => {
      if (url.includes("/predictions") && !url.endsWith("/get")) {
        return json({ status: "processing", urls: { get: "https://api.replicate.com/v1/predictions/p1/get", cancel: "https://x/cancel" } });
      }
      if (url.endsWith("/get")) {
        polls++;
        return json({ status: "succeeded", output: ["https://cdn.example/o.png"] });
      }
      return png();
    });
    const out = await ENGINES.kontext.generate(input(), { fetch: f, env: { REPLICATE_API_TOKEN: "tok" } });
    assert.equal(polls, 1);
    assert.ok(out.equals(IMG));
  });
  it("a failed prediction carries the provider's reason; an HTTP error carries status and body", async () => {
    const failed = fakeFetch(() => json({ status: "failed", error: "NSFW content detected" }));
    await assert.rejects(ENGINES.kontext.generate(input(), { fetch: failed, env: { REPLICATE_API_TOKEN: "t" } }), /Replicate: NSFW content detected/);
    const http = fakeFetch(() => fail(401, '{"detail":"Invalid token"}'));
    await assert.rejects(ENGINES.kontext.generate(input(), { fetch: http, env: { REPLICATE_API_TOKEN: "bad" } }), /Replicate: HTTP 401: .*Invalid token/);
  });
});

describe("fal", () => {
  it("posts JSON to the img2img model with a 0..1 strength and the seed, then downloads the image", async () => {
    const f = fakeFetch((url) => (url.startsWith("https://fal.run/") ? json({ images: [{ url: "https://v3.fal.media/x.png" }] }) : png()));
    const out = await ENGINES.fal.generate(input({ strength: 0.3 }), { fetch: f, env: { FAL_KEY: "k" } });
    assert.ok(out.equals(IMG));
    const [req] = f.calls;
    assert.equal(req.url, "https://fal.run/fal-ai/flux/dev/image-to-image");
    assert.equal(req.init.headers.Authorization, "Key k");
    const body = JSON.parse(req.init.body);
    assert.match(body.image_url, /^data:image\/png;base64,/);
    assert.ok(body.strength > 0 && body.strength <= 1, `strength ${body.strength}`);
    assert.equal(body.seed, 7);
  });
  it("a reply without an image URL, and an HTTP error, are named errors", async () => {
    await assert.rejects(ENGINES.fal.generate(input(), { fetch: fakeFetch(() => json({})), env: { FAL_KEY: "k" } }), /Fal\.ai: no image URL/);
    await assert.rejects(ENGINES.fal.generate(input(), { fetch: fakeFetch(() => fail(429, "slow down")), env: { FAL_KEY: "k" } }), /Fal\.ai: HTTP 429: slow down/);
  });
});

describe("openai", () => {
  it("edits: multipart with model, prompt and the base image, base64 reply", async () => {
    const f = fakeFetch(() => json({ data: [{ b64_json: IMG.toString("base64") }] }));
    const out = await ENGINES.openai.generate(input(), { fetch: f, env: { OPENAI_API_KEY: "sk-x" } });
    assert.ok(out.equals(IMG));
    const [req] = f.calls;
    assert.equal(req.url, "https://api.openai.com/v1/images/edits");
    assert.equal(req.init.headers.Authorization, "Bearer sk-x");
    const form = formEntries(req.init);
    assert.equal(form.model, "gpt-image-2");
    assert.match(form.prompt, /a red hat/);
    assert.equal(form["image[]"], "[file image/png]");
  });
  it("txt2img: JSON body, and a moderation block keeps its code in the error text", async () => {
    const f = fakeFetch(() => json({ data: [{ b64_json: IMG.toString("base64") }] }));
    await TXT2IMG.openai.generate({ prompt: "a fox", seed: 1 }, { fetch: f, env: { OPENAI_API_KEY: "sk-x" } });
    assert.equal(f.calls[0].url, "https://api.openai.com/v1/images/generations");
    assert.equal(JSON.parse(f.calls[0].init.body).prompt, "a fox");
    const blocked = fakeFetch(() => fail(400, '{"error":{"code":"moderation_blocked","message":"rejected by the safety system"}}'));
    await assert.rejects(TXT2IMG.openai.generate({ prompt: "x" }, { fetch: blocked, env: { OPENAI_API_KEY: "sk-x" } }), /OpenAI txt2img: HTTP 400: .*moderation_blocked/);
    await assert.rejects(TXT2IMG.openai.generate({ prompt: "x" }, { fetch: fakeFetch(() => json({ data: [{}] })), env: { OPENAI_API_KEY: "sk-x" } }), /no b64_json/);
  });
});

describe("stability", () => {
  it("edits: bearer auth, image-to-image form with a strength, PNG back", async () => {
    const f = fakeFetch(() => png());
    const out = await ENGINES.stability.generate(input(), { fetch: f, env: { STABILITY_API_KEY: "sk" } });
    assert.ok(out.equals(IMG));
    const [req] = f.calls;
    assert.match(req.url, /api\.stability\.ai\/v2beta\/stable-image\/generate\/sd3/);
    assert.equal(req.init.headers.Authorization, "Bearer sk");
    const form = formEntries(req.init);
    assert.equal(form.mode, "image-to-image");
    assert.ok(Number(form.strength) > 0 && Number(form.strength) <= 1);
    assert.equal(form.output_format, "png");
  });
  it("an HTTP error names Stability", async () => {
    await assert.rejects(ENGINES.stability.generate(input(), { fetch: fakeFetch(() => fail(402, "no credits")), env: { STABILITY_API_KEY: "sk" } }), /Stability: HTTP 402: no credits/);
  });
});

describe("pollinations", () => {
  const env = { POLLINATIONS_API_KEY: "pk" };
  it("edits: multipart with the base; understands binary, base64 JSON and URL JSON replies", async () => {
    const binary = fakeFetch(() => png());
    assert.ok((await ENGINES.pollinations.generate(input(), { fetch: binary, env })).equals(IMG));
    assert.equal(binary.calls[0].url, "https://gen.pollinations.ai/v1/images/edits");
    assert.equal(binary.calls[0].init.headers.Authorization, "Bearer pk");
    assert.equal(formEntries(binary.calls[0].init).image, "[file image/png]");

    const b64 = fakeFetch(() => json({ data: [{ b64_json: IMG.toString("base64") }] }));
    assert.ok((await ENGINES.pollinations.generate(input(), { fetch: b64, env })).equals(IMG));

    const viaUrl = fakeFetch((url) => (url.includes("/v1/images/edits") ? json({ data: [{ url: "https://gen.pollinations.ai/o/1" }] }) : png()));
    assert.ok((await ENGINES.pollinations.generate(input(), { fetch: viaUrl, env })).equals(IMG));
    assert.equal(viaUrl.calls[1].init.headers.Authorization, "Bearer pk", "the download carries the token too");
  });
  it("unexpected JSON and HTTP errors are named", async () => {
    await assert.rejects(ENGINES.pollinations.generate(input(), { fetch: fakeFetch(() => json({ data: [] })), env }), /Pollinations: unexpected JSON/);
    await assert.rejects(ENGINES.pollinations.generate(input(), { fetch: fakeFetch(() => fail(500, "boom")), env }), /Pollinations: HTTP 500: boom/);
  });
});

describe("the mock engine is free, deterministic and offline", () => {
  it("returns the same PNG for the same seed and never calls fetch", async () => {
    const f = fakeFetch(() => assert.fail("mock must not use the network"));
    const a = await ENGINES.mock.generate(input({ seed: 3 }), { fetch: f, env: {} });
    const b = await ENGINES.mock.generate(input({ seed: 3 }), { fetch: f, env: {} });
    assert.ok(a.equals(b));
    assert.equal(a.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(ENGINES.mock.costUsd, 0);
  });
});
