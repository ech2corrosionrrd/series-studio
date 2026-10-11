// Скрипт сторінки входу. Винесений з login.html, щоб CSP не потребував 'unsafe-inline' у script-src.
import { isAddress, getAddress } from "https://esm.sh/viem@2";

const API_BASE = "";
// Placeholder replaced by server/platform.mjs → AUTH_APP_URL || "/studio/"
const APP_URL = 'https://ai.w3ir.io';

const ICONS = {
  metamask: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1a1520"/><path fill="#E2761B" d="M16.4 6.2 24.2 11l-1.4 8.4-2.5 1.3-2.1-1.5-2.1 1.5-2.5-1.3L11 11l5.4-4.8z"/><path fill="#E4761B" d="m16.4 6.2 1.8 5.6-4.2.2 2.4-5.8zm0 0-1.8 5.6 4.2.2-2.4-5.8z"/><path fill="#D7C1B3" d="m19.3 20.7 2.1-1.5 1.1 2.4-3.2.9v-1.8zm-6.6 0v1.8l-3.2-.9 1.1-2.4 2.1 1.5z"/><path fill="#233447" d="m12.7 20.7 2.1 1.5-.5 2.1-1.6-3.6zm6.6 0 1.6 3.6-.5-2.1 2.1-1.5-3.2 0z"/><path fill="#CD6116" d="m12.7 20.7-1.1-6.7 3.8.9.4 2.3.5 2.1-3.6 1.4zm6.6 0 3.6-1.4.5-2.1.4-2.3 3.8-.9-1.1 6.7-7.2 0z"/><path fill="#E4751F" d="m15.8 17.2-.4-2.3 4.2-.2v.5l-3.8 2zm.4 0 3.8-2 .4 2.3-4.2-.3z"/></svg>`,
  coinbase: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0052FF"/><rect x="10" y="10" width="12" height="12" rx="3" fill="#fff"/></svg>`,
  phantom: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="ph" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#AB9FF2"/><stop offset="1" stop-color="#4E44CE"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#ph)"/><ellipse cx="16" cy="17" rx="8.5" ry="9" fill="#fff" opacity=".92"/><circle cx="12.8" cy="16.2" r="1.6" fill="#4E44CE"/><circle cx="19.2" cy="16.2" r="1.6" fill="#4E44CE"/></svg>`,
  wallet: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2a2033"/><rect x="7" y="10" width="18" height="13" rx="3" fill="#c77dff"/><rect x="18" y="14" width="7" height="5" rx="1.5" fill="#1d1424"/><circle cx="21.5" cy="16.5" r="1.2" fill="#c77dff"/></svg>`,
};

const iconKey = (id) => {
  const s = String(id || "").toLowerCase();
  if (s.includes("metamask") || s === "io.metamask") return "metamask";
  if (s.includes("coinbase") || s === "com.coinbase.wallet") return "coinbase";
  if (s.includes("phantom") || s === "app.phantom") return "phantom";
  return "wallet";
};
const iconHtml = (id) => `<span class="w-icon">${ICONS[iconKey(id)] || ICONS.wallet}</span>`;

