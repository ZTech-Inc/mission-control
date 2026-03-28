# Testing Patterns

**Analysis Date:** 2026-03-28

## Test Framework

**Runner:**
- Vitest `^2.1.5` for unit/integration tests in `src/**` (configured in `vitest.config.ts`).
- Config: `vitest.config.ts`
- Playwright `^1.51.0` for end-to-end tests in `tests/` (configured in `playwright.config.ts`).

**Assertion Library:**
- Vitest `expect` for unit tests (`src/lib/__tests__/validation.test.ts`).
- Playwright `expect` for API/UI e2e assertions (`tests/tasks-crud.spec.ts`, `tests/i18n-language-switcher.spec.ts`).
- `@testing-library/jest-dom` matchers loaded globally via `src/test/setup.ts`.

**Run Commands:**
```bash
pnpm test                     # Run all Vitest tests
pnpm test:watch               # Vitest watch mode
pnpm test -- --coverage       # Coverage (Vitest v8 provider)
```

## Test File Organization

**Location:**
- Unit/integration tests are primarily under `src/lib/__tests__/` and occasional colocated route tests like `src/app/api/gateways/health/health-utils.test.ts`.
- E2E tests live in top-level `tests/` and execute against a real app server.

**Naming:**
- Unit/integration: `*.test.ts` (example: `src/lib/__tests__/auth.test.ts`).
- E2E: `*.spec.ts` (example: `tests/projects-crud.spec.ts`).

**Structure:**
```
src/lib/__tests__/*.test.ts      # Unit + integration-style tests with mocks
src/app/**/**/*.test.ts          # Limited API/utility colocated tests
tests/*.spec.ts                  # Playwright API/UI e2e suites
tests/helpers.ts                 # Reusable e2e factory/cleanup helpers
tests/fixtures/openclaw/**       # Offline harness fixtures
```

## Test Structure

**Suite Organization:**
```typescript
// Unit tests (Vitest)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('DELETE /api/agents/[id]', () => {
  beforeEach(() => { /* reset stubs */ })
  afterEach(() => { vi.clearAllMocks() })

  it('removes the agent from OpenClaw config...', async () => {
    // setup mock DB + invoke route + assert response and side effects
  })
})
```

```typescript
// E2E tests (Playwright)
import { test, expect } from '@playwright/test'

test.describe('Tasks CRUD', () => {
  const cleanup: number[] = []
  test.afterEach(async ({ request }) => { /* delete created entities */ })

  test('POST creates task with minimal fields', async ({ request }) => {
    const res = await request.post('/api/tasks', { /* headers + data */ })
    expect(res.status()).toBe(201)
  })
})
```

**Patterns:**
- Setup pattern: build test-local stubs/mocks in `beforeEach` and reset via `vi.resetModules()`, `vi.clearAllMocks()` (e.g. `src/lib/__tests__/agents-delete-route.test.ts`).
- Teardown pattern: e2e suites maintain an in-memory cleanup list and delete created resources in `test.afterEach` (`tests/tasks-crud.spec.ts`, `tests/projects-crud.spec.ts`).
- Assertion pattern: check both HTTP status and payload shape/content for API contracts.

## Mocking

**Framework:** `vi.mock` from Vitest.

**Patterns:**
```typescript
const requireRole = vi.fn()
vi.mock('@/lib/auth', () => ({ requireRole }))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: { logActivity: vi.fn() },
}))
```

```typescript
const { DELETE } = await import('@/app/api/agents/[id]/route')
const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) })
expect(response.status).toBe(200)
```

**What to Mock:**
- External side effects and global singletons: DB layer (`@/lib/db`), logger (`@/lib/logger`), event bus (`@/lib/event-bus`), command runners (`@/lib/command`), config modules (`@/lib/config`).
- Auth gates for focused route behavior tests (`@/lib/auth`).

**What NOT to Mock:**
- Pure schema and utility logic should run directly (`src/lib/__tests__/validation.test.ts`, `src/lib/__tests__/cron-utils.test.ts`).
- E2E specs do not mock API calls; they call real endpoints through Playwright `request`.

## Fixtures and Factories

**Test Data:**
```typescript
// tests/helpers.ts
export async function createTestTask(request, overrides = {}) {
  const title = `e2e-task-${Date.now()}`
  const res = await request.post('/api/tasks', {
    headers: API_KEY_HEADER,
    data: { title, ...overrides },
  })
  const body = await res.json()
  return { id: body.task?.id as number, title, res, body }
}
```

**Location:**
- E2E factories/helpers: `tests/helpers.ts`.
- OpenClaw harness fixtures: `tests/fixtures/openclaw/**`.
- Harness runtime bootstrap scripts: `scripts/e2e-openclaw/start-e2e-server.mjs`, `scripts/e2e-openclaw/mock-gateway.mjs`.

## Coverage

**Requirements:** Thresholds enforced in `vitest.config.ts`:
- lines: 60
- functions: 60
- branches: 60
- statements: 60

Coverage currently targets `src/lib/**/*.ts` with extensive exclusions for runtime-heavy modules in `vitest.config.ts`.

**View Coverage:**
```bash
pnpm test -- --coverage
```

## Test Types

**Unit Tests:**
- Schema and helper validation (`src/lib/__tests__/validation.test.ts`, `src/lib/__tests__/gateway-url.test.ts`, `src/lib/__tests__/task-status.test.ts`).

**Integration Tests:**
- Route-level behavior with mocked dependencies (`src/lib/__tests__/agents-delete-route.test.ts`, `src/lib/__tests__/security-scan-fix-route.test.ts`).
- Contract and configuration checks (`src/lib/__tests__/api-contract-parity.test.ts`, `src/lib/__tests__/docker-compose-schema.test.ts`).

**E2E Tests:**
- Playwright suite covering API CRUD, auth/security, and selected UI behavior (`tests/*.spec.ts`).
- Runs single-worker, non-fully-parallel in `playwright.config.ts`.

## Common Patterns

**Async Testing:**
```typescript
it('returns 401 when API key is wrong', () => {
  const result = requireRole(makeRequest({ 'x-api-key': 'wrong-key' }), 'viewer')
  expect(result.status).toBe(401)
})

test('POST creates task', async ({ request }) => {
  const res = await request.post('/api/tasks', { headers: API_KEY_HEADER, data: { title: 'x' } })
  expect(res.status()).toBe(201)
})
```

**Error Testing:**
```typescript
const res = await request.get('/api/tasks/999999', { headers: API_KEY_HEADER })
expect(res.status()).toBe(404)

const result = createTaskSchema.safeParse({})
expect(result.success).toBe(false)
```

## Notable Gaps

- Component-level tests for `src/components/**/*.tsx` are not detected; UI behavior is mostly validated via e2e (`tests/i18n-language-switcher.spec.ts`) rather than isolated component tests.
- `src/app/api/**` route coverage is broad in e2e, but many handlers do not have dedicated colocated unit tests.
- Coverage include/exclude in `vitest.config.ts` omits many server/runtime modules; treat coverage percentage as partial for orchestration-heavy code paths.

---

*Testing analysis: 2026-03-28*
