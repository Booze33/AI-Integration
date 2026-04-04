# ============================================================================
# Security-Hardened Multi-Stage Build (Frontend)
# ============================================================================

# Stage 1: Dependencies
FROM node:20-alpine AS dependencies

# Security: Update packages
RUN apk update && apk upgrade && \
    apk add --no-cache bash curl ca-certificates && \
    rm -rf /var/cache/apk/*

# Security: Use non-root user
RUN addgroup -g 1000 nodejs && adduser -D -u 1000 -H -s /sbin/nologin -G nodejs -g nodejs nodejs

WORKDIR /tmp/deps

# Install pnpm (pinned version)
RUN npm install -g pnpm@10.33.0

# Copy dependency files only
COPY --chown=nodejs:nodejs package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=nodejs:nodejs packages/frontend/package.json ./packages/frontend/

# Install dependencies (frozen for reproducibility)
RUN pnpm install --frozen-lockfile


# Stage 2: Builder
FROM dependencies AS builder

WORKDIR /tmp/build

# Copy all source files
COPY --chown=nodejs:nodejs . .

# Install all dependencies (including devDependencies)
RUN pnpm install --frozen-lockfile

# Build the application
RUN pnpm --filter frontend build


# Stage 3: Production Runtime
FROM node:20-alpine AS production

# Security: Update packages and remove unnecessary tools
RUN apk update && apk upgrade && \
    apk add --no-cache curl ca-certificates dumb-init && \
    apk del apk-tools && \
    rm -rf /var/cache/apk/* /usr/lib/apk/* /etc/apk/*

# Security: Create non-root user
RUN addgroup -g 1000 nodejs && adduser -D -u 1000 -H -s /sbin/nologin -G nodejs -g nodejs nodejs

WORKDIR /app

# Security: Set environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--no-warnings --use-strict" \
    NEXT_TELEMETRY_DISABLED=1

# Copy package.json files
COPY --chown=nodejs:nodejs --from=builder /tmp/build/package.json .
COPY --chown=nodejs:nodejs --from=builder /tmp/build/pnpm-lock.yaml .
COPY --chown=nodejs:nodejs --from=builder /tmp/build/pnpm-workspace.yaml .
COPY --chown=nodejs:nodejs --from=builder /tmp/build/packages/frontend/package.json ./packages/frontend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built application from builder
COPY --chown=nodejs:nodejs --from=builder /tmp/build/packages/frontend/.next ./packages/frontend/.next
COPY --chown=nodejs:nodejs --from=builder /tmp/build/packages/frontend/public ./packages/frontend/public
COPY --chown=nodejs:nodejs --from=builder /tmp/build/packages/frontend/next.config.ts ./packages/frontend/

# Remove unnecessary files
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/npx \
           /root/.npm \
           /tmp/* \
           /var/tmp/*

# Security: Set read-only filesystem where possible
RUN chmod -R 555 /usr/local/lib/node_modules && \
    chmod -R 555 /app/packages/frontend/.next && \
    chmod -R 555 /app/packages/frontend/public && \
    chmod -R 755 /app/node_modules

# Switch to non-root user
USER nodejs

# Security: Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/sbin/dumb-init", "--"]

# Expose only required port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# Security: Run with fixed command
CMD ["pnpm", "--filter", "frontend", "start"]