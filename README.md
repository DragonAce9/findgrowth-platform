# FindGrowth

Retention diagnosis for e-commerce. The app turns store and email data into a weekly money view, a client brief, a written spec, and a studio for inputs.

## What it does

- **Week** — already-paid revenue, the next order, and one Monday move
- **Brief** — the argument for the client (GDPR, product, 30/60 outcome)
- **Spec** — the contract: letter draft and the metric that must move
- **Studio** — data uploads, assumptions, and unit economics
- **Catalog** — methodology metrics (`identity_coverage`, `repeat_rate`, and related measures)

The UI is Russian. Code, docs metadata, and this repository are in English.

## Stack

- Next.js 15 (App Router), React 19, TypeScript
- SQLite on the Node side (`data/` is local and gitignored)
- Optional Python ML service via Docker Compose profiles (off by default)

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

Copy `.env.example` before production. `FG_PII_SALT` must be unique per tenant and must not be rotated in place.

## Tests and build

```bash
npm test
npx tsc --noEmit
npx next build
```

Optional services (Redis, Postgres, ML) stay off unless you start a Compose profile by hand. See `docker-compose.yml`.

## License

All rights reserved unless a license file is added later.
