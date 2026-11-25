# KejaLink Backend

REST API for KejaLink, a rental property marketplace for Kenya: tenants list properties, seekers send rent requests, admins moderate.

Fastify 5 · TypeScript · PostgreSQL + Drizzle · Better Auth · Cloudinary · Zod · Vitest.

Docs: [API](docs/api.md) · [Architecture](docs/architecture.md) · [Database](docs/database.md) · [Requirements](docs/requirements.md) · [Decisions](docs/DECISIONS.md) · [Audit](docs/AUDIT.md)

## Requirements

- Node.js **22 or newer** (`.nvmrc`)
- PostgreSQL 14 or newer
- A Cloudinary account (for property images)
- Docker (optional, for a throwaway test database)

## First run

```bash
npm install
cp .env.example .env          # then fill in every value (see below)
npm run db:migrate            # create the schema
npm run seed:admin            # create the first admin (reads ADMIN_* from .env)
npm run dev                   # http://localhost:5000/api/health
```

## Environment variables

| Variable | Required | Purpose / where to get it | Example |
|---|---|---|---|
| `NODE_ENV` | no | `development`, `production` or `test` | `production` |
| `HOST` | no | Bind address. Defaults to `127.0.0.1` in development, `0.0.0.0` in production | `0.0.0.0` |
| `PORT` | no | Default `5000` | `5000` |
| `LOG_LEVEL` | no | pino level. Default `info` | `warn` |
| `DATABASE_URL` | **yes** | PostgreSQL connection string (local or managed provider) | `postgresql://kejalink:pass@127.0.0.1:5432/kejalink` |
| `BETTER_AUTH_SECRET` | **yes** | At least 32 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `9f2c…` (64 hex chars) |
| `BETTER_AUTH_URL` | **yes** | Public base URL of this API, no trailing slash. **Must be https in production** (this also gives `Secure` cookies) | `https://api.kejalink.co.ke` |
| `FRONTEND_URL` | **yes** | Frontend origin(s), comma-separated. Used for CORS and auth trusted origins | `https://kejalink.co.ke,https://www.kejalink.co.ke` |
| `TRUST_PROXY` | no | Number of reverse-proxy hops in front of the API. Default `1` in production, `0` otherwise | `1` |
| `AUTH_RATE_LIMIT_MAX` | no | Max `/api/auth/*` requests per minute per IP. Default `10` | `10` |
| `MIGRATE_ON_START` | no | `true` applies pending migrations at boot (hosts without a pre-deploy step) | `true` |
| `CROSS_SITE_COOKIES` | no | `true` when the frontend is on another site (e.g. `*.vercel.app` + `*.onrender.com`): cookies become `SameSite=None; Secure; Partitioned`. Requires an https `BETTER_AUTH_URL` | `true` |
| `CLOUDINARY_CLOUD_NAME` | **yes** | Cloudinary console → Settings → API Keys | `dxyz123` |
| `CLOUDINARY_API_KEY` | **yes** | Same page | `123456789012345` |
| `CLOUDINARY_API_SECRET` | **yes** | Same page (keep secret) | `AbC…` |
| `ADMIN_EMAIL` | for seeding | First admin's email (read only by `seed:admin`) | `admin@kejalink.co.ke` |
| `ADMIN_PASSWORD` | for seeding | At least 12 characters; never logged | `a-long-passphrase` |
| `ADMIN_NAME` | for seeding | Display name (default `Administrator`) | `Site Admin` |

Startup fails fast with a list of the invalid variable **names**; values are never printed. Tests ignore `.env` and use `.env.test` (see below).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start with reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` (fails on type errors), then run `node dist/server.js` |
| `npm run typecheck` | Type-check `src` and `tests` |
| `npm test` | Run the Vitest suites (needs a test database) |
| `npm run db:generate` | Create a migration from schema changes (review the SQL) |
| `npm run db:migrate` | Apply migrations (drizzle-kit) |
| `npm run db:migrate:prod` | Apply migrations from the build (`node dist/scripts/migrate.js`; no dev dependencies needed) |
| `npm run seed:admin` / `seed:admin:prod` | Create or promote the first admin (idempotent) |
| `npm run db:studio` | Drizzle Studio |
| `npm run auth:generate` | Regenerate the Better Auth schema into `.drizzle/auth.generated.ts` (merge by hand; never overwrite `src/db/schema/auth.ts`) |

## Testing

The tests need their own PostgreSQL database, **whose name must contain `test`**. The harness refuses anything else, so your development database is safe.

```bash
docker run -d --name kejalink-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kejalink_test \
  -p 127.0.0.1:56543:5432 postgres:17-alpine
