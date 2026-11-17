# Serv

> **One-line pitch:** The super for rental buildings too small to have one: tenants text one number, Serv works out the repair and sends a vetted pro at a set price, and the owner approves in one tap.

- **Builder:** D (`@dav-ro-11`)
- **Pod:** [Pod Name / Number]
- **Product Page & Living PRD:** https://building-with-ai-f26.github.io/dmr605-Serv/
- **App:** runs locally through Week 4; add a cloud URL in Build 5.

## Start here: Build 1

**Due Monday, November 9 at noon, New York time.** No class November 3; keep building that week.

1. Join the [class organization](https://github.com/building-with-ai-f26), then use this template to create a **public** repo named `<netid>-<project-slug>`. Ask Christian or Hew if the organization is missing from the owner list.
2. Set up Git and one coding agent during the week of October 27. Follow the [Icerynk setup guide](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content/pre-class-setup-github-openrouter-your-coding-agent).
3. Publish [`docs/index.html`](./docs/index.html): **Settings → Pages → Deploy from a branch → main → /docs → Save**. When deployment finishes, open `https://building-with-ai-f26.github.io/<your-repo-name>/`.
4. Fill in PRD v1: a reachable user, their painful before/after workflow, one core workflow, and three non-goals.
5. Build a rough local prototype. Add a screenshot or GIF and an honest Build 1 log to the Product Page, including progress, learning, problems, costs, and hours.
6. Push meaningful commits on **at least two separate days each week outside class**, including the November 3 break.
7. Submit your **Product Page URL and repository URL in Icerynk**. Come ready to demo the prototype in two minutes on November 10.

Create your PostHog account in Week 1. Install it on the Product Page and local app in **Build 2**, then verify events. The Product Page is public from Build 1; the app can stay local through Week 4.

## Repository map

| File / folder | Purpose |
| --- | --- |
| [`docs/index.html`](./docs/index.html) | Required public pitch, living PRD, and weekly build log. Update with actual work and evidence. |
| [`Intent.md`](./Intent.md), [`Plan.md`](./Plan.md), [`journal/`](./journal/) | Optional drafting aids. No duplicate submission is required. |
| [`AGENTS.md`](./AGENTS.md) | Local run commands, project context, and agent rules. Build 2 onward. |
| [`tests/`](./tests/) | Verification guidance. Build 4 offers Track A domain evals **or** Track B user replays. |
| [`SPONSOR_MEMO.md`](./SPONSOR_MEMO.md) | One-page recommendation backed by actual usage, full costs, and risks. Due December 14 at noon. |

[Icerynk](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content) holds the assignment instructions and submissions.

## Local setup

The app needs Node.js 20 or newer and Claude Code, signed in with a Claude subscription. Structure, rules and every command are in [`AGENTS.md`](./AGENTS.md).

```bash
git clone https://github.com/building-with-ai-f26/dmr605-Serv.git
cd dmr605-Serv
npm install -g @anthropic-ai/claude-code   # once; then run `claude` and sign in
cp .env.example .env                       # once; Windows: copy .env.example .env
npm start                                  # open http://localhost:3000
npm test                                   # 26 checks, no sign-in or network needed
```

On Windows PowerShell, use `npm.cmd` in place of `npm` if PowerShell refuses to run scripts.

Type a tenant's message (or click an example), press **Send to Serv**, and the app makes one real AI call through Claude Code and shows the owner's approval card. The call takes about 10 seconds and is covered by the Claude subscription; the app prints what it would cost on the pay-per-call API (about 3 cents). To pay per call through OpenRouter instead, set `AI_PROVIDER=openrouter` and a key in `.env`.

Keep private keys out of source code, browser code, screenshots, and commits. The template ignores `.env`; `.env.example` contains placeholders only.
