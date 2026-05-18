FROM node:20-alpine

# Install pnpm
RUN npm install -g pnpm@10.33.0

# Create app directory and set permissions
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/types/package.json ./packages/types/

# Install dependencies as root first
RUN pnpm install --frozen-lockfile

# Copy source and build frontend for production
COPY tsconfig.base.json ./
COPY packages/frontend/tsconfig.json ./packages/frontend/
COPY packages/frontend/next.config.ts ./packages/frontend/
COPY packages/frontend/postcss.config.js ./packages/frontend/
COPY packages/frontend/tailwind.config.ts ./packages/frontend/
COPY packages/frontend/next-env.d.ts ./packages/frontend/
COPY packages/frontend/src ./packages/frontend/src
COPY packages/frontend/public ./packages/frontend/public
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src ./packages/types/src

RUN pnpm --filter frontend build

# Create non-root user after installation
RUN addgroup -g 1001 nodejs && adduser -D -u 1001 -H -s /sbin/nologin -G nodejs -g nodejs nodejs

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["pnpm", "--filter", "frontend", "start", "--", "-H", "0.0.0.0", "-p", "3000"]