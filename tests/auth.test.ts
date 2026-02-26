/**
 * Integration tests for POST /auth/register and POST /auth/login.
 *
 * Strategy:
 * - A fresh in-memory SQLite DB is created per describe block and wiped between
 *   tests via beforeEach so every test starts from a clean slate.
 * - A minimal Express app is built directly from the authRouter factory,
 *   bypassing src/app.ts (and its JWT_SECRET startup guard + rate limiters).
 * - supertest drives HTTP assertions without binding a real network port.
 * - JWT_SECRET is set once at the module level before any source import that
 *   could transitively read process.env.JWT_SECRET.
 */

// Must be set before any module that reads process.env.JWT_SECRET is imported.
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema.js';
import { authRouter } from '../src/routes/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET as string;

/** Build a fresh in-memory SQLite DB with the full schema applied. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

/** Build a minimal Express app wired to the given DB. No rate limiters. */
function buildApp(db: Database.Database): Express {
  const app = express();
  app.use(express.json({ limit: '2kb' }));
  app.use('/auth', authRouter(db));
  return app;
}

/** A valid 8-character password that satisfies all constraints. */
const VALID_PASSWORD = 'Password1';

/** A password whose UTF-8 byte length is exactly 73 (one over the 72-byte cap).
 *  Each ASCII char is 1 byte, so 73 ASCII chars = 73 bytes. */
const TOO_LONG_PASSWORD = 'a'.repeat(73);