const I18N = {
  uk: {
    sub: "майстерня серії · by W3IR",
    st12t: "Огляд і основа", st12d: "Паспорт серії та базова картинка",
    st34t: "Конструктор і рецепти", st34d: "Промпт, риси, тексти без рендеру",
    st56t: "Генерація і відбір", st56d: "Пілоти, keep / redo, версії",
    st7t: "Експорт", st7d: "Архів випуску OpenSea / launchpad",
    hero: "З однієї базової картинки<br>вся серія.",
    "hero.p": "Для авторів колекцій: з базової картинки серії — узгоджені кадри й архів, готовий до випуску.",
    "sc.cap": "Базова картинка серії (ліворуч) і 4 кадри: той самий герой, інші шарф, фон, вираз. Реальний тест.",
    price: "Далі: від ${usd} за {credits} кредитів, USDC у Solana, без підписки. Ціну видно до запуску.",
    "pill.sign": "Лише підпис", "pill.nc": "Non-custodial", "pill.credits": "Кредити за кадри",
    ms1: "1–2 Огляд", ms2: "3–4 Рецепти", ms3: "5–6 Кадри", ms4: "7 ZIP",
    back: "← На старт",
    title: "Увійти в майстерню",
    lead: "Підключіть гаманець, щоб відкрити Studio: ваші пресети, набори й кредити — окремо для кожного акаунта.",
    connect: "Підключити гаманець", waiting: "Чекаємо…",
    why: "Навіщо гаманець?",
    "why.p": "Це вхід замість пароля. Підпис підтверджує, що адреса ваша.",
    "why.1": "Без gas і транзакцій — лише підпис",
    "why.2": "Ми не маємо доступу до коштів",
    "why.3": "Після входу відкривається майстерня",
    wallets: "Підтримуються MetaMask, Coinbase Wallet і Phantom.",
    "legal.pre": "Сервіс у стадії розробки й тестування і надається «як є». Входячи, ви погоджуєтесь з",
    "legal.terms": "Умовами",
    "legal.and": "і",
    "legal.privacy": "Політикою конфіденційності",
    help: "Що таке Series Lab →",
    modal: "Оберіть гаманець",
    "modal.note": "EVM · MetaMask / Coinbase · Solana · Phantom",
    woEarly: "{n} безкоштовних кредитів — перші {limit} (лишилось {left})",
    woNormal: "{n} безкоштовних кредитів при першому вході",
    woCond: "Захист від ботів: потрібен активний гаманець (щонайменше {sol} SOL або {eth} ETH на Base). Нічого не списується.",
    woFree: "Без умов — нарахування одразу після підпису.",
    woScale: "Приблизно на {n} кадрів бюджетним рушієм у Series Lab.",
    stNonce: "Запитуємо nonce…",
    stVerify: "Перевіряємо підпис…",
    stOk: "Вхід успішний ✓",
    stConnect: "Підключаємо гаманець…",
    stSign: "Підтвердіть підпис у гаманці…",
    stPhantom: "Підключаємо Phantom…",
    errNoWallet: "Гаманець не знайдено. Встановіть MetaMask, Coinbase Wallet або Phantom.",
    errProvider: "Провайдер не знайдено",
    errPhantom: "Phantom не знайдено",
    errAddr: "Некоректна адреса гаманця",
    "mw.hint": "Цей браузер не бачить гаманця. Відкрийте сторінку в застосунку гаманця (застосунок має бути встановлений):",
    "mw.phantom": "Відкрити у Phantom (Solana)",
    "mw.metamask": "Відкрити у MetaMask",
    "mw.coinbase": "Відкрити у Coinbase Wallet",
    "dw.hint": "Гаманця в цьому браузері немає. Встановіть розширення, потім оновіть сторінку:",
    "dw.phantom": "Встановити Phantom (Solana)",
    "dw.metamask": "Встановити MetaMask",
    "dw.coinbase": "Встановити Coinbase Wallet",
    chainEvm: "EVM",
    chainSol: "Solana",
    docTitle: "Series Lab — вхід",
    "meta.description": "Увійдіть у Series Lab гаманцем: пресет → рецепти → генерація → архів випуску і набір деплою зі свого гаманця. Підпис без gas і без доступу до коштів.",
    "a11y.stages": "Етапи",
    "a11y.language": "Мова",
    "a11y.lang.uk": "Українська",
    "a11y.lang.en": "English",
    "a11y.close": "Закрити",
    "err.needAddr": "Потрібна EVM-адреса 0x… або адреса Solana.",
    "err.badAddr": "Невалідна адреса (EVM 0x… або Solana).",
    "err.nonceStale": "Nonce недійсний або протух — оновіть сторінку.",
    "err.addrMismatch": "Адреса не збігається з nonce.",
    "err.badSig": "Підпис не пройшов перевірку.",
    "err.internal": "Внутрішня помилка сервера.",
    "err.nonce": "Не вдалося отримати nonce.",
    "err.verify": "Не вдалося перевірити підпис.",
    "err.auth": "Спочатку увійдіть гаманцем.",
    "err.generic": "Запит не вдався.",
    "err.invite": "На цьому сервері доступ лише за запрошенням.",
  },
  en: {
    sub: "series workshop · by W3IR",
    st12t: "Overview & base", st12d: "Series passport and base image",
    st34t: "Constructor & recipes", st34d: "Prompt, traits, texts without render",
    st56t: "Generate & review", st56d: "Pilots, keep / redo, versions",
    st7t: "Export", st7d: "Release archive for OpenSea / launchpad",
    hero: "One base image,<br>the whole series.",
    "hero.p": "For collection authors: from the series base image to consistent frames and a release-ready archive.",
    "sc.cap": "The series base image (left) and 4 frames: same hero, different scarf, background, expression. A real test.",
    price: "After that: from ${usd} for {credits} credits, USDC on Solana, no subscription. You see the price before you run.",
    "pill.sign": "Signature only", "pill.nc": "Non-custodial", "pill.credits": "Credits per frame",
    ms1: "1–2 Overview", ms2: "3–4 Recipes", ms3: "5–6 Frames", ms4: "7 ZIP",
    back: "← Home",
    title: "Sign in to the workshop",
    lead: "Connect a wallet to open Studio: your presets, sets and credits — separate for each account.",
    connect: "Connect wallet", waiting: "Waiting…",
    why: "Why a wallet?",
    "why.p": "It is your login instead of a password. The signature proves the address is yours.",
    "why.1": "No gas or transactions — signature only",
    "why.2": "We never have access to your funds",
    "why.3": "After sign-in the workshop opens",
    wallets: "Supported: MetaMask, Coinbase Wallet and Phantom.",
    "legal.pre": "The Service is in development and testing and is provided as is. By signing in you accept the",
    "legal.terms": "Terms",
    "legal.and": "and the",
    "legal.privacy": "Privacy Policy",
    help: "What is Series Lab →",
    modal: "Choose wallet",
    "modal.note": "EVM · MetaMask / Coinbase · Solana · Phantom",
    woEarly: "{n} free credits — first {limit} users ({left} left)",
    woNormal: "{n} free credits on your first sign-in",
    woCond: "Bot protection: the wallet must be active (at least {sol} SOL or {eth} ETH on Base). Nothing is charged.",
    woFree: "No conditions — credited right after the signature.",
    woScale: "About {n} frames on a budget engine in Series Lab.",
    stNonce: "Requesting nonce…",
    stVerify: "Verifying signature…",
    stOk: "Signed in ✓",
    stConnect: "Connecting wallet…",
    stSign: "Confirm the signature in your wallet…",
    stPhantom: "Connecting Phantom…",
    errNoWallet: "No wallet found. Install MetaMask, Coinbase Wallet, or Phantom.",
    errProvider: "Provider not found",
    errPhantom: "Phantom not found",
    errAddr: "Invalid wallet address",
    "mw.hint": "This browser cannot see a wallet. Open this page inside a wallet app (the app must be installed):",
    "mw.phantom": "Open in Phantom (Solana)",
    "mw.metamask": "Open in MetaMask",
    "mw.coinbase": "Open in Coinbase Wallet",
    "dw.hint": "No wallet in this browser. Install an extension, then reload the page:",
    "dw.phantom": "Install Phantom (Solana)",
    "dw.metamask": "Install MetaMask",
    "dw.coinbase": "Install Coinbase Wallet",
    chainEvm: "EVM",
    chainSol: "Solana",
    docTitle: "Series Lab — sign in",
    "meta.description": "Sign in to Series Lab with a wallet: preset → recipes → generation → release archive and a deploy kit you run from your wallet. A signature with no gas and no access to funds.",
    "a11y.stages": "Stages",
    "a11y.language": "Language",
    "a11y.lang.uk": "Українська",
    "a11y.lang.en": "English",
    "a11y.close": "Close",
    "err.needAddr": "An EVM address 0x… or a Solana address is required.",
    "err.badAddr": "Invalid address (EVM 0x… or Solana).",
    "err.nonceStale": "The nonce is invalid or expired — refresh the page.",
    "err.addrMismatch": "The address does not match the nonce.",
    "err.badSig": "The signature did not verify.",
    "err.internal": "Internal server error.",
    "err.nonce": "Could not get a nonce.",
    "err.verify": "Could not verify the signature.",
    "err.auth": "Sign in with your wallet first.",
    "err.generic": "The request failed.",
    "err.invite": "Access by invitation only on this server.",
  },
};

