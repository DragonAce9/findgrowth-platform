# FindGrowth

FindGrowth is a **retention diagnosis platform for e-commerce**. A brand uploads a cut of orders, site events, and (optionally) NPS. The app answers three questions:

1. What already-paid money is at risk, and who should get the next order?
2. Why this Monday move, and not another one?
3. After 30 and 60 days, did the chosen metric actually move?

It does **not** send email, export addresses, or connect a live ESP. Holdout lists stay with the brand. Scoring ranks people; only a measured treatment/control difference may be called an effect.

The product UI is Russian. This repository and the GitHub page are in English.

## Who it is for

A founder or retention lead who already has Klaviyo (or similar) and a store, and needs a written diagnosis instead of another dashboard: one week view, one argument, one spec.

Pilot context in the docs is a cosmetics / refill brand (Atelier). The engine is not limited to that category.

## What the product shows

| Screen | Route | Job |
|---|---|---|
| **Week** (Неделя) | `/` | Morning view: trust in the file, already-paid €, recency vs cycle, site funnel, one Monday Klaviyo move |
| **Brief** (Бриф) | `/agents/retention-diagnostic` | The argument: GDPR / letter permission, product pair, brand limits, 30/60 outcome |
| **Spec** (ТЗ) | `/spec` | The contract: letter subject/body, accept line, treatment vs control lists by brand key |
| **Studio** (Студия) | `/studio` | Inputs: files, assumptions (CAC, margin), unit economics |
| **Catalog** (Каталог) | `/catalog` | Methodology map for engineers (`identity_coverage`, `repeat_rate`, …) — not client morning nav |

A later IA draft (`docs/tz-semantika.md`) splits Week into Pulse / Diagnosis / Outcome / Research. That spec is not fully built in `src/` yet.

## How it thinks

Three rules, from [`docs/findgrowth-toolkit-v2.md`](docs/findgrowth-toolkit-v2.md):

1. **Forecast ranks.** Regularized models order people (ready for a first purchase, at risk after the first). The CEO never sees a raw probability like “0.63”.
2. **Facts carry intervals.** Wilson, Kaplan–Meier with censoring, Newcombe differences. A rate without an interval does not reach the screen. Missing data is “not available”, not zero.
3. **Holdout measures.** Campaign result is treatment minus control. If there is no effect, the screen says there is no effect. Predicted lift is forbidden on the product surface.

**LTV** in the product is observed revenue by horizon inside `unitEconomics`, not the SaaS formula ARPU ÷ churn. Subscription renewals are excluded from repeat / LTV / RFM / pairs.

**Identity:** visit `stable_id` is never email or `customer_id`. Email and phone enter the identity graph only as HMAC nodes (`FG_PII_SALT`).

## What this repo contains

```
src/app/          Screens (Week, Brief, Spec, Studio, Catalog, auth)
src/engine/       Diagnosis, holdout, privacy, unit economics, copy templates
methodology/      Metric definitions (YAML)
ml/               Optional Python propensity trainer (Compose profile, off by default)
docs/             Full product and frontend specs (mostly Russian)
```

Data files live in `data/` locally and are gitignored. There are no real customer files in this repository. Numbers in the toolkit that look like “91%” are synthetic.

## Full descriptions (Russian)

The short English page you are reading is the GitHub landing text. The complete “what this project does” lives here:

| Document | What it is |
|---|---|
| [`docs/findgrowth-toolkit-v2.md`](docs/findgrowth-toolkit-v2.md) | Positioning: three pillars, every statistical and ML tool, legal gates |
| [`docs/tz-semantika.md`](docs/tz-semantika.md) | Page-by-page IA: who owns which fact, SMART copy, seven-page draft |
| [`docs/frontend-requirements.md`](docs/frontend-requirements.md) | Honest data surface: intervals, lexicon, backlog F0–F8 |
| [`docs/ux-design-spec.md`](docs/ux-design-spec.md) | Layout, tokens, components |
| [`docs/ux-review-data-surface.md`](docs/ux-review-data-surface.md) | UX audit that the requirements came from |

## Stack

- Next.js 15 (App Router), React 19, TypeScript
- SQLite on Node (`data/platform.sqlite` by default)
- Optional Redis / Postgres / Python ML via Docker Compose profiles (off unless started by hand)

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is taken:

```bash
npm run dev -- -p 3010
```

Set a unique `FG_PII_SALT` per tenant in production. Do not rotate it in place: old cuts would not join.

```bash
npm test
npx tsc --noEmit
npx next build
```

## License

All rights reserved unless a license file is added later.
