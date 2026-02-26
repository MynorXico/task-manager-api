import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { User, DbUser } from '../types/index.js';

// Requires at least one non-whitespace/@ char on each side of @, and a TLD of 2+ chars
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Constant-time dummy for timing-safe login when email is not found.
// Computed once at startup so it doesn't add per-request latency.
const DUMMY_HASH = bcrypt.hashSync('dummy-constant-password-for-timing-safety', 10);

const MAX_PASSWORD_BYTES = 72;

export function authRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/register', (req: Request, res: Response) => {
    const { email: rawEmail, password } = req.body as {
      email?: string;
      password?: string;
    };

    const email = rawEmail?.trim();

    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'A valid email address is required' });
      return;
    }

    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      res.status(400).json({ error: 'Password must not exceed 72 characters' });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);

    try {
      const result = db
        .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
        .run(email, hash);

      // Fetch back to include the DB-generated created_at timestamp
      const user = db
        .prepare('SELECT id, email, created_at FROM users WHERE id = ?')
        .get(result.lastInsertRowid) as Pick<User, 'id' | 'email' | 'created_at'>;

      res.status(201).json({ data: user });
    } catch (err) {
      const isDuplicate =
        err instanceof Error && err.message.includes('UNIQUE constraint failed');
      // Return the same status and message for duplicate and server errors to
      // avoid confirming whether an email is registered (enumeration prevention).
      res
        .status(isDuplicate ? 400 : 500)
        .json({ error: isDuplicate ? 'Registration could not be completed' : 'Registration failed' });
    }
  });

  router.post('/login', (req: Request, res: Response) => {
    const { email: rawEmail, password } = req.body as {
      email?: string;
      password?: string;
    };

    const email = rawEmail?.trim();

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      res.status(400).json({ error: 'Password must not exceed 72 characters' });
      return;
    }

    const user = db
      .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
      .get(email) as DbUser | undefined;

    // Always run bcrypt even when no user is found so that response time is
    // identical for "email not found" and "wrong password" (timing-safe).
    const hashToCheck = user ? user.password_hash : DUMMY_HASH;
    const valid = bcrypt.compareSync(password, hashToCheck) && user !== undefined;

    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfiguration' });
      return;
    }

    const token = jwt.sign({ userId: user!.id, email: user!.email }, secret, {
      expiresIn: '24h',
      algorithm: 'HS256',
      issuer: 'task-manager-api',
      audience: 'task-manager-api',
    });

    res.json({ data: { token, user: { id: user!.id, email: user!.email } } });
  });

  return router;
}
