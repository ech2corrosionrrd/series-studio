# Series Lab — Changelog

All notable changes to **Series Lab** (`series-lab`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-09-23

### 🚀 Production Release Milestone (All 17 Roadmap Waves Completed)

#### Wave 17: Multi-Engine Prompt Matrix & LoRA / Model Tags
- **Matrix Transformer Engine (`src/matrix.mjs`)**:
  - Engine-specific prompt flavoring for **Flux** (natural descriptive syntax + trigger tokens), **SDXL** (`<lora:name:weight>` formatting + quality keywords), **Midjourney** (`--v 6.1 --stylize --ar` parametric flags), **Kontext** (reference anchor), and **OpenAI** (clean prose filtering).
  - `buildEnginePromptMatrix(recipe, preset, engineTargets)`: Generates simultaneous prompts for multi-platform generative rendering.
  - `exportEngineMatrixCsv(recipes, preset, engineTargets)`: Multi-engine batch prompt matrix export.
- **CLI & Preset Integration**:
  - Preset support for optional `engineMatrix` configurations.

#### Wave 16: Collection Showcase & Trait Rarity Scorecard
- **Deterministic Rarity Math (`src/scorecard.mjs`)**:
  - Trait rarity frequency, trait rarity scores ($1/F$), total edition score summation, and collection ranking (#1 to #N).
  - Percentile-based tier distribution: **Mythic** (Top 2%), **Legendary** (Top 10%), **Epic** (Top 25%), **Rare** (Top 50%), and **Common** (Bottom 50%).
- **Standalone HTML Visual Proof & Showcase**:
  - `generateShowcaseHtml(archive, preset, opts)`: Zero-dependency, responsive, dark glassmorphism standalone HTML application with live search, tier filters, DNA matrix, and trait score cards.
  - Studio UI: Direct one-click download & open via `/api/export/showcase.html`.
  - Headless CLI: `series showcase <archive.json> [-o showcase.html]`.

#### Wave 15: Dynamic Media Pipeline (Video / Animation / 3D Assets)
- **Multi-Format Asset Discovery (`src/export-bundle.mjs`)**:
  - Auto-discovery of companion video (`.mp4`, `.webm`, `.mov`), animated (`.gif`), 3D (`.glb`, `.gltf`), and interactive HTML (`.html`) files alongside static posters.
  - Automatic packaging into `images/` directory in ZIP bundle.
- **Launchpad Metadata Alignment (`src/launchpads.mjs`)**:
  - `animation_url` field populated across ERC-721, Metaplex, and Bitcoin Ordinals.
  - Metaplex `properties.category` dynamically classified as `"video"`, `"vr"`, `"html"`, or `"image"`.
  - `properties.files` populated with static cover and dynamic media with accurate MIME types.
  - `exportManifestCsv` with `animation_url` column.
  - Studio UI `#x-anim-prefix` field and CLI `--anim-prefix` flag.

#### Wave 14: Release & Deployment Hub
- **Launchpad Deploy Config Generators (`src/deploy.mjs`)**:
  - Metaplex Sugar CLI configuration generator (`buildSugarConfig`).
  - Thirdweb / EVM Drop contract deployment configuration (`buildThirdwebConfig`).
  - Step-by-step localized release guide (`buildReleaseGuide`).
- **Release Hub Studio UI**:
  - Deep links to OpenSea Studio, Magic Eden Launchpad, LaunchMyNFT, and Testnet portals.
  - Zero private key exposure guarantee (pure non-custodial design).
  - CLI: `series release-config <archive.json> [options]`.

#### Wave 13: Launchpad Presets & Multi-Standard Export Profiles
- **Standardized Export Profiles (`src/launchpads.mjs`)**:
  - `opensea`: OpenSea Studio ERC-721 metadata with CSV manifest.
  - `magiceden`: Magic Eden Solana/EVM Drop format with creator royalties array and seller fee basis points.
  - `launchmynft`: LaunchMyNFT format with 0-based token indexing.
  - `ordinalsbot`: Bitcoin Ordinals inscription manifest format.
- **Bulk CSV Manifest Engine**:
  - `exportManifestCsv`: Bulk upload CSV manifest compatible with major launchpads.
  - CLI: `series manifest <archive.json> [options]`.

#### Wave 12: IPFS / Arweave Storage Dispatcher
- **Decentralized Storage Integration (`src/storage.mjs`)**:
  - Pinata IPFS folder upload (`uploadToPinata`) with non-custodial client architecture.
  - Deterministic IPFS CIDv0 generator (`calculateDeterministicCid`) for offline simulation.
  - Studio UI: One-click IPFS upload from Export tab with real-time progress.
  - CLI: `series pin <set-dir> [options]`.

#### Wave 11: AI Auto-Triage & Smart Critic
- **Quality Evaluation Engine (`src/critic.mjs`)**:
  - Fast offline heuristics (0$ cost) detecting PNG magic bytes, dimensions, file corruption, and prompt lint hits.
  - Multimodal Vision AI evaluator (GPT-4o / Claude 3.5 Sonnet) scoring anatomy, style consistency, and prompt alignment (1–10).
  - Structured triage output with Keep / Redo / Review verdicts and reasoning.
  - Studio Gallery Triage bar with auto-apply keep/redo actions.
  - CLI: `series triage <set-dir> [options]`.

#### Wave 10: Headless CLI Batch Render Pipeline
- **Headless CLI Command (`bin/series.mjs render`)**:
  - Production batch rendering from CLI without browser requirement.
  - Dry-run mode (`--dry-run`), cost estimation, prompt safety linting, and reference strength clamping.

#### Wave 9: Metadata Extensions & Bitcoin Ordinals Export
- **Attributes Extensions**:
  - OpenSea `display_type` support (`number`, `boost_number`, `boost_percentage`, `date`, `max_value`).
  - Bitcoin Ordinals inscription manifest generation (`buildOrdinalsMeta`).

#### Wave 8: Concurrency Pool & Live SSE Stream
- **Performance Engine (`src/pool.mjs`)**:
  - Deterministic concurrency pool (`mapConcurrent`) with order preservation.
  - Server-Sent Events (SSE) live thumbnail and progress streaming during generation.

#### Wave 7: Vision Assist
- **Reverse Prompt Engineering (`src/vision.mjs`)**:
  - Vision AI base image analyzer extracting line archetype, framing, lighting, mood, color palette, and trait suggestions.
  - Offline heuristic fallback mode when no API keys are configured.

#### Wave 6: Advanced Base Management & Trait Library
- **Line-Specific Bases**:
  - Support for `base-<line>.*` files targeting specific archetype lines.
- **Trait Pack Library Manager**:
  - Reusable trait pack import/export (`libraries/traits/*.json`).
  - Redo filtering and regeneration workflows.

#### Waves 1–5: Core Studio Foundation
- **Series Lab Studio**:
  - Pure deterministic Node.js ESM architecture with zero heavy frontend framework baggage.
  - 100% reproducible seed-based DNA generation (`FNV-1a` + PRNG).
  - Dual UK/EN localization across all UI tabs, docs, and CLI.
  - Built-in prompt safety linting (brand/franchise blocklist).
  - Trait conflict validation matrix and expected vs actual rarity reporting.
  - Review gallery with lightboxes, keep/redo/favorite markings, and comparative sets.
  - Mint-ready ZIP bundles with 2x upscaling (`sharp`).

---

### 🛡 Non-Custodial Security Principle
- Series Lab generates metadata, assets, manifests, and deploy configurations locally.
- **No private keys or mnemonic seed phrases are ever handled, requested, or stored by the server.**
- Deployment execution is delegated directly to official launchpad portals or local CLI tools (Metaplex Sugar, Thirdweb CLI, OpenSea Studio).
