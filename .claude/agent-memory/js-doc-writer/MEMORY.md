# Task Manager API - JSDoc Documentation Memory

## Project Overview
- **Codebase**: TypeScript/Node.js with Express, better-sqlite3, bcryptjs, JWT
- **Structure**: src/ with subdirectories for db/, routes/, middleware/, types/
- **Status**: This is the first JSDoc documentation pass (Feb 26, 2026)

## JSDoc Conventions & Patterns

### Existing Code Style
- No JSDoc comments were present in the original codebase
- Code uses inline comments for complex logic (e.g., timing-safe password checks, UNIQUE constraint handling)
- TypeScript interfaces and types defined in src/types/index.ts
- Functions use TypeScript type annotations rather than JSDoc @param types

### Applied Documentation Standards
- **Export Documentation**: All exported members require JSDoc blocks
- **Type Annotation**: Use `@type {Type}` for exported variables/constants
- **Singleton Pattern**: Document when a module export is a singleton with side effects on import
- **Side Effects**: Explicitly document initialization, schema creation, and error handling that exits process
- **Environment Variables**: Include which env vars control behavior and their defaults
- **Configuration Details**: Document pragma settings, constraints, and their purposes

### Module-Level Exports Documentation
For database connections and similar module-level exports:
1. Start with one-sentence summary
2. Explain configuration (WAL, constraints, etc.) and rationale
3. List side effects (schema init, process exit on failure)
4. Document env var control and defaults
5. Use @type JSDoc tag

### Files Documented
- `/home/mynorxico/task-manager-api/src/db/migrations.ts` - db singleton with initialization side effects

## Next Steps
- Document exported functions in routes/ (authRouter, tasksRouter)
- Document exported functions in routes/tasks.ts
- Document types and interfaces in src/types/index.ts
- Consider adding @param/@returns to authRouter and tasksRouter functions