const API_ERR = {
  "Очікується EVM-адреса 0x… або Solana-адреса": "err.needAddr",
  "Невалідна адреса (EVM 0x… або Solana)": "err.badAddr",
  "Nonce недійсний або протух — оновіть сторінку": "err.nonceStale",
  "Адреса не збігається з nonce": "err.addrMismatch",
  "Підпис не пройшов перевірку": "err.badSig",
  "Internal Server Error": "err.internal",
  "nonce error": "err.nonce",
  "verify failed": "err.verify",
  "not signed in": "err.auth",
  "Sign in required": "err.auth",
  "Access by invitation only on this server": "err.invite",
};
const presentErr = (msg) => (API_ERR[msg] ? t(API_ERR[msg]) : (msg || t("err.generic")));

let locale = localStorage.getItem("series-lab-locale") === "en" ? "en" : "uk";
let welcomeOffer = null;
const t = (k, vars) => {
  let s = I18N[locale][k] ?? I18N.en[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, String(b));
  return s;
};
const $ = (id) => document.getElementById(id);

function fillStaticIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = ICONS[el.getAttribute("data-icon")] || ICONS.wallet;
  });
}

function applyLocale() {
  document.documentElement.lang = locale === "uk" ? "uk" : "en";
  document.title = t("docTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (val.includes("<br>")) el.innerHTML = val;
    else el.textContent = val;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  document.querySelectorAll("[data-i18n-content]").forEach((el) => {
    el.setAttribute("content", t(el.getAttribute("data-i18n-content")));
  });
  document.querySelectorAll(".lang button").forEach((b) => {
    const on = b.dataset.locale === locale;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (!$("connect").disabled) $("connect-label").textContent = t("connect");
  fillWelcome();
  fillPrice();
}

function fillWelcome() {
  const o = welcomeOffer;
  if (!o || !o.credits) return;
  $("wo-headline").textContent = o.is_early
    ? t("woEarly", { n: o.credits, limit: o.early_limit, left: o.early_remaining })
    : t("woNormal", { n: o.credits });
  $("wo-condition").textContent = o.requires_balance
    ? t("woCond", { sol: o.min_sol, eth: o.min_eth })
    : t("woFree");
  $("wo-scale").textContent = t("woScale", { n: Math.floor(o.credits / 4) });
  $("welcome-offer").classList.add("on");
}

function fillPrice() {
  const el = $("price-note");
  const usd = Number(el.dataset.usd), credits = Number(el.dataset.credits);
  el.textContent = usd > 0 && credits > 0 ? t("price", { usd, credits }) : "";
}

document.querySelectorAll(".lang button").forEach((b) => {
  b.addEventListener("click", () => {
    locale = b.dataset.locale === "en" ? "en" : "uk";
    try { localStorage.setItem("series-lab-locale", locale); } catch { /* ignore */ }
    applyLocale();
  });
});

// EIP-6963 discovery before click (avoids Phantom masquerading as MetaMask).
const _eip6963 = [];
window.addEventListener("eip6963:announceProvider", (e) => {
  if (!_eip6963.some((p) => p.info.rdns === e.detail.info.rdns)) _eip6963.push(e.detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

(async () => {
  try {
    const r = await fetch(`${API_BASE}/auth/welcome-offer`);
    if (!r.ok) return;
    const o = await r.json();
    if (!o || !o.credits) return;
    welcomeOffer = o;
    fillWelcome();
  } catch { /* optional banner */ }
})();

const setStatus = (msg, kind = "") => {
  const el = $("status");
  el.textContent = msg || "";
  el.style.color = kind === "err" ? "var(--bad)" : kind === "ok" ? "var(--ok)" : "var(--muted)";
};
const busy = (on) => {
  $("connect").disabled = on;
  $("connect-spin").classList.toggle("hidden", !on);
  $("connect-label").textContent = on ? t("waiting") : t("connect");
};

function detectProviders() {
  const out = [];
  for (const { info, provider } of _eip6963) {
    if (info.rdns === "app.phantom") continue;
    out.push({ id: info.rdns, label: info.name, chain: "evm", pick: () => provider });
  }
  if (!out.length) {
    const eth = window.ethereum;
    if (eth) {
      const list = Array.isArray(eth.providers) ? eth.providers : [eth];
      const mm = list.find((p) => p.isMetaMask && !p.isCoinbaseWallet && !p.isPhantom);
      if (mm) out.push({ id: "metamask", label: "MetaMask", chain: "evm", pick: () => mm });
      const cb = list.find((p) => p.isCoinbaseWallet);
      if (cb) out.push({ id: "coinbase", label: "Coinbase Wallet", chain: "evm", pick: () => cb });
      if (!out.length) out.push({ id: "injected", label: "Browser Wallet", chain: "evm", pick: () => eth });
    }
  }
  const sol = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
  if (sol) out.push({ id: "phantom", label: "Phantom", chain: "solana", pick: () => sol });
  return out;
}

function openModal(providers) {
  const wrap = $("wallet-list");
  wrap.innerHTML = "";
  providers.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wallet-row";
    const chain = p.chain === "solana" ? t("chainSol") : t("chainEvm");
    b.innerHTML = `${iconHtml(p.id)}<span class="label">${p.label}</span><span class="chain">${chain}</span>`;
    b.onclick = () => { closeModal(); connect(p); };
    wrap.appendChild(b);
  });
  modalOpener = document.activeElement;
  $("modal").classList.add("on");
  (modalFocusables()[0] || $("modal-close")).focus();
}
function closeModal() {
  $("modal").classList.remove("on");
  if (modalOpener?.isConnected && typeof modalOpener.focus === "function") modalOpener.focus();
  modalOpener = null;
}

// Focus stays inside the wallet window while it is open (Tab and Shift+Tab wrap), and returns to the button that opened it.
let modalOpener = null;
const modalFocusables = () =>
  [...$("modal").querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.getClientRects().length > 0);

async function getNonce(address, chainId) {
  setStatus(t("stNonce"));
  let url = `${API_BASE}/auth/nonce?address=${address}`;
  if (Number.isInteger(chainId) && chainId > 0) url += `&chain_id=${chainId}`;
  const nr = await fetch(url);
  if (!nr.ok) throw new Error(presentErr((await nr.json()).detail || "nonce error"));
  return nr.json();
}
async function postVerify(address, nonce, signature) {
  setStatus(t("stVerify"));
  const vr = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      address,
      nonce,
      signature,
      ref: new URLSearchParams(location.search).get("ref") || undefined,
    }),
  });
  if (!vr.ok) throw new Error(presentErr((await vr.json()).detail || "verify failed"));
  await vr.json();
  setStatus(t("stOk"), "ok");
  window.location.href = APP_URL;
}

