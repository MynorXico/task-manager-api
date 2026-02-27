/**
 * Integration tests for the tasks endpoints:
 *   POST   /tasks
 *   GET    /tasks
 *   GET    /tasks/:id
 *   PATCH  /tasks/:id
 *   DELETE /tasks/:id
 *
 * Strategy:
 * - A fresh in-memory SQLite DB is created per describe block, ensuring
 *   complete isolation between test suites.
 * - A minimal Express app is built directly from tasksRouter (+ authRouter for
 *   token helpers), bypassing src/app.ts and its JWT_SECRET startup guard /
 *   rate limiters.
 * - Real users are registered and logged in via POST /auth/register + /login to
 *   obtain genuine JWT tokens for authenticated requests.
 * - supertest drives HTTP assertions without binding a real network port.
 * - JWT_SECRET is set as the very first statement so every downstream import
 *   sees it correctly.
 */

// Must be the very first statement — before any source import.
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema.js';
import { authRouter } from '../src/routes/auth.js';
import { tasksRouter } from '../src/routes/tasks.js';

// ---------------------------------------------------------------------------
// Infrastructure helpers
// ---------------------------------------------------------------------------

/** Build a fresh in-memory SQLite DB with the full schema applied. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

/**
 * Build a minimal Express app wired to the given DB.
 * Both /auth and /tasks are mounted so tests can obtain real JWT tokens.
 */
function buildApp(db: Database.Database): Express {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/auth', authRouter(db));
  app.use('/tasks', tasksRouter(db));
  return app;
}

/** Register a user and return their JWT token. */
async function createUserAndLogin(
  app: Express,
  email: string,
  password = 'ValidPassword1',
): Promise<string> {
  await request(app).post('/auth/register').send({ email, password });
  const res = await request(app).post('/auth/login').send({ email, password });
  return (res.body as { data: { token: string } }).data.token;
}

