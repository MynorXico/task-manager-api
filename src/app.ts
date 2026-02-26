import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from './db/migrations.js';
import { authRouter } from './routes/auth.js';
import { tasksRouter } from './routes/tasks.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error(
    'FATAL: JWT_SECRET must be set and at least 32 characters. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  process.exit(1);
}

const app = express();

// Tight body limits — auth endpoints need only a few hundred bytes
app.use('/auth',  express.json({ limit: '2kb' }));
app.use('/tasks', express.json({ limit: '16kb' }));

// Rate limiting — stricter on login to slow brute-force attempts
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

app.use('/auth/register', registerLimiter);
app.use('/auth/login', loginLimiter);

app.use('/auth', authRouter(db));
app.use('/tasks', tasksRouter(db));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export { app, db };
