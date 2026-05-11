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

# Create non-root user after installation
RUN addgroup -g 1001 nodejs && adduser -D -u 1001 -H -s /sbin/nologin -G nodejs -g nodejs nodejs

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

EXPOSE 3000

CMD ["pnpm", "--filter", "frontend", "dev"]