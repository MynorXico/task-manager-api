# Task Manager API

## Project Overview
A REST API for managing tasks with JWT authentication, built with Express, TypeScript, and SQLite (better-sqlite3).

## Tech Stack
- **Runtime**: Node.js with TypeScript
- **Framework**: Express 5
- **Database**: SQLite via better-sqlite3
- **Auth**: JWT (jsonwebtoken) + bcryptjs for password hashing
- **Testing**: Vitest

## Project Structure
```
src/
  app.ts          - Express app setup, DB init, route mounting
  db/
    schema.ts     - Table creation (CREATE TABLE IF NOT EXISTS)
    migrations.ts - Versioned migration runner
  middleware/
    auth.ts       - JWT Bearer token verification middleware
  routes/
    auth.ts       - POST /auth/register, POST /auth/login
    tasks.ts      - CRUD for /tasks (authenticated)
  types/
    index.ts      - Shared TypeScript interfaces (User, Task, JwtPayload)
tests/            - Vitest test files
.claude/agents/   - Custom sub-agent definitions
```

## Development Commands
```bash
npx ts-node src/app.ts     # Run dev server
npx tsc                    # Compile TypeScript
npx vitest                 # Run tests
```

## Environment Variables
See `.env.example`. Required:
- `JWT_SECRET` - Secret for signing JWTs
- `PORT` - Server port (default: 3000)
- `DB_PATH` - SQLite file path (default: ./data/tasks.db)

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | No | Create account |
| POST | /auth/login | No | Get JWT token |
| GET | /tasks | Yes | List user's tasks |
| POST | /tasks | Yes | Create task |
| PATCH | /tasks/:id | Yes | Update task |
| DELETE | /tasks/:id | Yes | Delete task |

## Key Conventions
- All DB calls use better-sqlite3 synchronous API (no async/await for DB)
- Tasks are scoped to the authenticated user via `user_id`
- Passwords are hashed with bcrypt (cost factor 10)
- JWT tokens expire in 24h