async function signInEVM(provider) {
  if (!provider) { setStatus(t("errProvider"), "err"); return; }
  busy(true); setStatus(t("stConnect"));
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    let address = accounts[0];
    if (!isAddress(address)) throw new Error(t("errAddr"));
    address = getAddress(address);
    let chainId = null;
    try { chainId = parseInt(await provider.request({ method: "eth_chainId" }), 16) || null; } catch { /* ignore */ }
    const { nonce, message } = await getNonce(address, chainId);
    setStatus(t("stSign"));
    const signature = await provider.request({ method: "personal_sign", params: [message, address] });
    await postVerify(address, nonce, signature);
  } catch (e) { setStatus(presentErr(e.message || String(e)), "err"); }
  finally { busy(false); }
}

async function signInSolana(provider) {
  if (!provider) { setStatus(t("errPhantom"), "err"); return; }
  busy(true); setStatus(t("stPhantom"));
  try {
    const resp = await provider.connect();
    const address = resp.publicKey.toString();
    const { nonce, message } = await getNonce(address);
    setStatus(t("stSign"));
    const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
    const signature = [...signed.signature].map((b) => b.toString(16).padStart(2, "0")).join("");
    await postVerify(address, nonce, signature);
  } catch (e) { setStatus(presentErr(e.message || String(e)), "err"); }
  finally { busy(false); }
}

