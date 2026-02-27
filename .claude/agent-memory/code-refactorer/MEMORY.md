# Code Refactorer — Project Memory

## Project: task-manager-api

### Stack
- Express + TypeScript, better-sqlite3, Vitest, supertest
- Tests run with: `npx vitest run tests/tasks.test.ts`
- Type check with: `npx tsc --noEmit`

### Architecture
- `src/routes/tasks.ts` — all task CRUD routes; prepared statements hoisted inside `tasksRouter()` factory
- `src/routes/auth.ts` — auth routes
- `src/middleware/auth.ts` — JWT `authenticate` middleware; `AuthRequest` extends `Request` with `user?: AuthPayload`
- `src/types/index.ts` — shared types: Task, TaskStatus, TaskPriority, CreateTaskBody, UpdateTaskBody, FilterParams, AuthPayload
- `src/db/schema.ts` — `initializeSchema(db)` helper used in tests
- `tests/tasks.test.ts` — 68 integration tests using in-memory SQLite

### Refactoring Patterns Applied (tasks.ts session)
1. **`resolveTaskId(raw, res)`** — encapsulates `parseTaskId` + 404 guard; returns `number | null`. Callers do `if (!id) return;`. Used in GET/:id, PATCH/:id, DELETE/:id. DELETE does NOT need the DB row, only the id — so this helper stops there intentionally.
2. **`ok(value)`** — wraps any value in `{ data: value }` for uniform success responses.
3. **`validateEnums(status, priority)`** — returns error string or null; used in GET /, POST /, PATCH /. Checks status first, then priority, preserving original error message format.
4. **Section dividers** — replaced `// ---...--- //` banners with single `// VERB /path` comment lines.

### Conventions
- All SQL queries, status codes, and response shapes are contractual — never change them during refactoring
- `stmtCache` pattern (dynamic SQL compiled once) must remain intact
- Prepared statements are hoisted inside the router factory (not module-level) because they depend on `db`
- Success responses: `{ data: T }` for single resources, `{ data: T[], meta: { total, limit, offset } }` for lists
- Error responses: `{ error: string }` with appropriate HTTP status code
- 404 is returned for both "not found" and "wrong owner" (IDOR fix via `WHERE id = ? AND user_id = ?`)

### Test Infrastructure
- Each `describe` block creates a fresh in-memory DB in `beforeEach`
- `JWT_SECRET` must be set before any imports (`process.env.JWT_SECRET = '...'` as first line)
- `createUserAndLogin` helper registers + logs in a user and returns their JWT token
