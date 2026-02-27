import { Router, Response } from 'express';
import Database from 'better-sqlite3';
import { Task, TaskStatus, TaskPriority, CreateTaskBody, UpdateTaskBody, FilterParams } from '../types/index.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const VALID_STATUSES  = new Set<TaskStatus>(['todo', 'in_progress', 'done']);
const VALID_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high', 'urgent']);

// Matches YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

// All task columns, explicit to avoid future schema leakage
const TASK_COLS = 'id, user_id, title, description, status, priority, due_date, created_at, updated_at';

// SQLite expression used for overdue comparisons
const NOW_EXPR = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
const OVERDUE_CLAUSE = `due_date < ${NOW_EXPR} AND status != 'done'`;

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

/** Parses a route :id param to a positive integer, or returns null for any
 *  non-integer string (e.g. "abc", "1.5", "0x7B") so handlers return 404. */
function parseTaskId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === raw ? n : null;
}

/** Parses the :id param and sends a 404 if invalid, returning null.
 *  Callers must return immediately when this returns null. */
function resolveTaskId(raw: string, res: Response): number | null {
  const id = parseTaskId(raw);
  if (!id) { res.status(404).json({ error: 'Task not found' }); return null; }
  return id;
}

/** Wraps any value in the standard { data } response envelope. */
function ok(value: unknown): { data: unknown } {
  return { data: value };
}

/** Validates status and priority enum values.
 *  Returns an error message string if either is invalid, or null if both are valid. */
function validateEnums(status: string | undefined, priority: string | undefined): string | null {
  if (status !== undefined && !VALID_STATUSES.has(status as TaskStatus)) {
    return `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}`;
  }
  if (priority !== undefined && !VALID_PRIORITIES.has(priority as TaskPriority)) {
    return `Invalid priority. Must be one of: ${[...VALID_PRIORITIES].join(', ')}`;
  }
  return null;
}

