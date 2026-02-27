# Code Reviewer Memory - Task Manager API

## Project Structure & Conventions

- **Language**: TypeScript with CommonJS (tsconfig: target ES2020, module commonjs)
- **Framework**: Express 5.2.1
- **Database**: SQLite via better-sqlite3 with WAL journal mode
- **Crypto**: bcryptjs for password hashing (standard 10 rounds)
- **Auth**: jsonwebtoken with 24h expiry, Bearer token in Authorization header
- **Import style**: Uses `.js` extensions in imports (correct for CommonJS TS)

## Database Patterns

- Schema defined in `src/db/schema.ts` with `initializeSchema(db)` function
- Database instance exported from `src/db/migrations.ts` as module-level singleton
- All queries use prepared statements with parameter binding (prevents SQL injection)
- Timestamps use ISO 8601 format: `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
- Foreign keys enabled via pragma: `db.pragma('foreign_keys = ON')`
- WAL mode enabled: `db.pragma('journal_mode = WAL')`

## Common Issues to Watch

1. **Module-level side effects**: Database initialization at import time needs error handling
2. **Pragma ordering**: `foreign_keys = ON` should come before any schema operations
3. **Timestamp triggers**: AUTO-UPDATE triggers needed for `updated_at` fields, not just DEFAULT
4. **Indexing**: Need indexes on frequently queried columns (email, user_id)
5. **Interface duplication**: AuthRequest was defined in both types/index.ts and middleware/auth.ts

## Typing Conventions

- Interfaces for database models: `User`, `Task` in `types/index.ts`
- Request type extended as `AuthRequest extends Request { user?: JwtPayload }`
- Strong typing: prepared statements cast results as `as User | undefined`

## Error Handling Patterns

- Routes return explicit JSON error responses with status codes
- Authentication errors: 401
- Resource not found: 404
- Validation errors: 400
- Conflicts (duplicate email): 409
- No try-catch in routes currently—relied on prepared statement exceptions

## PATCH /tasks/:id Critical Issues Found

1. **COALESCE prevents nullable field clearing**: COALESCE(?, col) makes it impossible to set description/due_date to NULL (same as omitting field)—contradicts PATCH semantics
2. **updated_at double-write creates stale RETURNING**: Both UPDATE statement and AFTER trigger set updated_at; RETURNING fires before trigger, so returned value differs from stored value
3. **ID parameter type coercion**: id is string cast, bound to INTEGER PRIMARY KEY. SQLite coerces "123abc" → 123, "0x7B" → 0, silently returning wrong rows instead of 404
4. **Empty title allowed in PATCH**: POST rejects empty/whitespace-only titles, but PATCH allows them (trim() produces empty string, COALESCE passes it)
5. **No body validation**: Empty PATCH {} or non-JSON triggers all-null COALESCE; still UPDATEs updated_at wastefully

## Next Review Checkpoints

- Verify PATCH refactored to use dynamic SET clause with 'field' in body checks
- Confirm all ID params validated as positive integers before DB queries
- Check updated_at strategy: either remove trigger or remove explicit SET (not both)
- Validate request Content-Type in body-accepting routes
