# Series Lab Privacy Policy

> **The Service is in development and testing (beta).** By using it you confirm that you have read this Policy and accept it together with the [Terms of Service](https://studio.w3ir.io/en/terms/). How data is handled may change; the current version is always here.

Effective 5 October 2026 · Data contact: w3ir@pm.me

## 1. Who we are

The operator of the Service is the w3ir.io project team (a legal entity is being registered). Service: https://lab.w3ir.io.

## 2. Data we process

- **Wallet address** (public): account identifier, balance, history. Stored in the server database.
- **Credit ledger:** grants, debits, refunds (type, amount, engine, note, time). For credit accounting and abuse prevention.
- **Payment data:** Solana transaction signature, amount, package, time. For crediting and reconciliation. The transaction itself is public on-chain.
- **Referral code** and invitation link: for referral bonuses.
- **One-time sign-in nonce** and **session cookie:** for wallet sign-in.
- **Your files:** base images, presets, recipes, generated images and their versions, PNG layers, export packages, review marks. Stored on the server in a separate folder per wallet.
- **Usage events:** "generated", "exported", "published" (wallet, event, time). To know whether the Service works, not for profiling.
- **Paid-call log:** engine, cost, success or failure. For spend accounting and spotting outages.
- **Technical logs:** IP address, time, request path. For security, rate limiting and diagnostics. Reverse-proxy logs are kept up to 30 days and at most 5 files of 10 MB; cookies and authorization headers are not written to them.

We **do not collect** your name, email, phone or other traditional personal data: there is no account beyond the wallet. A wallet address and payment data may be personal data under your country's law, so we treat them accordingly.

## 3. Purposes

To provide the Service, keep credit accounting, accept and verify payments, prevent abuse (including farming welcome credits by creating many wallets), keep it secure and improve the product.

## 4. Who we share with

- **AI providers** you choose for generation: your prompts and base (reference) images are sent to them to create the image. These are OpenAI, Anthropic, Stability AI, Replicate, fal.ai, Runware and Pollinations. A free-tier provider (Pollinations) may handle requests publicly: do not send sensitive material through it. If moderation or image analysis (Vision Assist) is on, a prompt or image may be sent to OpenAI or Anthropic for checking.
- **Blockchain and Solana RPC nodes** (including Alchemy): addresses and transaction signatures to verify payments, read balances at sign-in (welcome credits) and check NFT holdings.
- **Arweave/Irys:** files you publish through the Arweave button become **public and immutable**.
- **Cloudflare:** traffic delivery and protection (it sees traffic to the Service). **Hosting:** the server holding the data is in Germany (Hetzner).
- **Operational notices to the operator** about payments and referral bonuses go to Telegram: credit amount, price, a shortened wallet address (first and last characters) and balance. Notices about users' generations are not sent on the public server.
- Each party has its own policy. **We do not sell your data.** We may disclose data where the law requires it.

## 5. Retention

- The credit and payment ledger is kept while the wallet is active and afterwards as long as needed for accounting and legal duties.
- Your files are kept until you delete them. Deleted files and replaced base images go to a **30-day trash**, then are erased.
- **Backups** of the ledger: hourly (48), daily (7) and weekly (4) on the server, plus a copy on the operator's computer; deleted data leaves backups when they rotate (up to a few weeks).
- **On-chain transactions and Arweave publications are irreversible**; we cannot delete them.

## 6. Security

Signed sessions (HttpOnly), request-origin checks, service keys kept on the server and never sent to the browser, per-wallet data isolation, backups with restore checks, monitoring. No system is 100% secure, and the Service is in testing.

## 7. Your rights

**You can delete your data yourself:** the "My data" button in the top bar (after sign-in) deletes all your files, usage events, referral code and sign-in codes, and removes your series names from the spend log. **Kept** are the wallet address, credit balance and payment and spend history (money accounting and refunds), because they must be retained. You can also ask for access to, correction or deletion of your data by email to w3ir@pm.me with the wallet address; to confirm, we may ask you to sign a message with that wallet. This does not cover on-chain records. If GDPR or a similar law applies to you, you have the rights it provides, including the right to complain to a supervisory authority.

## 8. Cookies

Only an **essential session cookie** `w3ir_session` (HttpOnly, SameSite=Lax, Secure; valid up to 4 hours). Cloudflare may set technical security cookies. The Service has no third-party advertising or analytics cookies or scripts.

## 9. Children

The Service is not intended for anyone under 18.

## 10. International transfers

Data is processed on a server in Germany, and AI providers and Cloudflare may process it in the US and other countries. By using the Service you agree to such transfers.

## 11. Changes

We may update this Policy; changes take effect when published, and material changes are marked with a new "Effective" date. Questions: w3ir@pm.me.
