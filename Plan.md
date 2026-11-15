# Plan.md — Optional Risk, Architecture & Budget Draft (Build 2)

Use this as a scratchpad if helpful. Publish PRD v2 and the Build 2 log on `docs/index.html`; this file is not a separate hand-in.

**Due:** Monday, Nov 16, 2026 at 12:00 PM (Noon)  
**Builder:** D (`@dav-ro-11`)

---

## 1. What is the riskiest part?
*What is the single most likely reason this product fails to work for a real user (e.g., model hallucination on messy PDFs, latency, auth, bad data, third-party API limits)? How does your smallest local version test that risk first?*

- **#1 Technical / Product Risk:** Owners will not let Serv choose the pro and the price. If they insist on picking, Serv is a marketplace again and repeat jobs leave for a text and Zelle. The software side of that risk: one wrong read of a tenant's message on the first try, and the owner stops trusting the card.
- **How Build 2 tests it right now:** The owner card has three answers (Approve, I would rather pick the pro, Not now) and each tap is recorded in PostHog as `owner_decision`. Pass mark for the 10-owner trial: 6 approve a real job without asking to pick. The AI only names a price list line; code sets the price and the pro, asks instead of guessing under 60% confidence, and never prices an emergency.

## 2. The Smallest Working Version (Architecture)
*Use AI to understand the main components, data flow, and risks, then explain them in your own words.*

- **Stack (Frontend / Backend / DB):** Plain HTML, CSS and JavaScript / Node.js built-in http server, no packages / one local JSON file
- **Local run command:** `npm start`
- **Local URL (Build 2):** http://localhost:3000
- **Models used (via OpenRouter or provider):** Claude Opus through OpenRouter, one call per tenant report (`OPENROUTER_MODEL` in `.env` overrides)

## 3. Time & Money Budget
*Estimate what it will cost to build and what it costs each time a user runs a job.*

| Item | Estimate | Notes |
| :--- | :--- | :--- |
| **Build budget (coding agent / OpenRouter)** | `$` | |
| **Unit cost per user action (inference/API)** | `$0.02 to $0.03 / run` | Estimate: about 1,300 tokens in (2,900 with a photo), 700 out. The app prints the measured cost of each call. |
| **Hosting cost (monthly)** | `$0 / mo` | Local through Week 4. GitHub Pages for the Product Page is free. |
| **Your engineering time budget** | `hrs/wk` | |

## 4. Security & Recovery Checklist
- [x] `.env` and API keys are excluded via `.gitignore`
- [ ] Spending limits or alerts are configured where the provider supports them
- [ ] Least-privilege permissions on any external data/APIs
- [ ] Git save point for undoing a broken local change; add a cloud rollback path in Build 5