function connect(entry) {
  if (!entry) return;
  if (entry.chain === "solana") signInSolana(entry.pick());
  else signInEVM(entry.pick());
}

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const showMobileWallets = () => { if (isMobile) $("mobile-wallets").classList.add("on"); };
const showDesktopWallets = () => { if (!isMobile) $("desktop-wallets").classList.add("on"); };
(() => {
  const url = location.href;
  $("mw-phantom").href = `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`;
  $("mw-metamask").href = `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}`;
  $("mw-coinbase").href = `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`;
  if (isMobile) setTimeout(() => { if (!detectProviders().length) showMobileWallets(); }, 800);
})();

$("connect").onclick = () => {
  const providers = detectProviders();
  if (!providers.length) {
    showMobileWallets();
    showDesktopWallets();
    // The install block already says it on desktop; keep the red line for phones, where the block is the app links.
    setStatus(isMobile ? t("errNoWallet") : "", "err");
    return;
  }
  if (providers.length === 1 && providers[0].id !== "injected") { connect(providers[0]); return; }
  openModal(providers);
};
$("modal-close").onclick = closeModal;
$("modal").onclick = (e) => { if (e.target === $("modal")) closeModal(); };
document.addEventListener("keydown", (e) => {
  if (!$("modal").classList.contains("on")) return;
  if (e.key === "Escape") {
    closeModal();
    return;
  }
  if (e.key !== "Tab") return;
  const items = modalFocusables();
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!$("modal").contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});

fillStaticIcons();
applyLocale();
