# Test Writer Agent Memory

## Project Overview
Task Manager REST API — Express 5, TypeScript, better-sqlite3, bcryptjs, jsonwebtoken.
Tests live in `/home/mynorxico/task-manager-api/tests/`.

## Testing Stack
- **Framework**: Vitest 4.0.18 (with Vite 7)
- **HTTP assertions**: supertest 7.2.2 (@types/supertest 7.2.0)
- **Config file**: `vitest.config.mjs` (must be `.mjs`, NOT `.ts` — see Gotchas)
- **Run command**: `npx vitest run tests/<file>.test.ts`

## Key Patterns

### Test app setup (bypass app.ts)
Never import `src/app.ts` in tests — it has a startup guard that calls `process.exit(1)`
if JWT_SECRET is missing/short, and it applies rate limiters. Instead, build a minimal
test app directly from the router factory:

```ts
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'; // BEFORE any imports

import express from 'express';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema.js';
import { authRouter } from '../src/routes/auth.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

function buildApp(db) {
  const app = express();
  app.use(express.json({ limit: '2kb' }));
  app.use('/auth', authRouter(db));
  return app;
}
```

### DB isolation strategy
- Create a fresh `new Database(':memory:')` per `describe` block (in `beforeEach`)
- This gives complete test isolation without teardown complexity
- Close the DB in `afterAll` to release memory

### JWT_SECRET requirement
- Must be set to a string >= 32 chars BEFORE importing any source file
- Set it as the first statement in the test file, before all imports

## Gotchas

### vitest.config must be .mjs (not .ts)
Vitest 4 + Vite 7 are pure ESM. The project has no `"type": "module"` in package.json,
so Node loads `.ts` config via CJS interop, which fails with `ERR_REQUIRE_ESM`.
Solution: use `vitest.config.mjs` with `export default defineConfig({...})`.

### .js extension imports in TypeScript source
Source files use `.js` extensions in imports (TypeScript Node16 convention).
Vitest resolves these to `.ts` files automatically — no special alias needed.
The `resolve.extensions` array in vitest.config.mjs ensures `.ts` is tried first.

### bcrypt makes tests slow
bcrypt with cost factor 10 is intentional. The register + login test suite takes ~2.8s.
Do not mock bcrypt — it would break integration-level login tests.

## Auth Route Response Shapes (confirmed)
- Register 201: `{ data: { id, email, created_at } }` — no password_hash
- Register 400 (duplicate): `{ error: "Registration could not be completed" }` — NOT 409
- Login 200: `{ data: { token: string, user: { id, email } } }`
- Login 401: `{ error: "Invalid credentials" }` — same for wrong pw AND unknown email
- Login 400 (missing fields): `{ error: "email and password are required" }`
- Login/Register 400 (password >72 bytes): `{ error: "Password must not exceed 72 characters" }`

## File Locations
- Tests: `/home/mynorxico/task-manager-api/tests/auth.test.ts`
- Vitest config: `/home/mynorxico/task-manager-api/vitest.config.mjs`
- Auth router: `/home/mynorxico/task-manager-api/src/routes/auth.ts`
- Schema init: `/home/mynorxico/task-manager-api/src/db/schema.ts`
