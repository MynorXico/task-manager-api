# Performance Analyzer Memory — task-manager-api

## Architecture
- Runtime: Node.js + Express 5 + better-sqlite3 ^12.6.2 (synchronous SQLite)
- No Redis or external cache; no connection pool (single SQLite file)
- WAL mode enabled (good for concurrent reads)
- Single DB file: DB_PATH env var, defaults to ./tasks.db
- Rate limiting on auth routes only; no rate limiting on /tasks endpoints

## Key Files
- /home/mynorxico/task-manager-api/src/routes/tasks.ts — all CRUD + filtering logic
- /home/mynorxico/task-manager-api/src/db/schema.ts — table + index definitions
- /home/mynorxico/task-manager-api/src/db/migrations.ts — DB init, WAL pragma
- /home/mynorxico/task-manager-api/src/app.ts — Express wiring, rate limiters
- /home/mynorxico/task-manager-api/src/middleware/auth.ts — JWT verify middleware

## Schema Summary
- tasks table: id, user_id, title, description, status, priority, due_date, created_at, updated_at
- Single index: idx_tasks_user_id ON tasks(user_id) — only index on tasks
- No composite indexes; no index on status, priority, due_date, created_at
- updated_at maintained by both application code (UPDATE SET updated_at=...) AND a trigger — double write per PATCH

## Confirmed Anti-Patterns (first review, 2026-02-26)
1. db.prepare() called inside every request handler — no statement caching at app level
2. Dynamic SQL string building in GET /tasks — unique SQL per filter combo, defeats any SQLite internal cache
3. No LIMIT/pagination on GET /tasks — full table scan per user possible
4. SELECT * everywhere — fetches all 9 columns including potentially large description TEXT
5. POST: INSERT then SELECT by lastInsertRowid — extra round-trip avoidable via RETURNING
6. PATCH: SELECT (ownership) + UPDATE + SELECT (return) — 3 round-trips; last SELECT lacks user_id filter
7. include_overdue OR branch — prevents index-only scan, may force full scan depending on SQLite version
8. Missing composite index for common filter patterns (user_id, status), (user_id, due_date), (user_id, created_at)
9. updated_at double-write: PATCH sets it explicitly AND the trigger fires again — wasted write per update
10. PATCH final SELECT (line 160) uses only id, not user_id — minor auth bypass risk + wrong index usage

## better-sqlite3 Statement Caching Facts (v12)
- better-sqlite3 does NOT cache prepared statements internally by key
- Each db.prepare(sql) compiles a new SQLite statement object
- Caller is responsible for caching Statement objects at module scope
- Dynamic SQL (different string each request) makes module-scope caching impossible without a statement map

## Index Coverage Analysis
- Query: WHERE user_id = ? — uses idx_tasks_user_id (good)
- Query: WHERE user_id = ? AND status = ? — uses idx_tasks_user_id, then filters in-memory (no covering index)
- Query: WHERE user_id = ? AND due_date < ? — same, range scan after index lookup
- Query: ORDER BY created_at DESC — requires filesort after index lookup (no index on created_at)
- OR branch (include_overdue) — SQLite may use two index scans merged via OR optimization, but strftime() function prevents index use on due_date side

## Recommended Composite Indexes (priority order)
1. (user_id, created_at DESC) — covers the ORDER BY on every GET /tasks query
2. (user_id, status) — covers most common filter
3. (user_id, due_date) — covers due_before/due_after and overdue queries