export function tasksRouter(db: Database.Database): Router {
  const router = Router();

  // Static prepared statements — compiled once, reused on every request
  const stmtGetById = db.prepare(
    `SELECT ${TASK_COLS} FROM tasks WHERE id = ? AND user_id = ?`
  );

  const stmtInsert = db.prepare(`
    INSERT INTO tasks (user_id, title, description, status, priority, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING ${TASK_COLS}
  `);

  const stmtDelete = db.prepare(
    'DELETE FROM tasks WHERE id = ? AND user_id = ?'
  );

  // Dynamic statement cache — list queries vary by active filter combination.
  // Converges to at most 16 unique SQL strings (2^4 filter combos × 2 for
  // overdue) × 2 (list + count) = 32 entries, then stops growing.
  const stmtCache = new Map<string, Database.Statement>();

  function getStmt(sql: string): Database.Statement {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  router.use(authenticate);

  // GET /tasks
  router.get('/', (req: AuthRequest, res: Response) => {
    const { status, priority, due_before, due_after, include_overdue } =
      req.query as Partial<Record<keyof FilterParams, string>>;

    const enumError = validateEnums(status, priority);
    if (enumError) { res.status(400).json({ error: enumError }); return; }

    if (due_before !== undefined && !ISO_DATE_RE.test(due_before)) {
      res.status(400).json({ error: 'due_before must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' });
      return;
    }

    if (due_after !== undefined && !ISO_DATE_RE.test(due_after)) {
      res.status(400).json({ error: 'due_after must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' });
      return;
    }

    const limit  = Math.min(Math.max(parseInt(req.query.limit  as string) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const userId = req.user!.userId;
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (status)     { conditions.push('status = ?');   filterParams.push(status); }
    if (priority)   { conditions.push('priority = ?'); filterParams.push(priority); }
    if (due_before) { conditions.push('due_date < ?'); filterParams.push(due_before); }
    if (due_after)  { conditions.push('due_date > ?'); filterParams.push(due_after); }

    const isOverdue = include_overdue === 'true';
    const filterWhere  = conditions.length > 0 ? `user_id = ? AND ${conditions.join(' AND ')}` : null;
    const overdueWhere = `user_id = ? AND ${OVERDUE_CLAUSE}`;

    let listSql: string;
    let countSql: string;
    let listParams: unknown[];
    let countParams: unknown[];

    if (filterWhere && isOverdue) {
      // UNION: each branch gets a clean single-predicate index seek
      listSql  = `SELECT ${TASK_COLS} FROM tasks WHERE ${filterWhere} UNION SELECT ${TASK_COLS} FROM tasks WHERE ${overdueWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) AS total FROM (SELECT id FROM tasks WHERE ${filterWhere} UNION SELECT id FROM tasks WHERE ${overdueWhere})`;
      listParams  = [userId, ...filterParams, userId, limit, offset];
      countParams = [userId, ...filterParams, userId];
    } else if (filterWhere) {
      listSql  = `SELECT ${TASK_COLS} FROM tasks WHERE ${filterWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) AS total FROM tasks WHERE ${filterWhere}`;
      listParams  = [userId, ...filterParams, limit, offset];
      countParams = [userId, ...filterParams];
    } else if (isOverdue) {
      listSql  = `SELECT ${TASK_COLS} FROM tasks WHERE ${overdueWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) AS total FROM tasks WHERE ${overdueWhere}`;
      listParams  = [userId, limit, offset];
      countParams = [userId];
    } else {
      listSql  = `SELECT ${TASK_COLS} FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) AS total FROM tasks WHERE user_id = ?`;
      listParams  = [userId, limit, offset];
      countParams = [userId];
    }

    const tasks = getStmt(listSql).all(...listParams) as Task[];
    const { total } = getStmt(countSql).get(...countParams) as { total: number };

    res.json({ data: tasks, meta: { total, limit, offset } });
  });

  // POST /tasks
  router.post('/', (req: AuthRequest, res: Response) => {
    const { title, description, status, priority, due_date } = req.body as CreateTaskBody;

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const enumError = validateEnums(status, priority);
    if (enumError) { res.status(400).json({ error: enumError }); return; }

    // INSERT ... RETURNING * — single round-trip, no follow-up SELECT needed
    const task = stmtInsert.get(
      req.user!.userId,
      title.trim(),
      description ?? null,
      status ?? 'todo',
      priority ?? 'medium',
      due_date ?? null,
    ) as Task;

    res.status(201).json(ok(task));
  });

  // GET /tasks/:id
  router.get('/:id', (req: AuthRequest, res: Response) => {
    const id = resolveTaskId(req.params.id as string, res);
    if (!id) return;

    const task = stmtGetById.get(id, req.user!.userId);

    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    res.json(ok(task));
  });

  // PATCH /tasks/:id
  router.patch('/:id', (req: AuthRequest, res: Response) => {
    const id = resolveTaskId(req.params.id as string, res);
    if (!id) return;

    const body = (req.body ?? {}) as UpdateTaskBody;
    const { status, priority } = body;

    const enumError = validateEnums(status, priority);
    if (enumError) { res.status(400).json({ error: enumError }); return; }

    // Build the SET clause dynamically so that:
    //   - Fields absent from the body are not touched (no COALESCE needed)
    //   - Fields explicitly set to null ARE written as NULL (clears description/due_date)
    const sets: string[] = [];
    const params: unknown[] = [];

    if ('title' in body) {
      const trimmed = (body.title ?? '').trim();
      if (!trimmed) {
        res.status(400).json({ error: 'title cannot be empty' });
        return;
      }
      sets.push('title = ?');
      params.push(trimmed);
    }
    if ('description' in body) { sets.push('description = ?'); params.push(body.description ?? null); }
    if ('status'      in body) { sets.push('status = ?');      params.push(body.status); }
    if ('priority'    in body) { sets.push('priority = ?');    params.push(body.priority); }
    if ('due_date'    in body) { sets.push('due_date = ?');    params.push(body.due_date ?? null); }

    if (sets.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    sets.push(`updated_at = ${NOW_EXPR}`);

    // Dynamic SQL cached by shape — up to 31 unique strings (2^5 - 1 combos),
    // compiled once and reused via stmtCache.
    // RETURNING captures the row after the SET (trigger removed, so no stale value).
    const sql = `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING ${TASK_COLS}`;
    params.push(id, req.user!.userId);

    const task = getStmt(sql).get(...params) as Task | undefined;

    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    res.json(ok(task));
  });

  // DELETE /tasks/:id
  router.delete('/:id', (req: AuthRequest, res: Response) => {
    const id = resolveTaskId(req.params.id as string, res);
    if (!id) return;

    const { changes } = stmtDelete.run(id, req.user!.userId);

    if (changes === 0) { res.status(404).json({ error: 'Task not found' }); return; }

    res.json(ok({ deleted: true }));
  });

  return router;
}