cp .env.test.example .env.test     # TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:56543/kejalink_test
npm test
```

- Migrations run once per test run, and tables are truncated between tests. Cloudinary is replaced by an in-memory fake.
- Tests run with `TZ=Africa/Nairobi`, to catch timezone bugs.
- **Windows:** run `npm test` from PowerShell or cmd (the VS Code default terminal). Under Git Bash, Vitest fails with "failed to find the runner".

## Deployment

1. **Build:** `docker build -t kejalink-backend .` gives a multi-stage image that runs `node dist/server.js` as the non-root `node` user, with `TZ=UTC`.
2. **Release step**, before starting new code: run the migrations with `node dist/scripts/migrate.js` (in the image) or `npm run db:migrate`. Never use `drizzle-kit push`.
3. **First deploy only:** `node dist/scripts/seed-admin.js` with `ADMIN_*` set.
4. **Environment:** `NODE_ENV=production`, `TZ=UTC`, an https `BETTER_AUTH_URL` (which gives `__Secure-` HttpOnly cookies), and `FRONTEND_URL` set to the real origin(s).
5. **Reverse proxy:** terminate HTTPS and **append** the client IP to `X-Forwarded-For`. Set `TRUST_PROXY` to the number of proxies (usually `1`). The API port must be reachable **only through the proxy**, otherwise clients could spoof their IP and dodge rate limits.
6. **Health checks:** liveness `GET /api/health`; readiness `GET /api/health/ready` (503 while the database is down).
7. **Scaling:** rate limits are in memory. Use a single instance, or add a shared store before scaling out.

## Deploying to Render (Docker)

**1. Database.** Create a Render PostgreSQL instance in the same region as the web service. Use its **Internal Database URL** as `DATABASE_URL`.

**2. Web service** (New → Web Service → this repository):

| Setting | Value |
|---|---|
| Language / Runtime | Docker |
| Branch | `main` |
| Root Directory | `backend` |
| Dockerfile Path | `./Dockerfile` (relative to the Root Directory, so it resolves to `backend/Dockerfile`) |
| Docker Build Context Directory | `.` (the `backend` folder) |
| Docker Command | leave empty (the image runs `node dist/server.js`) |
| Health Check Path | `/api/health` |
| Pre-Deploy Command (paid plans) | `node dist/scripts/migrate.js`, and then leave `MIGRATE_ON_START` unset |
| Auto-Deploy | On commit (changes outside `backend/` do not trigger a deploy) |

**3. Environment variables** (service → Environment):

```text
NODE_ENV=production
DATABASE_URL=<Render Postgres Internal Database URL>
BETTER_AUTH_SECRET=<openssl rand -hex 32, or the node one-liner above>
BETTER_AUTH_URL=https://<your-service>.onrender.com       # or your custom API domain
FRONTEND_URL=https://<your-frontend-origin>              # comma-separated if several
TRUST_PROXY=1
MIGRATE_ON_START=true                                    # free plan (no pre-deploy command)
CROSS_SITE_COOKIES=true                                  # only if the frontend is on another site
CLOUDINARY_CLOUD_NAME=…
CLOUDINARY_API_KEY=…
CLOUDINARY_API_SECRET=…
```

- Do **not** set `PORT` or `HOST`. Render injects `PORT`, and the app binds `0.0.0.0` in production.
- `TZ=UTC` is already set in the image.

**4. Cookies.** `onrender.com` is a public suffix, so a frontend anywhere else is a different site from the API.
- **Recommended:** give both a shared custom domain (`kejalink.co.ke` for the frontend and `api.kejalink.co.ke` for the API, added under Settings → Custom Domains), set `BETTER_AUTH_URL=https://api.kejalink.co.ke`, and leave `CROSS_SITE_COOKIES` unset.
- **Otherwise:** set `CROSS_SITE_COOKIES=true`. Browsers that block third-party cookies, such as Safari, may still drop them, which is why the shared domain is the reliable option.

**5. First admin.** Run the seed once from your machine against the database's **External Database URL**. Variables set in the shell override `.env`. In PowerShell:

```powershell
$env:DATABASE_URL = "<External Database URL>"
$env:ADMIN_EMAIL = "admin@kejalink.co.ke"; $env:ADMIN_PASSWORD = "<12+ characters>"; $env:ADMIN_NAME = "Site Admin"
npm run seed:admin
```

On a paid plan you can instead run `node dist/scripts/seed-admin.js` in the Render Shell.

**6. Verify.**
- `https://<service>/api/health/ready` should return `{"database":"ok"}`.
- Sign in as the admin and open `GET /api/admin/diagnostics/request`. `ip` must be your real public IP. If it shows a Render or Cloudflare address instead, increase `TRUST_PROXY` by one and check again; it must never be higher than the real number of proxies.

CI (`.github/workflows/ci.yml` at the repository root) runs typecheck, build, migrate, a drift check, tests and `npm audit --omit=dev --audit-level=high` on Node 22 and 24.