/** A password whose UTF-8 byte length is exactly 72 — still valid (boundary). */
const MAX_VALID_PASSWORD = 'a'.repeat(72);

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  let db: Database.Database;
  let app: Express;

  beforeEach(() => {
    // Fresh DB + fresh app instance for every test — complete isolation.
    db = createTestDb();
    app = buildApp(db);
  });

  afterAll(() => {
    db?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 201 with { data: { id, email, created_at } } for valid credentials', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');

    const { data } = res.body as { data: Record<string, unknown> };
    expect(typeof data.id).toBe('number');
    expect(data.email).toBe('alice@example.com');
    expect(typeof data.created_at).toBe('string');
    expect(data.created_at).toBeTruthy();
  });

  it('does not include password_hash in the 201 response', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    const { data } = res.body as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('password_hash');
  });

  it('trims whitespace from email before storing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: '  bob@example.com  ', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect((res.body as { data: { email: string } }).data.email).toBe('bob@example.com');
  });

  it('accepts a password of exactly 72 bytes (boundary — still valid)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'boundary@example.com', password: MAX_VALID_PASSWORD });

    expect(res.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // Duplicate email
  // -------------------------------------------------------------------------

  it('returns 400 with the enumeration-safe error message for a duplicate email', async () => {
    const payload = { email: 'dup@example.com', password: VALID_PASSWORD };

    await request(app).post('/auth/register').send(payload);
    const res = await request(app).post('/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Registration could not be completed' });
  });

  it('returns 400 (not 409) for a duplicate email', async () => {
    const payload = { email: 'dup2@example.com', password: VALID_PASSWORD };
    await request(app).post('/auth/register').send(payload);
    const res = await request(app).post('/auth/register').send(payload);

    // Explicitly assert the status is 400, not 409, per the enumeration-safe design.
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(409);
  });

  // -------------------------------------------------------------------------
  // Missing / invalid email
  // -------------------------------------------------------------------------

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: '', password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an email with no local part (e.g. @example.com)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: '@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an email with no domain (e.g. alice@)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@', password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an email whose TLD is only 1 character (e.g. alice@example.c)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.c', password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an email with spaces (e.g. ali ce@example.com)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'ali ce@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when email is whitespace-only (trims to empty)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: '   ', password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // Missing / too-short / too-long password
  // -------------------------------------------------------------------------

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when password is an empty string', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: '' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when password is shorter than 8 characters (7 chars)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: 'Short1!' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when password exceeds 72 bytes (73 ASCII chars)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: TOO_LONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Password must not exceed 72 characters' });
  });

  it('returns 400 when password exceeds 72 bytes via multi-byte UTF-8 characters', async () => {
    // Each '€' is 3 bytes in UTF-8. 25 × 3 = 75 bytes > 72-byte cap.
    const multiBytePw = '€'.repeat(25);
    expect(Buffer.byteLength(multiBytePw, 'utf8')).toBe(75);

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: multiBytePw });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  let db: Database.Database;
  let app: Express;

  const REGISTERED_EMAIL = 'user@example.com';
  const REGISTERED_PASSWORD = 'CorrectPassword1';

  beforeEach(async () => {
    // Fresh DB + app, then seed one registered user for login tests.
    db = createTestDb();
    app = buildApp(db);

    await request(app)
      .post('/auth/register')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });
  });

  afterAll(() => {
    db?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with { data: { token, user: { id, email } } } for correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');

    const { data } = res.body as {
      data: { token: string; user: { id: number; email: string } };
    };
    expect(typeof data.token).toBe('string');
    expect(data.token.length).toBeGreaterThan(0);
    expect(typeof data.user.id).toBe('number');
    expect(data.user.email).toBe(REGISTERED_EMAIL);
  });

  it('does not include password_hash in the login response', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('password_hash');
    expect(data.user).not.toHaveProperty('password_hash');
  });

  // -------------------------------------------------------------------------
  // JWT token structure and claims
  // -------------------------------------------------------------------------

  it('token is a valid HS256 JWT signed with JWT_SECRET', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });

    expect(res.status).toBe(200);
    const { token } = (res.body as { data: { token: string } }).data;

    // Decode header without verification to check algorithm
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
      alg: string;
      typ: string;
    };
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('token carries correct issuer and audience claims', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });

    expect(res.status).toBe(200);
    const { token } = (res.body as { data: { token: string } }).data;

    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'task-manager-api',
      audience: 'task-manager-api',
    }) as jwt.JwtPayload;

    expect(payload.iss).toBe('task-manager-api');
    expect(payload.aud).toBe('task-manager-api');
  });

  it('token payload contains userId and email matching the registered user', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });

    expect(res.status).toBe(200);
    const { token, user } = (res.body as { data: { token: string; user: { id: number; email: string } } }).data;

    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'task-manager-api',
      audience: 'task-manager-api',
    }) as jwt.JwtPayload & { userId: number; email: string };

    expect(payload.userId).toBe(user.id);
    expect(payload.email).toBe(REGISTERED_EMAIL);
  });

  it('token has an expiry (exp claim) set', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: REGISTERED_PASSWORD });

    expect(res.status).toBe(200);
    const { token } = (res.body as { data: { token: string } }).data;

    const payload = jwt.decode(token) as jwt.JwtPayload;
    expect(typeof payload.exp).toBe('number');
    // Expiry should be roughly 24 h from now (allow ±60 s clock skew in tests)
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(payload.exp as number).toBeGreaterThan(nowSeconds + 23 * 3600);
    expect(payload.exp as number).toBeLessThan(nowSeconds + 25 * 3600);
  });

  it('trims whitespace from email before checking credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: `  ${REGISTERED_EMAIL}  `, password: REGISTERED_PASSWORD });

    // The router trims rawEmail, so this should still authenticate successfully.
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Wrong password
  // -------------------------------------------------------------------------

  it('returns 401 with { error: "Invalid credentials" } for a wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: 'WrongPassword99' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  // -------------------------------------------------------------------------
  // Email not registered
  // -------------------------------------------------------------------------

  it('returns 401 with { error: "Invalid credentials" } when email is not registered', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: REGISTERED_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  it('returns the same 401 message for wrong password and unknown email (timing-safe parity)', async () => {
    const wrongPw = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: 'WrongPassword99' });

    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'WrongPassword99' });

    // Both must return identical status + body — no enumeration leakage.
    expect(wrongPw.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPw.body).toEqual(unknownEmail.body);
  });

  // -------------------------------------------------------------------------
  // Missing fields
  // -------------------------------------------------------------------------

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: REGISTERED_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and password are required' });
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and password are required' });
  });

  it('returns 400 when both email and password are missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and password are required' });
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: '', password: REGISTERED_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and password are required' });
  });

  it('returns 400 when email is whitespace-only (trims to empty string)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: '   ', password: REGISTERED_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and password are required' });
  });

  it('returns 400 when password is an empty string', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: '' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email and password are required' });
  });

  // -------------------------------------------------------------------------
  // Password over 72 bytes
  // -------------------------------------------------------------------------

  it('returns 400 when password exceeds 72 bytes (73 ASCII chars)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: TOO_LONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Password must not exceed 72 characters' });
  });

  it('returns 400 when password exceeds 72 bytes via multi-byte UTF-8 characters', async () => {
    // 25 × '€' (3 bytes each) = 75 bytes > 72-byte cap
    const multiBytePw = '€'.repeat(25);
    expect(Buffer.byteLength(multiBytePw, 'utf8')).toBe(75);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: REGISTERED_EMAIL, password: multiBytePw });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
