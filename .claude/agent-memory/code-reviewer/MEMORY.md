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

## Next Review Checkpoints

- Verify schema indexes are added for common query paths
- Confirm auto-update triggers work for `updated_at` field
- Check that AuthRequest interface is single-sourced from types/index.ts
- Look for any new module-level side effects in db initialization
