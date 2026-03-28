# Technology Stack

**Analysis Date:** 2026-03-28

## Languages

**Primary:**
- TypeScript (project-level, strict mode) - application code in `src/**/*.ts` and `src/**/*.tsx` configured by `tsconfig.json`.
- JavaScript (Node/CommonJS + ESM scripts) - tooling/ops scripts in `scripts/*.cjs`, `scripts/*.mjs`, config files like `next.config.js`, `tailwind.config.js`.

**Secondary:**
- Bash - operational and deploy automation in `scripts/*.sh`, `docker-entrypoint.sh`, `install.sh`.
- SQL (embedded via migrations) - schema/migration logic in `src/lib/migrations.ts` and `src/lib/schema.sql`.

## Runtime

**Environment:**
- Node.js >=22 (enforced in `package.json` engines and `scripts/check-node-version.mjs`).
- Standard local runtime pin: `22` in `.nvmrc` and `.node-version`.

**Package Manager:**
- pnpm (Corepack-enabled in `Dockerfile`; CI installs pnpm v10 in `.github/workflows/quality-gate.yml`).
- Lockfile: present (`pnpm-lock.yaml`).

## Frameworks

**Core:**
- Next.js `^16.1.6` - app/router server + UI framework (`package.json`, `src/app/**`, `next.config.js`).
- React `^19.0.1` + React DOM `^19.0.1` - client UI layer (`src/components/**`, `src/store/index.ts`).
- next-intl `^4.8.3` - i18n plugin integrated in `next.config.js` via `./src/i18n/request.ts`.
- Zustand `^5.0.11` - client state container (`src/store/index.ts`).

**Testing:**
- Vitest `^2.1.5` + jsdom - unit/integration tests configured in `vitest.config.ts`.
- Playwright `^1.51.0` - E2E browser testing configured in `playwright.config.ts` and `tests/**`.
- Testing Library (`@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`) - component/unit assertions.

**Build/Dev:**
- Next build/dev/start scripts in `package.json` (`dev`, `build`, `start`, `start:standalone`).
- ESLint 9 + `eslint-config-next` configured in `eslint.config.mjs`.
- Tailwind CSS + PostCSS + Autoprefixer configured in `tailwind.config.js` and `postcss.config.js`.
- Docker multi-stage build for standalone runtime in `Dockerfile`.

## Key Dependencies

**Critical:**
- `better-sqlite3` `^12.6.2` - embedded primary database (`src/lib/db.ts`, migrations in `src/lib/migrations.ts`).
- `zod` `^4.3.6` - request/body validation schemas (`src/lib/validation.ts`).
- `pino` `^10.3.1` - server logging (`src/lib/logger` usage across API and lib modules).
- `ws` `^8.19.0` - WebSocket transport support for gateway/server flows.

**Infrastructure:**
- `next`, `react`, `react-dom` - web runtime.
- `next-intl`, `next-themes` - localization and theming.
- `@scalar/api-reference-react` - API docs UI surfaced from `openapi.json`.
- `@xyflow/react`, `reagraph`, `recharts` - graph/visualization panels in dashboard UI.

## Configuration

**Environment:**
- Centralized runtime config in `src/lib/config.ts` (data dir, db path, gateway host/port, OpenClaw paths, retention settings).
- Security/runtime headers and host controls in `next.config.js` and `src/proxy.ts`.
- Secrets/credentials are runtime env-driven via `process.env`, with auto-generation fallback in `src/lib/auto-credentials.ts` persisted under `.data/.auto-generated`.

**Build:**
- Next standalone output enabled in `next.config.js` (`output: 'standalone'`).
- Build and deploy helpers: `scripts/start-standalone.sh`, `scripts/deploy-standalone.sh`.
- Container build/runtime wiring in `Dockerfile` and `docker-compose.yml` (+ hardened overlay `docker-compose.hardened.yml`).
- API contract parity guard in `scripts/check-api-contract-parity.mjs` against `openapi.json`.

## Platform Requirements

**Development:**
- Node 22+, pnpm, libc toolchain for native module compile (`better-sqlite3` requires `python3 make g++` in `Dockerfile` deps stage).
- Optional local OpenClaw runtime/gateway binaries resolved from `src/lib/config.ts` (`OPENCLAW_BIN`, gateway host/port vars).

**Production:**
- Deployment targets:
- Containerized runtime via GHCR/Docker Hub images (`.github/workflows/docker-publish.yml`).
- Standalone Next server process (build artifact `.next/standalone/server.js`, launched via `scripts/start-standalone.sh`).
- Persistent writable storage required for `.data` SQLite/tokens (`docker-compose.yml` volume `mc-data` to `/app/.data`).

---

*Stack analysis: 2026-03-28*
