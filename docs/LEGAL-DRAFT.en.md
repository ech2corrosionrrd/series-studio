# Series Lab legal texts — DRAFT

> **This is a draft for a lawyer, not legal advice and not a binding document.** It describes what the product actually does (code and server as of 2026-10-05). Nothing has been published. Items in `[square brackets]` are decisions for the owner or a lawyer. Ukrainian version: [LEGAL-DRAFT.md](./LEGAL-DRAFT.md). The lawyer checklist is at the end.
>
> The structure follows the `LEGAL.md` of the Промт project; everything that differs in Series Lab was changed (direct payments on Solana, Arweave, creator keys stay on the user's PC).

Effective: `[date]` · Contact: `[email]` · Service: https://lab.w3ir.io `[final address]`

This document has three parts: **1. Terms of Service**, **2. Privacy Policy**, **3. Refund Policy**.

---

## 1. Terms of Service

### 1.1. Acceptance
By using Series Lab (the "Service", "we") you accept these Terms. If you disagree, do not use the Service. The Service is provided by `[full operator name: individual / sole proprietor / company, country, registration details]`.

### 1.2. What the Service is
Series Lab is a workshop for NFT series: a preset, recipes (plans for individual NFTs), image generation by third-party AI providers, review, export of metadata and packages for marketplaces and launchpads, a checklist and a launch kit.

The Service **does not mint NFTs**, is not an exchange or marketplace, does not custody your assets and **never receives your private keys**. Signing `series mint`, `series reveal` and uploads from your wallet (`series upload --keypair`) happen on your own computer. You mint and sell elsewhere, yourself.

### 1.3. Age and legality
You must be **18 or older** with legal capacity. You are not located in a jurisdiction where sanctions forbid use `[confirm with a lawyer]`. You are solely responsible for complying with the laws of your country on generative content, crypto-assets and NFTs.

### 1.4. Sign-in and wallet
Sign-in is by a wallet message signature (SIWE for EVM or a Solana signature). We never see or store your private key or seed phrase, and the Service never asks for them. You are responsible for your wallet's security and everything done under it. A session lasts a limited time (currently 4 hours).

### 1.5. Credits and payment
- **Credits** are internal units that cover generation costs. They are not money, e-money or securities; they have no value outside the Service and are not transferable or exchangeable for cash or crypto.
- **Top-ups** are made by transferring **USDC on Solana** to the operator's public address `[recipient address]` shown in the Service. The payment is verified on-chain and credits are added after confirmation. We do not collect bank details.
- The package price and per-frame cost are shown before you run anything. The free estimate ("Count") does not spend credits.
- **Welcome and referral credits** are one-time promotional grants under the Service's rules; for welcome credits we check that the wallet is not empty. We may change their size and conditions. Creating many wallets to collect them is forbidden.
- If a generation fails, credits are **refunded automatically** to your balance.
- Refunds of money are covered in part 3.

### 1.6. Acceptable use
You must not create or attempt to create:
- sexualised images of minors or any sexual content involving children, or depictions of sexual violence;
- content that infringes copyrights, trademarks or likeness rights; prompts naming brands, franchises or celebrities are blocked before generation;
- deception, impersonation, fraud or malware.

We may reject prompts, rate-limit and **suspend access** for breach or abuse (including farming welcome credits and attacks on the Service). You are responsible for all content you create and upload.

### 1.7. Your materials
You upload base images, PNG layers and other files and warrant that you have the rights to them. You grant us a limited licence to store and process them **only to provide the Service to you** (including sending them to the AI provider you choose for generation).

### 1.8. Rights in outputs
Rights in AI-generated images are governed by the terms of the relevant provider (`[list: OpenAI, Anthropic, Stability, Replicate, fal.ai, Runware, Pollinations and others in the Service]`) and the law of your country: in some jurisdictions AI-generated works may not be protected by copyright. To the extent of our rights you may use what you create. **You are solely responsible** for ensuring prompts and outputs do not infringe third-party rights, and for the legality of minting and selling.

Our software, interface, name and logo remain our property.

### 1.9. AI disclaimer
Generative model output is probabilistic: it may be inaccurate, offensive, similar to existing works or not unique. We **do not guarantee** uniqueness, quality or fitness for a purpose. Review output before minting. The Service's checks (checklist, preflight, "Find similar", rarity) are aids, not guarantees.

### 1.10. No financial or legal advice
Nothing in the Service is investment, legal or tax advice. NFTs are high-risk; we **do not guarantee any value** of created assets.

### 1.11. Third-party services
The Service relies on third parties: AI providers, Arweave/Irys (permanent storage), Solana RPC nodes `[provider]`, Cloudflare, hosting `[Hetzner]`, launchpads and marketplaces. Their operation is governed by their own terms; we are not liable for their outages, price changes or availability. Files uploaded to Arweave **become public and immutable**.

### 1.12. Availability
The Service runs in **beta**, "as is": expect outages, feature changes and downtime. We back up data but do not guarantee uninterrupted operation. Keep your own copies of important files.

### 1.13. Disclaimer of warranties and limitation of liability
The Service is provided **"as is"**, without warranties. To the extent permitted by law we are not liable for indirect or incidental damages, lost profit or losses from minting or selling NFTs. Total liability is capped at the amount you paid the Service in the preceding **3 months** `[agree with a lawyer]`. You will indemnify us for losses arising from your breach of these Terms.

### 1.14. Suspension and termination
We may suspend or terminate access for breach. You may stop using the Service at any time. Unused credits are not refunded after a termination caused by your breach.

### 1.15. Changes and law
We may update these Terms; material changes are marked with a new "Effective" date. Governing law and venue: `[jurisdiction]`. Questions: `[email]`.

---

## 2. Privacy Policy

### 2.1. Who we are
Operator: `[name, country, address]`. Data contact: `[email]`.

### 2.2. Data we process

| Data | Why | Where it lives |
|---|---|---|
| **Wallet address** (public) | account identifier, balance, history | server database |
| **Credit ledger**: grants, debits, refunds (type, amount, engine, note, time) | credit accounting, abuse prevention | database |
| **Payment data**: Solana transaction signature, amount, package, time | crediting, reconciliation | database; the transaction itself is public on-chain |
| **Referral code** and invitation link | referral bonuses | database |
| **One-time sign-in nonce** and **session cookie** | wallet sign-in | database; browser |
| **Your files**: base images, presets, recipes, generated images and their versions, PNG layers, export packages, review marks | providing the Service | server, a separate folder per wallet |
| **Usage events**: "generated", "exported", "published" (wallet + event + time) | knowing whether the Service works, not profiling | database |
| **Paid-call log**: engine, cost, success or failure | spend accounting, spotting outages | server |
| **Technical logs**: IP address, time, request path | security, rate limiting, diagnostics | reverse proxy (up to 30 days and at most 5 files of 10 MB; cookies and authorization headers are not written) and process logs |

We **do not collect** your name, email, phone or other traditional personal data: there is no account beyond the wallet. A wallet address and payment data may be personal data under your country's law, so we treat them accordingly.

### 2.3. Purposes
To provide the Service, keep credit accounting, accept and verify payments, prevent abuse (including farming welcome credits by creating many wallets), keep it secure and improve the product. `[Legal basis for each purpose: contract, legitimate interest, consent, legal obligation: confirm with a lawyer.]`

### 2.4. Who we share with
- **AI providers** you choose for generation: your prompts and base (reference) images are sent to them to create the image: `[list: OpenAI, Anthropic, Stability AI, Replicate, fal.ai, Runware, Pollinations]`. A free-tier provider (Pollinations) may handle requests publicly: do not send sensitive material through it. If moderation or image analysis (Vision Assist) is on, a prompt or image may be sent to OpenAI or Anthropic for checking.
- **Blockchain and Solana RPC nodes** `[provider]`: addresses and transaction signatures to verify payments, read balances at sign-in (welcome credits) and check NFT holdings.
- **Arweave/Irys**: files you publish through the Arweave button become **public and immutable**.
- **Cloudflare**: traffic delivery and protection (it sees traffic to the Service). **Hosting** `[Hetzner, Germany]`: the server holding the data.
- Operational notices to the operator about **payments and referral bonuses** go to Telegram: credit amount, price, a shortened wallet address (first and last characters) and balance. Notices about users' generations are **not sent** on the public server.
- Each party has its own policy. **We do not sell your data.** We may disclose data where the law requires it.

### 2.5. Retention
- The credit and payment ledger is kept while the wallet is active and afterwards as long as needed for accounting and legal duties `[period: lawyer]`.
- Your files are kept until you delete them. Deleted files and replaced base images go to a **30-day trash**, then are erased.
- Technical logs are rotated (see the table).
- **Backups** of the ledger: hourly (48), daily (7) and weekly (4) on the server, plus a copy on the operator's computer; deleted data leaves backups when they rotate (up to `[~4 weeks]`).
- **On-chain transactions and Arweave publications are irreversible**; we cannot delete them.

### 2.6. Security
Signed sessions (HttpOnly), request-origin checks, service keys kept on the server and never sent to the browser, per-wallet data isolation, backups with restore checks, monitoring. No system is 100% secure.

### 2.7. Your rights
You may ask for **access to, correction or deletion of** your wallet's data (email `[email]` with the wallet address; to confirm, we may ask you to sign a message with that wallet). This does not cover on-chain records. **You can delete your data yourself:** the "My data" button in the top bar (after sign-in) deletes all your files, usage events, referral code and sign-in codes, and removes your series names from the spend log. **Kept** are the wallet address, credit balance and payment and spend history (money accounting, refunds), because they must be retained; the button says so. Backups are cleared as they rotate. `[For EU/EEA residents: GDPR rights, the right to complain to a supervisory authority, accounting periods: confirm with a lawyer.]`

### 2.8. Cookies
Only an **essential session cookie** `w3ir_session` (HttpOnly, SameSite=Lax, Secure; valid up to 4 hours). Cloudflare may set technical security cookies. The Service has no third-party advertising or analytics cookies or scripts.

### 2.9. Children
The Service is not intended for anyone under 18.

### 2.10. International transfers
Data is processed on a server in `[Germany]`, and AI providers and Cloudflare may process it `[in the US and other countries]`. `[Lawful transfer mechanisms, for example standard contractual clauses: lawyer.]`

### 2.11. Changes
Changes are marked with a new "Effective" date. Questions: `[email]`.

---

## 3. Refund Policy

### 3.1. Nature of payments
Payment is by **cryptocurrency (USDC on Solana)** sent directly to the operator's address. Such transfers are **technically irreversible**; there are no chargebacks. Credits are digital consumable units.

### 3.2. Not refunded
- **Consumed credits** (spent on generations).
- **Welcome, referral and granted** credits: promotional, with no cash value.
- Payments sent by mistake to a wrong address or on a wrong network (we do not control other people's wallets and networks).

### 3.3. Considered case by case
Refunds of **unused** credits or a payment are considered individually within **14 days** for a technical reason: double charge, payment confirmed on-chain but credits not delivered, a Service error. Send the wallet address and transaction signature to `[email]`. We reply within `[a few business days]`. If approved, the refund is in **USDC to the sender's address**, minus `[network fees]`.

### 3.4. Failed generations
If a generation fails, credits are **refunded automatically** to your balance; no action is needed.

---

## For the lawyer and the owner (checklist)

1. **Operator:** who legally provides the Service (sole proprietor, company, individual), country, registration, contacts. Sections 1.1, 1.15 and 2.1 are incomplete without it.
2. **Law and venue:** governing law, dispute venue, consumer rights (they depend on the user's country).
3. **Crypto payments:** whether KYC/AML, licences or registration are needed to accept USDC; taxes (VAT, income), accounting; especially for users from the EU or US.
4. **Data protection (GDPR and similar):** roles (controller/processor), legal bases, processor agreements (AI providers, Cloudflare, hosting), transfer mechanisms, log retention periods, whether an EU representative is needed.
5. **Content and moderation:** a procedure for infringement complaints, a response process for unlawful content (notice-and-takedown), whether input moderation is needed beyond the prompt filter.
6. **Rights in AI outputs:** check each provider's terms for commercial use, especially the free Pollinations tier; whether users need warnings about copyrightability.
7. **Liability cap and age:** limits allowed by your law, whether a self-declaration of 18+ is enough.
8. **Sanctions and restricted regions:** whether to block access and which list.
9. **Technical items:**
   - closed on 2026-10-05: the "My data" button (deletes files and usage records, money accounting stays); content of operator notices (payments and referral bonuses only, shortened addresses); proxy log retention (30 days, 5×10 MB); no third-party analytics;
   - open: `/terms` and `/privacy` pages with links in the footer and at first sign-in (with explicit consent if the lawyer requires it): publish only after the texts are approved;
   - the lawyer should confirm that keeping the balance and payment history after "My data" is permissible under your law.

*Prepared against the code as of 2026-10-05. Each data statement was checked against `src/platform/db.mjs`, `src/platform/session.mjs`, the `.env.example` settings and the server configuration.*
