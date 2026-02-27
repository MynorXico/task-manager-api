# ─── Stage 1: Install all deps and compile TypeScript ──────────────────────
FROM node:22-alpine AS builder

# Build tools required by better-sqlite3's native module compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: Production dependencies only ──────────────────────────────────
FROM node:22-alpine AS prod-deps

# Same build tools needed to compile better-sqlite3 against musl
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 3: Runtime image ──────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist         ./dist
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run as non-root for least privilege
USER node

CMD ["node", "dist/app.js"]
