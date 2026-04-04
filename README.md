# AI Integration Platform

A comprehensive, multi-tenant AI integration platform with secure API key management, real-time chat, voice input, and file processing capabilities.

## Features

### 🔐 **Security & Authentication**

- JWT-based authentication with RS256 signing
- Refresh token rotation
- Multi-tenant architecture with Row Level Security
- AES-256 encrypted API key storage
- Role-based access control (admin, owner, member, viewer)

### 🤖 **AI Provider Integration**

- Support for 10+ AI providers (OpenAI, Anthropic, Deepgram, ElevenLabs, etc.)
- Encrypted API key management
- Provider-specific configuration
- Automatic failover and load balancing

### 💬 **Real-time Chat**

- Streaming AI responses
- Voice input with speech-to-text
- Chat history persistence
- Session management with Redis

### 📁 **File Processing Pipeline**

- Multi-format file upload (PDF, DOCX, images, audio)
- Asynchronous processing with job tracking
- Text extraction and analysis
- Progress monitoring

### 🚀 **Developer Experience**

- TypeScript throughout
- Comprehensive API client with auto-refresh
- Unit and integration tests
- Full API documentation
- Docker support

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Docker (optional)

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd ai-integration-platform
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Generate RSA keys for JWT**

   ```bash
   cd packages/backend
   pnpm run generate-keys
   ```

5. **Start services**

   ```bash
   # Start PostgreSQL and Redis (via Docker)
   docker-compose up -d postgres redis

   # Run migrations
   cd packages/backend
   pnpm run migrate

   # Seed database (optional)
   pnpm run seed

   # Start backend
   pnpm run dev

   # Start frontend (new terminal)
   cd ../frontend
   pnpm run dev
   ```

6. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Health check: http://localhost:3001/health

## Project Structure

```
├── packages/
│   ├── backend/              # Express.js API server
│   │   ├── src/
│   │   │   ├── auth/         # Authentication & JWT
│   │   │   ├── chat/         # Chat endpoints
│   │   │   ├── database/     # Migrations & DB utilities
│   │   │   ├── errors/       # Error handling
│   │   │   ├── logger/       # Request logging
│   │   │   ├── pipeline/     # File processing
│   │   │   ├── providers/    # AI provider management
│   │   │   ├── rate-limit/   # Rate limiting
│   │   │   ├── redis/        # Redis utilities
│   │   │   └── index.ts      # Server entry point
│   │   └── package.json
│   └── frontend/             # Next.js application
│       ├── src/
│       │   ├── app/          # App router pages
│       │   ├── components/   # React components
│       │   ├── lib/          # Utilities & API client
│       │   └── types/        # TypeScript types
│       └── package.json
├── docs/                     # Documentation
├── docker-compose.yml        # Development services
└── pnpm-workspace.yaml       # Workspace configuration
```

## Configuration

### Environment Variables

#### Backend (.env)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_integration

# Redis
REDIS_URL=redis://localhost:6379

# JWT Keys (generate with pnpm run generate-keys)
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."

# Encryption
TENANT_CONFIG_ENCRYPTION_KEY=your-32-char-encryption-key

# Server
PORT=3001
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_USER_MAX=100
RATE_LIMIT_TENANT_MAX=1000
RATE_LIMIT_IP_MAX=50
RATE_LIMIT_WINDOW_MS=900000
```

#### Frontend (.env.local)

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

## API Usage

### Authentication

```typescript
import { apiClient } from '@/lib/api-client';

// Login
const response = await apiClient.login({
  email: 'admin@example.com',
  password: 'password',
});

// API client automatically handles token refresh
```

### AI Provider Management

```typescript
// List configurations
const configs = await apiClient.getTenantConfigs();

// Add OpenAI configuration
const config = await apiClient.createTenantConfig({
  provider: 'openai',
  api_key: 'sk-your-openai-key',
  default_model: 'gpt-4',
});
```

### File Processing

```typescript
// Upload file
const uploadResponse = await apiClient.uploadFile(file);

// Check processing status
const status = await apiClient.getJobStatus(uploadResponse.jobId);
```

## Development

### Running Tests

```bash
# Backend tests
cd packages/backend
pnpm test

# Frontend tests
cd packages/frontend
pnpm test

# All tests
pnpm test
```

### Database Operations

```bash
cd packages/backend

# Create migration
pnpm run migrate:create -- --name add_new_table

# Run migrations
pnpm run migrate

# Rollback
pnpm run migrate:down

# Check status
pnpm run migrate:status
```

### Code Quality

```bash
# Lint
pnpm lint

# Type check
pnpm type-check

# Build
pnpm build
```

## Deployment

### Vercel (Frontend)

The frontend can be deployed to Vercel with mock mode support:

1. **Connect Repository**: Import your Git repository to Vercel
2. **Configure Build Settings**:
   - Framework: Next.js
   - Root Directory: `packages/frontend`
   - Build Command: `pnpm build`
3. **Set Environment Variables**:
   - `NEXT_PUBLIC_BACKEND_URL`: Your backend API URL
   - `NEXT_PUBLIC_MOCK_MODE`: `false` (or `true` for testing)
4. **Deploy**: Vercel will automatically build and deploy

See [Vercel Deployment Guide](./docs/Vercel-Deployment.md) for detailed instructions.

### Docker

```bash
# Build and run
docker-compose up --build

# Production build
docker-compose -f docker-compose.prod.yml up --build
```

### Environment Setup

1. **Database**: Set up PostgreSQL with proper permissions
2. **Redis**: Configure Redis for session storage
3. **SSL**: Configure SSL certificates for production
4. **Environment Variables**: Set production values
5. **Migrations**: Run database migrations

## Security Considerations

- API keys are encrypted at rest using AES-256
- JWT tokens use RS256 asymmetric signing
- Rate limiting prevents abuse
- Row Level Security ensures tenant isolation
- Input validation on all endpoints
- CORS configured for allowed origins

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [API Documentation](./docs/API.md)
- 👥 [User Guide](./docs/User-Guide.md)
- � [Vercel Deployment Guide](./docs/Vercel-Deployment.md)
- �🐛 [Issue Tracker](https://github.com/your-org/ai-integration-platform/issues)
- 💬 [Discussions](https://github.com/your-org/ai-integration-platform/discussions)