/** POST /tasks with the given body using the provided bearer token. */
async function createTask(
  app: Express,
  token: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post('/tasks')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** A date clearly in the past (overdue). */
const PAST_DATE = '2020-01-01';

/** A date clearly in the future. */
const FUTURE_DATE = '2099-12-31';

// ===========================================================================
// Authentication guard — all 5 endpoints must return 401 without a token
// ===========================================================================

describe('Authentication guard', () => {
  let db: Database.Database;
  let app: Express;

  beforeEach(() => {
    db = createTestDb();
    app = buildApp(db);
  });

  afterAll(() => {
    db?.close();
  });

  const METHODS_AND_PATHS: Array<{
    method: 'get' | 'post' | 'patch' | 'delete';
    path: string;
  }> = [
    { method: 'get', path: '/tasks' },
    { method: 'post', path: '/tasks' },
    { method: 'get', path: '/tasks/1' },
    { method: 'patch', path: '/tasks/1' },
    { method: 'delete', path: '/tasks/1' },
  ];

  for (const { method, path } of METHODS_AND_PATHS) {
    it(`${method.toUpperCase()} ${path} returns 401 when no token is provided`, async () => {
      const res = await (request(app) as unknown as Record<
        string,
        (p: string) => request.Test
      >)[method](path);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it(`${method.toUpperCase()} ${path} returns 401 when an invalid token is provided`, async () => {
      const res = await (request(app) as unknown as Record<
        string,
        (p: string) => request.Test
      >)[method](path)
        .set('Authorization', 'Bearer this.is.not.a.valid.jwt');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  }
});

// ===========================================================================
// POST /tasks
// ===========================================================================

describe('POST /tasks', () => {
  let db: Database.Database;
  let app: Express;
  let token: string;
  let userId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = buildApp(db);
    token = await createUserAndLogin(app, 'alice@example.com');

    // Resolve the user id from the token payload (base64url-decode middle part)
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { userId: number };
    userId = payload.userId;
  });

  afterAll(() => {
    db?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 201 with { data: Task } containing all expected fields', async () => {
    const res = await createTask(app, token, { title: 'My first task' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');

    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(typeof task.id).toBe('number');
    expect(task.user_id).toBe(userId);
    expect(task.title).toBe('My first task');
    expect(task.description).toBeNull();
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.due_date).toBeNull();
    expect(typeof task.created_at).toBe('string');
    expect(typeof task.updated_at).toBe('string');
  });

  it('created task defaults to status=todo and priority=medium', async () => {
    const res = await createTask(app, token, { title: 'Defaults check' });

    expect(res.status).toBe(201);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
  });

  it('stores the correct user_id from the authenticated token', async () => {
    const res = await createTask(app, token, { title: 'Owner check' });

    expect(res.status).toBe(201);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.user_id).toBe(userId);
  });

  it('stores custom status and priority when provided', async () => {
    const res = await createTask(app, token, {
      title: 'Custom fields',
      status: 'in_progress',
      priority: 'urgent',
    });

    expect(res.status).toBe(201);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.status).toBe('in_progress');
    expect(task.priority).toBe('urgent');
  });

  it('stores description and due_date when provided', async () => {
    const res = await createTask(app, token, {
      title: 'Full task',
      description: 'Some detail',
      due_date: FUTURE_DATE,
    });

    expect(res.status).toBe(201);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.description).toBe('Some detail');
    expect(task.due_date).toBe(FUTURE_DATE);
  });

  it('trims leading/trailing whitespace from the title', async () => {
    const res = await createTask(app, token, { title: '  trimmed  ' });

    expect(res.status).toBe(201);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.title).toBe('trimmed');
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  it('returns 400 when title is missing', async () => {
    const res = await createTask(app, token, { description: 'no title here' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when title is an empty string', async () => {
    const res = await createTask(app, token, { title: '' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when title is whitespace-only', async () => {
    const res = await createTask(app, token, { title: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when status is an invalid enum value', async () => {
    const res = await createTask(app, token, {
      title: 'Bad status',
      status: 'pending',
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when priority is an invalid enum value', async () => {
    const res = await createTask(app, token, {
      title: 'Bad priority',
      priority: 'critical',
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ===========================================================================
// GET /tasks
// ===========================================================================

describe('GET /tasks', () => {
  let db: Database.Database;
  let app: Express;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = createTestDb();
    app = buildApp(db);
    tokenA = await createUserAndLogin(app, 'alice@example.com');
    tokenB = await createUserAndLogin(app, 'bob@example.com');
  });

  afterAll(() => {
    db?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path — basic shape
  // -------------------------------------------------------------------------

  it('returns 200 with { data: Task[], meta: { total, limit, offset } }', async () => {
    // Create one task so the list is non-empty.
    await createTask(app, tokenA, { title: 'Task 1' });

    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');

    const { meta } = res.body as {
      data: unknown[];
      meta: { total: number; limit: number; offset: number };
    };
    expect(typeof meta.total).toBe('number');
    expect(typeof meta.limit).toBe('number');
    expect(typeof meta.offset).toBe('number');
  });

  it('default pagination is limit=50 and offset=0 in meta', async () => {
    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { meta } = res.body as {
      meta: { total: number; limit: number; offset: number };
    };
    expect(meta.limit).toBe(50);
    expect(meta.offset).toBe(0);
  });

  it('returns an empty data array when the user has no tasks', async () => {
    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data, meta } = res.body as {
      data: unknown[];
      meta: { total: number };
    };
    expect(data).toEqual([]);
    expect(meta.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Data isolation — users only see their own tasks
  // -------------------------------------------------------------------------

  it('only returns tasks belonging to the authenticated user', async () => {
    await createTask(app, tokenA, { title: 'Alice task' });
    await createTask(app, tokenB, { title: 'Bob task' });

    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ title: string }> };
    expect(data.length).toBe(1);
    expect(data[0].title).toBe('Alice task');
  });

  it("does not leak another user's task count in meta.total", async () => {
    await createTask(app, tokenB, { title: 'Bob task 1' });
    await createTask(app, tokenB, { title: 'Bob task 2' });

    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { meta } = res.body as { meta: { total: number } };
    expect(meta.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  it('respects ?limit and ?offset query params', async () => {
    // Create 3 tasks for user A
    await createTask(app, tokenA, { title: 'Task A' });
    await createTask(app, tokenA, { title: 'Task B' });
    await createTask(app, tokenA, { title: 'Task C' });

    const res = await request(app)
      .get('/tasks?limit=2&offset=0')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data, meta } = res.body as {
      data: unknown[];
      meta: { total: number; limit: number; offset: number };
    };
    expect(data.length).toBe(2);
    expect(meta.limit).toBe(2);
    expect(meta.offset).toBe(0);
  });

  it('meta.total reflects full count, not just the current page', async () => {
    await createTask(app, tokenA, { title: 'Task 1' });
    await createTask(app, tokenA, { title: 'Task 2' });
    await createTask(app, tokenA, { title: 'Task 3' });

    const res = await request(app)
      .get('/tasks?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data, meta } = res.body as {
      data: unknown[];
      meta: { total: number; limit: number };
    };
    expect(data.length).toBe(1);
    expect(meta.total).toBe(3); // Full count, not the page size
  });

  it('offset=1 skips the first result — page 1 and page 2 return different tasks', async () => {
    await createTask(app, tokenA, { title: 'Task X' });
    await createTask(app, tokenA, { title: 'Task Y' });

    const page1 = await request(app)
      .get('/tasks?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenA}`);
    const page2 = await request(app)
      .get('/tasks?limit=1&offset=1')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const first = (page1.body as { data: Array<{ title: string }> }).data[0];
    const second = (page2.body as { data: Array<{ title: string }> }).data[0];

    // Page 2 must be a different task than page 1 (offset is working)
    expect(first.title).not.toBe(second.title);

    // Together they cover both tasks — ordering between tasks with the same
    // created_at timestamp is not guaranteed by SQLite, so we only assert the set.
    const titles = new Set([first.title, second.title]);
    expect(titles).toContain('Task X');
    expect(titles).toContain('Task Y');
  });

  // -------------------------------------------------------------------------
  // Status filter
  // -------------------------------------------------------------------------

  it('?status=todo filters to only todo tasks', async () => {
    await createTask(app, tokenA, { title: 'Todo task', status: 'todo' });
    await createTask(app, tokenA, { title: 'Done task', status: 'done' });

    const res = await request(app)
      .get('/tasks?status=todo')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ status: string }> };
    expect(data.every((t) => t.status === 'todo')).toBe(true);
    expect(data.length).toBe(1);
  });

  it('?status=done filters to only done tasks', async () => {
    await createTask(app, tokenA, { title: 'Done task', status: 'done' });
    await createTask(app, tokenA, { title: 'Todo task', status: 'todo' });

    const res = await request(app)
      .get('/tasks?status=done')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ status: string }> };
    expect(data.every((t) => t.status === 'done')).toBe(true);
    expect(data.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Priority filter
  // -------------------------------------------------------------------------

  it('?priority=urgent filters to only urgent tasks', async () => {
    await createTask(app, tokenA, { title: 'Urgent task', priority: 'urgent' });
    await createTask(app, tokenA, { title: 'Low task', priority: 'low' });

    const res = await request(app)
      .get('/tasks?priority=urgent')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ priority: string }> };
    expect(data.every((t) => t.priority === 'urgent')).toBe(true);
    expect(data.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // due_before / due_after filters
  // -------------------------------------------------------------------------

  it('?due_before=<date> filters out tasks with due_date >= that date', async () => {
    await createTask(app, tokenA, {
      title: 'Past due',
      due_date: '2020-06-01',
    });
    await createTask(app, tokenA, {
      title: 'Future due',
      due_date: FUTURE_DATE,
    });
    await createTask(app, tokenA, { title: 'No due date' });

    const res = await request(app)
      .get('/tasks?due_before=2021-01-01')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ title: string }> };
    expect(data.length).toBe(1);
    expect(data[0].title).toBe('Past due');
  });

  it('?due_after=<date> filters out tasks with due_date <= that date', async () => {
    await createTask(app, tokenA, {
      title: 'Past due',
      due_date: '2020-06-01',
    });
    await createTask(app, tokenA, {
      title: 'Future due',
      due_date: FUTURE_DATE,
    });

    const res = await request(app)
      .get('/tasks?due_after=2021-01-01')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ title: string }> };
    expect(data.length).toBe(1);
    expect(data[0].title).toBe('Future due');
  });

  // -------------------------------------------------------------------------
  // include_overdue filter
  // -------------------------------------------------------------------------

  it('?include_overdue=true returns tasks with due_date in the past and status != done', async () => {
    await createTask(app, tokenA, {
      title: 'Overdue task',
      due_date: PAST_DATE,
      status: 'todo',
    });
    await createTask(app, tokenA, {
      title: 'Done past task',
      due_date: PAST_DATE,
      status: 'done',
    });
    await createTask(app, tokenA, {
      title: 'Future task',
      due_date: FUTURE_DATE,
    });
    await createTask(app, tokenA, { title: 'No due date' });

    const res = await request(app)
      .get('/tasks?include_overdue=true')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ title: string }> };
    expect(data.length).toBe(1);
    expect(data[0].title).toBe('Overdue task');
  });

  it('?include_overdue=true combined with ?status=done returns both sets (UNION)', async () => {
    await createTask(app, tokenA, {
      title: 'Overdue todo',
      due_date: PAST_DATE,
      status: 'todo',
    });
    await createTask(app, tokenA, {
      title: 'Done task',
      due_date: FUTURE_DATE,
      status: 'done',
    });
    await createTask(app, tokenA, {
      title: 'Done overdue',
      due_date: PAST_DATE,
      status: 'done',
    });
    await createTask(app, tokenA, { title: 'Regular todo' });

    const res = await request(app)
      .get('/tasks?include_overdue=true&status=done')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Array<{ title: string }> };
    const titles = data.map((t) => t.title).sort();
    // Should include: the done tasks (from status=done filter) UNION the overdue
    // todo (from include_overdue). "Done overdue" matches both branches but
    // UNION deduplicates it.
    expect(titles).toContain('Overdue todo');
    expect(titles).toContain('Done task');
    expect(titles).toContain('Done overdue');
    expect(titles).not.toContain('Regular todo');
  });

  // -------------------------------------------------------------------------
  // Filter validation errors
  // -------------------------------------------------------------------------

  it('returns 400 for an invalid ?status param', async () => {
    const res = await request(app)
      .get('/tasks?status=pending')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an invalid ?priority param', async () => {
    const res = await request(app)
      .get('/tasks?priority=critical')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an invalid ?due_before format', async () => {
    const res = await request(app)
      .get('/tasks?due_before=not-a-date')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an invalid ?due_after format', async () => {
    const res = await request(app)
      .get('/tasks?due_after=31/12/2025')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ===========================================================================
// GET /tasks/:id
// ===========================================================================

describe('GET /tasks/:id', () => {
  let db: Database.Database;
  let app: Express;
  let tokenA: string;
  let tokenB: string;
  let taskId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = buildApp(db);
    tokenA = await createUserAndLogin(app, 'alice@example.com');
    tokenB = await createUserAndLogin(app, 'bob@example.com');

    // Create a task owned by user A
    const res = await createTask(app, tokenA, { title: 'Alice task' });
    taskId = (res.body as { data: { id: number } }).data.id;
  });

  afterAll(() => {
    db?.close();
  });

  it('returns 200 with { data: Task } for the owning user', async () => {
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');

    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.id).toBe(taskId);
    expect(task.title).toBe('Alice task');
    expect(typeof task.user_id).toBe('number');
    expect(typeof task.status).toBe('string');
    expect(typeof task.priority).toBe('string');
    expect(typeof task.created_at).toBe('string');
    expect(typeof task.updated_at).toBe('string');
  });

  it('returns 404 for a non-existent task id', async () => {
    const res = await request(app)
      .get('/tasks/99999')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a non-integer id string (e.g. "abc")', async () => {
    const res = await request(app)
      .get('/tasks/abc')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a float id (e.g. "1.5")', async () => {
    const res = await request(app)
      .get('/tasks/1.5')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 (not 403) when the task belongs to another user — IDOR fix', async () => {
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    // The IDOR fix uses WHERE id = ? AND user_id = ?, so the task is simply
    // "not found" for user B — must be 404, not 403.
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ===========================================================================
// PATCH /tasks/:id
// ===========================================================================

describe('PATCH /tasks/:id', () => {
  let db: Database.Database;
  let app: Express;
  let tokenA: string;
  let tokenB: string;
  let taskId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = buildApp(db);
    tokenA = await createUserAndLogin(app, 'alice@example.com');
    tokenB = await createUserAndLogin(app, 'bob@example.com');

    const res = await createTask(app, tokenA, {
      title: 'Original title',
      description: 'Original description',
      status: 'todo',
      priority: 'low',
      due_date: FUTURE_DATE,
    });
    taskId = (res.body as { data: { id: number } }).data.id;
  });

  afterAll(() => {
    db?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with { data: Task } when updating title only', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Updated title' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');

    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.title).toBe('Updated title');
  });

  it('returns 200 when updating status only', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.status).toBe('done');
  });

  it('returns 200 when updating multiple fields at once', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Multi update',
        status: 'in_progress',
        priority: 'high',
      });

    expect(res.status).toBe(200);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.title).toBe('Multi update');
    expect(task.status).toBe('in_progress');
    expect(task.priority).toBe('high');
  });

  it('un-provided fields are not modified', async () => {
    // Only update the title — everything else should remain unchanged
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Only title changed' });

    expect(res.status).toBe(200);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.description).toBe('Original description');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('low');
    expect(task.due_date).toBe(FUTURE_DATE);
  });

  it('updated_at is changed after a successful patch', async () => {
    // Fetch the task before patching to capture original updated_at
    const before = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    const originalUpdatedAt = (
      before.body as { data: { updated_at: string } }
    ).data.updated_at;

    // Wait 1100ms to ensure SQLite's now() returns a different second.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const after = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Trigger timestamp update' });

    expect(after.status).toBe(200);
    const newUpdatedAt = (after.body as { data: { updated_at: string } }).data
      .updated_at;
    expect(newUpdatedAt).not.toBe(originalUpdatedAt);
  });

  it('can clear description by sending { "description": null }', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ description: null });

    expect(res.status).toBe(200);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.description).toBeNull();
  });

  it('can clear due_date by sending { "due_date": null }', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ due_date: null });

    expect(res.status).toBe(200);
    const task = (res.body as { data: Record<string, unknown> }).data;
    expect(task.due_date).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  it('returns 400 when title is a whitespace-only string', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when body is empty {}', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No fields to update' });
  });

  it('returns 400 when status is an invalid enum value', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'pending' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when priority is an invalid enum value', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ priority: 'critical' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // Not found / ownership
  // -------------------------------------------------------------------------

  it('returns 404 for a non-existent task id', async () => {
    const res = await request(app)
      .patch('/tasks/99999')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Ghost update' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a non-integer id (e.g. "abc")', async () => {
    const res = await request(app)
      .patch('/tasks/abc')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Ghost update' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when the task belongs to another user — IDOR fix', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Stolen update' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('does not modify the task when a cross-user patch is attempted', async () => {
    // Attempt patch as user B
    await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Hijacked title' });

    // Verify the task is unchanged for user A
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const task = (res.body as { data: { title: string } }).data;
    expect(task.title).toBe('Original title');
  });
});

// ===========================================================================
// DELETE /tasks/:id
// ===========================================================================

describe('DELETE /tasks/:id', () => {
  let db: Database.Database;
  let app: Express;
  let tokenA: string;
  let tokenB: string;
  let taskId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = buildApp(db);
    tokenA = await createUserAndLogin(app, 'alice@example.com');
    tokenB = await createUserAndLogin(app, 'bob@example.com');

    const res = await createTask(app, tokenA, { title: 'Task to delete' });
    taskId = (res.body as { data: { id: number } }).data.id;
  });

  afterAll(() => {
    db?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with { data: { deleted: true } } on success', async () => {
    const res = await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { deleted: true } });
  });

  it('task is no longer returned by GET /tasks/:id after deletion', async () => {
    await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  it('task is no longer included in GET /tasks list after deletion', async () => {
    await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const { data, meta } = res.body as {
      data: Array<{ id: number }>;
      meta: { total: number };
    };
    expect(data.find((t) => t.id === taskId)).toBeUndefined();
    expect(meta.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Not found / ownership
  // -------------------------------------------------------------------------

  it('returns 404 for a non-existent task id', async () => {
    const res = await request(app)
      .delete('/tasks/99999')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a non-integer id (e.g. "abc")', async () => {
    const res = await request(app)
      .delete('/tasks/abc')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when the task belongs to another user — IDOR fix', async () => {
    const res = await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('does not delete the task when a cross-user delete is attempted', async () => {
    // Attempt delete as user B
    await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    // Task should still be accessible for user A
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: { id: number } }).data.id).toBe(taskId);
  });

  it('second delete on the same task returns 404', async () => {
    await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});
