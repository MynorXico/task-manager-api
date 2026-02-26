import { Router, Response } from 'express';
import Database from 'better-sqlite3';
import { Task } from '../types/index.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export function tasksRouter(db: Database.Database): Router {
  const router = Router();

  router.use(authenticate);

  router.get('/', (req: AuthRequest, res: Response) => {
    const tasks = db
      .prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user!.userId) as Task[];
    res.json(tasks);
  });

  router.post('/', (req: AuthRequest, res: Response) => {
    const { title, description, priority, due_date } = req.body as {
      title?: string;
      description?: string;
      priority?: Task['priority'];
      due_date?: string;
    };

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const result = db
      .prepare(
        'INSERT INTO tasks (user_id, title, description, priority, due_date) VALUES (?, ?, ?, ?, ?)'
      )
      .run(req.user!.userId, title, description ?? null, priority ?? 'medium', due_date ?? null);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid) as Task;
    res.status(201).json(task);
  });

  router.patch('/:id', (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { title, description, status, priority, due_date } = req.body as Partial<
      Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date'>
    >;

    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
      .get(id, req.user!.userId) as Task | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    db.prepare(
      `UPDATE tasks SET
        title       = COALESCE(?, title),
        description = COALESCE(?, description),
        status      = COALESCE(?, status),
        priority    = COALESCE(?, priority),
        due_date    = COALESCE(?, due_date),
        updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ? AND user_id = ?`
    ).run(
      title ?? null,
      description ?? null,
      status ?? null,
      priority ?? null,
      due_date ?? null,
      id,
      req.user!.userId
    );

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task;
    res.json(task);
  });

  router.delete('/:id', (req: AuthRequest, res: Response) => {
    const { changes } = db
      .prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user!.userId);

    if (changes === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.status(204).send();
  });

  return router;
}
