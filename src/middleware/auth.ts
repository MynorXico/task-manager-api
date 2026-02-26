import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/index.js';

export interface AuthRequest extends Request {
  readonly user?: AuthPayload;
}

function isAuthPayload(value: unknown): value is AuthPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.userId) &&
    (v.userId as number) > 0 &&
    typeof v.email === 'string' &&
    v.email.length > 0 &&
    typeof v.exp === 'number'
  );
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      maxAge: '25h',
      issuer: 'task-manager-api',
      audience: 'task-manager-api',
    });

    if (!isAuthPayload(payload)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    (req as { user: AuthPayload }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
