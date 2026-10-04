/**
 * Collection Showcase & Trait Rarity Scorecard for Series Lab.
 * Computes deterministic trait rarity scores, edition ranks (#1..N),
 * tier classifications (Mythic, Legendary, Epic, Rare, Common),
 * and generates standalone, responsive HTML showcases.
 */

import { computeRarity, openRarityByEdition } from "./rarity.mjs";

/**
 * Rarity tier definitions based on percentile ranking.
 */
export const RARITY_TIERS = [
  { tier: "mythic", label: "Mythic", color: "#f43f5e", bg: "rgba(244,63,94,0.15)", border: "#f43f5e", minPercentile: 98 },
  { tier: "legendary", label: "Legendary", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", border: "#f59e0b", minPercentile: 90 },
  { tier: "epic", label: "Epic", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", border: "#8b5cf6", minPercentile: 75 },
  { tier: "rare", label: "Rare", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", border: "#3b82f6", minPercentile: 50 },
  { tier: "common", label: "Common", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "#64748b", minPercentile: 0 },
];

/**
 * Assign rarity tier based on rank and collection size.
 * @param {number} rank 1-based rank
 * @param {number} total total editions
 * @returns {object}
 */
export function getRarityTier(rank, total) {
  if (total <= 0) return RARITY_TIERS[RARITY_TIERS.length - 1];
  const percentile = ((total - rank + 1) / total) * 100;
  for (const t of RARITY_TIERS) {
    if (percentile >= t.minPercentile) return t;
  }
  return RARITY_TIERS[RARITY_TIERS.length - 1];
}

/**
 * Calculate comprehensive rarity scores and rankings for an archive.
 * @param {object} archive
 * @param {object} [preset={}]
 * @returns {object} { editions: Array, traitScores: object, totalEditions: number, stats: object }
 */
export function calculateRarityScores(archive, preset = {}) {
  const recipes = Array.isArray(archive?.recipes) ? archive.recipes : [];
  const total = recipes.length;
  if (!total) {
    return {
      editions: [],
      traitScores: {},
      totalEditions: 0,
      stats: { topScore: 0, avgScore: 0, minScore: 0 },
    };
  }

  // 1. Calculate trait value frequencies
  const traitCounts = {}; // { [traitKey]: { [value]: count } }
  const traitTotals = {}; // { [traitKey]: countOfEditionsWithTrait }

  for (const r of recipes) {
    if (r?.traits && typeof r.traits === "object") {
      for (const [k, v] of Object.entries(r.traits)) {
        if (v == null || v === "" || v === "__NONE__" || v === "None") continue;
        if (!traitCounts[k]) traitCounts[k] = {};
        traitCounts[k][v] = (traitCounts[k][v] || 0) + 1;
        traitTotals[k] = (traitTotals[k] || 0) + 1;
      }
    }
  }

  // 2. Trait rarity score: S = 1 / (count / total) = total / count
  const traitScores = {};
  for (const [k, vals] of Object.entries(traitCounts)) {
    traitScores[k] = {};
    for (const [val, cnt] of Object.entries(vals)) {
      const freq = cnt / total;
      const score = Math.round((1 / freq) * 100) / 100;
      traitScores[k][val] = {
        count: cnt,
        frequency: freq,
        percent: Math.round(freq * 1000) / 10,
        score,
      };
    }
  }

  // 3. Compute edition total scores
  const editions = recipes.map((r) => {
    let totalScore = 0;
    const traitsBreakdown = [];
    let traitCount = 0;

    if (r?.traits && typeof r.traits === "object") {
      for (const [k, v] of Object.entries(r.traits)) {
        if (v == null || v === "" || v === "__NONE__" || v === "None") continue;
        traitCount++;
        const info = traitScores[k]?.[v] || { count: 1, frequency: 1 / total, percent: 100 / total, score: total };
        totalScore += info.score;
        traitsBreakdown.push({
          trait: k,
          value: v,
          count: info.count,
          percent: info.percent,
          score: info.score,
        });
      }
    }

    // Trait count score adjustment
    const roundedScore = Math.round(totalScore * 100) / 100;

    return {
      edition: r.edition,
      dna: r.dna || "",
      line: r.line || null,
      prompt: r.prompt || "",
      traitCount,
      rarityScore: roundedScore,
      traits: r.traits || {},
      traitsBreakdown,
    };
  });

  const openMap = new Map(
    openRarityByEdition(preset, recipes).editions.map((row) => [Number(row.edition), row.openRarity]),
  );
  for (const row of editions) row.openRarity = openMap.get(Number(row.edition)) ?? null;

  // 4. Sort descending by rarity score and assign ranks
  editions.sort((a, b) => b.rarityScore - a.rarityScore || a.edition - b.edition);

  for (let i = 0; i < editions.length; i++) {
    const rank = i + 1;
    editions[i].rank = rank;
    editions[i].tier = getRarityTier(rank, total);
  }

  // Summary statistics
  const topScore = editions[0]?.rarityScore || 0;
  const minScore = editions[editions.length - 1]?.rarityScore || 0;
  const avgScore = Math.round((editions.reduce((acc, e) => acc + e.rarityScore, 0) / total) * 100) / 100;

  return {
    presetId: archive?.presetId || preset?.id || "series",
    seed: archive?.seed || preset?.seed || "",
    totalEditions: total,
    editions,
    traitScores,
    stats: {
      topScore,
      avgScore,
      minScore,
    },
  };
}

/**
 * Generate a standalone, beautiful, responsive HTML showcase page.
 * @param {object} archive
 * @param {object} [preset={}]
 * @param {object} [opts={}]
 * @returns {string} Standalone HTML document
 */
export function generateShowcaseHtml(archive, preset = {}, opts = {}) {
  const scorecard = calculateRarityScores(archive, preset);
  const title = opts.title || preset?.name || archive?.presetId || "Series Collection";
  const presetId = archive?.presetId || preset?.id || "series";
  const seed = archive?.seed || preset?.seed || "";
  const total = scorecard.totalEditions;

  const dataJson = JSON.stringify(scorecard).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Collection Showcase &amp; Rarity Scorecard</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(18, 24, 38, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #6366f1;
      --primary-glow: rgba(99, 102, 241, 0.25);
      --accent: #10b981;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      background-image:
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.08) 0px, transparent 50%);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }
    header {
      max-width: 1200px;
      margin: 0 auto 24px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 20px;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      background: linear-gradient(135deg, #fff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-meta {
      display: flex;
      gap: 12px;
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .stat-pill {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 4px 10px;
      border-radius: 9999px;
    }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      max-width: 1200px;
      margin: 0 auto 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      padding: 16px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
    }
    .stat-val {
      font-size: 24px;
      font-weight: 700;
      color: var(--primary);
    }
    .stat-lbl {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .controls {
      max-width: 1200px;
      margin: 0 auto 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .search-input, .select-input {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .search-input:focus, .select-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary-glow);
    }
    .search-input { flex: 1; min-width: 200px; }
    .tier-filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .tier-btn {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tier-btn.active {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: rgba(99, 102, 241, 0.4);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .card-head {
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--card-border);
      background: rgba(255, 255, 255, 0.02);
    }
    .card-title {
      font-weight: 700;
      font-size: 15px;
    }
    .rank-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .card-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }
    .score-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .score-label {
      font-size: 12px;
      color: var(--text-muted);
    }
    .score-value {
      font-size: 16px;
      font-weight: 800;
      color: #38bdf8;
    }
    .dna-code {
      font-family: monospace;
      font-size: 11px;
      color: var(--text-muted);
      background: rgba(0,0,0,0.3);
      padding: 4px 6px;
      border-radius: 4px;
      word-break: break-all;
    }
    .traits-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 6px;
    }
    .trait-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      padding: 4px 6px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 4px;
    }
    .trait-k {
      color: var(--text-muted);
    }
    .trait-v {
      font-weight: 600;
      color: var(--text);
    }
    .trait-pct {
      font-size: 10px;
      color: #38bdf8;
      margin-left: 4px;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1 class="brand-title">${escapeHtml(title)}</h1>
      <div class="brand-meta">
        <span class="stat-pill">Preset: <b>${escapeHtml(presetId)}</b></span>
        <span class="stat-pill">Seed: <b>${escapeHtml(seed)}</b></span>
        <span class="stat-pill">Size: <b>${total}</b> editions</span>
      </div>
    </div>
  </header>

  <section class="stats-bar">
    <div class="stat-card">
      <span class="stat-lbl">Total Editions</span>
      <span class="stat-val">${total}</span>
    </div>
    <div class="stat-card">
      <span class="stat-lbl">Top Rarity Score</span>
      <span class="stat-val" style="color: #f43f5e">${scorecard.stats.topScore}</span>
    </div>
    <div class="stat-card">
      <span class="stat-lbl">Average Score</span>
      <span class="stat-val" style="color: #6366f1">${scorecard.stats.avgScore}</span>
    </div>
    <div class="stat-card">
      <span class="stat-lbl">Base Floor Score</span>
      <span class="stat-val" style="color: #10b981">${scorecard.stats.minScore}</span>
    </div>
  </section>

  <div class="controls">
    <input type="text" id="search" class="search-input" placeholder="Search by #edition, trait, or DNA...">
    <div class="tier-filters" id="tier-filters">
      <button class="tier-btn active" data-tier="all">All Tiers (${total})</button>
      <button class="tier-btn" data-tier="mythic">Mythic</button>
      <button class="tier-btn" data-tier="legendary">Legendary</button>
      <button class="tier-btn" data-tier="epic">Epic</button>
      <button class="tier-btn" data-tier="rare">Rare</button>
      <button class="tier-btn" data-tier="common">Common</button>
    </div>
  </div>

  <main class="grid" id="card-grid"></main>

  <script>
    const DATA = ${dataJson};
    let activeTier = "all";
    let searchQuery = "";

    function render() {
      const grid = document.getElementById("card-grid");
      const filtered = DATA.editions.filter(item => {
        if (activeTier !== "all" && item.tier.tier !== activeTier) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchEd = String(item.edition).includes(q) || ("#" + item.edition).includes(q);
          const matchDna = (item.dna || "").toLowerCase().includes(q);
          const matchTraits = Object.entries(item.traits || {}).some(([k, v]) =>
            k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
          );
          if (!matchEd && !matchDna && !matchTraits) return false;
        }
        return true;
      });

      grid.innerHTML = filtered.map(item => {
        const tier = item.tier;
        const traitsHtml = (item.traitsBreakdown || []).map(t => \`
          <div class="trait-item">
            <span class="trait-k">\${escape(t.trait)}</span>
            <span>
              <span class="trait-v">\${escape(t.value)}</span>
              <span class="trait-pct">(\${t.percent}%)</span>
            </span>
          </div>
        \`).join("");

        return \`
          <article class="card" style="border-top: 3px solid \${tier.color}">
            <div class="card-head">
              <span class="card-title">#\${item.edition}</span>
              <span class="rank-badge" style="background:\${tier.bg}; color:\${tier.color}; border:1px solid \${tier.border}">
                Rank #\${item.rank} · \${tier.label}
              </span>
            </div>
            <div class="card-body">
              <div class="score-row">
                <span class="score-label">Rarity Score</span>
                <span class="score-value">\${item.rarityScore}</span>
              </div>
              <div class="dna-code">\${escape(item.dna || "—")}</div>
              <div class="traits-list">
                \${traitsHtml}
              </div>
            </div>
          </article>
        \`;
      }).join("");
    }

    function escape(str) {
      return String(str || "").replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[m]));
    }

    document.getElementById("search").addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      render();
    });

    document.querySelectorAll(".tier-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tier-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeTier = btn.dataset.tier;
        render();
      });
    });

    render();
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
