/**
 * Database Seed Script
 *
 * Populates the database with realistic demo data for development and testing.
 * Run with: pnpm seed
 */

import { Pool } from 'pg';
import { TenantDatabase } from '../tenant-context';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/myapp';

// Demo Tenants
const DEMO_TENANTS = [
  {
    id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    name: 'TechCorp Solutions',
    slug: 'techcorp',
    status: 'active',
    plan: 'professional',
    settings: { theme: 'dark', timezone: 'America/New_York' },
  },
  {
    id: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    name: 'StartupXYZ',
    slug: 'startupxyz',
    status: 'active',
    plan: 'starter',
    settings: { theme: 'light', timezone: 'Europe/London' },
  },
];

// Demo Users
const DEMO_USERS = [
  {
    id: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    email: 'alice.chen@techcorp.com',
    firstName: 'Alice',
    lastName: 'Chen',
    role: 'owner',
  },
  {
    id: 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    email: 'bob.martinez@techcorp.com',
    firstName: 'Bob',
    lastName: 'Martinez',
    role: 'admin',
  },
  {
    id: 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    email: 'carol.johnson@techcorp.com',
    firstName: 'Carol',
    lastName: 'Johnson',
    role: 'member',
  },
  {
    id: 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    email: 'david.kim@techcorp.com',
    firstName: 'David',
    lastName: 'Kim',
    role: 'member',
  },
  {
    id: 'b8c9d0e1-f2a3-4b4c-5d6e-7f8a9b0c1d2e',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    email: 'emma.wilson@techcorp.com',
    firstName: 'Emma',
    lastName: 'Wilson',
    role: 'member',
  },
  {
    id: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    email: 'frank.li@startupxyz.io',
    firstName: 'Frank',
    lastName: 'Li',
    role: 'owner',
  },
  {
    id: 'd0e1f2a3-b4c5-4d6e-7f8a-9b0c1d2e3f4a',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    email: 'grace.taylor@startupxyz.io',
    firstName: 'Grace',
    lastName: 'Taylor',
    role: 'admin',
  },
  {
    id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    email: 'henry.brown@startupxyz.io',
    firstName: 'Henry',
    lastName: 'Brown',
    role: 'member',
  },
];

// Demo Projects
const DEMO_PROJECTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    name: 'AI Customer Support Bot',
    slug: 'ai-support-bot',
    description: 'Intelligent chatbot using GPT-4 for customer inquiries',
    createdBy: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    name: 'ML Pipeline Infrastructure',
    slug: 'ml-pipeline',
    description: 'Scalable ML training and deployment infrastructure',
    createdBy: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    name: 'Analytics Dashboard',
    slug: 'analytics-dashboard',
    description: 'Real-time analytics with AI insights',
    createdBy: 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    name: 'Product Recommendation Engine',
    slug: 'recommendation-engine',
    description: 'AI-powered product recommendations',
    createdBy: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    name: 'Sentiment Analysis API',
    slug: 'sentiment-api',
    description: 'REST API for customer sentiment analysis',
    createdBy: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
  },
];

// Demo Tasks
const DEMO_TASKS = [
  {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    projectId: '11111111-1111-4111-8111-111111111111',
    title: 'Integrate OpenAI GPT-4 API',
    status: 'done',
    priority: 'high',
    assigneeId: 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c',
    reporterId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    tags: ['ai', 'api'],
  },
  {
    id: 'aaaa2222-2222-4222-8222-222222222222',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    projectId: '11111111-1111-4111-8111-111111111111',
    title: 'Design conversation flow',
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
    reporterId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    tags: ['design'],
    dueDate: new Date('2025-04-10'),
  },
  {
    id: 'aaaa3333-3333-4333-8333-333333333333',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    projectId: '11111111-1111-4111-8111-111111111111',
    title: 'Implement context memory',
    status: 'todo',
    priority: 'medium',
    assigneeId: 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d',
    reporterId: 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
    tags: ['ai', 'backend'],
  },
  {
    id: 'aaaa4444-4444-4444-8444-444444444444',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    projectId: '11111111-1111-4111-8111-111111111111',
    title: 'Build human handoff logic',
    status: 'todo',
    priority: 'urgent',
    assigneeId: null,
    reporterId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    tags: ['critical'],
  },
  {
    id: 'bbbb1111-1111-4111-8111-111111111111',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    projectId: '22222222-2222-4222-8222-222222222222',
    title: 'Set up Kubernetes cluster',
    status: 'done',
    priority: 'high',
    assigneeId: 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d',
    reporterId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    tags: ['infrastructure'],
  },
  {
    id: 'bbbb2222-2222-4222-8222-222222222222',
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    projectId: '22222222-2222-4222-8222-222222222222',
    title: 'Implement model versioning',
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'b8c9d0e1-f2a3-4b4c-5d6e-7f8a9b0c1d2e',
    reporterId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    tags: ['mlops'],
  },
  {
    id: 'cccc1111-1111-4111-8111-111111111111',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    projectId: '44444444-4444-4444-8444-444444444444',
    title: 'Build user-item matrix',
    status: 'done',
    priority: 'high',
    assigneeId: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
    reporterId: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
    tags: ['data'],
  },
  {
    id: 'cccc2222-2222-4222-8222-222222222222',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    projectId: '44444444-4444-4444-8444-444444444444',
    title: 'Train collaborative filtering model',
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'd0e1f2a3-b4c5-4d6e-7f8a-9b0c1d2e3f4a',
    reporterId: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
    tags: ['ml'],
  },
  {
    id: 'dddd1111-1111-4111-8111-111111111111',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    projectId: '55555555-5555-4555-8555-555555555555',
    title: 'Fine-tune BERT model',
    status: 'done',
    priority: 'high',
    assigneeId: 'd0e1f2a3-b4c5-4d6e-7f8a-9b0c1d2e3f4a',
    reporterId: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
    tags: ['ml', 'nlp'],
  },
  {
    id: 'dddd2222-2222-4222-8222-222222222222',
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    projectId: '55555555-5555-4555-8555-555555555555',
    title: 'Deploy to production',
    status: 'in_progress',
    priority: 'urgent',
    assigneeId: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
    reporterId: 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f',
    tags: ['deployment'],
  },
];

// Demo Tags
const DEMO_TAGS = [
  { tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', name: 'ai', color: '#8b5cf6' },
  { tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', name: 'api', color: '#3b82f6' },
  { tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', name: 'critical', color: '#ef4444' },
  { tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', name: 'infrastructure', color: '#f59e0b' },
  { tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', name: 'ml', color: '#8b5cf6' },
  { tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', name: 'nlp', color: '#3b82f6' },
  { tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', name: 'deployment', color: '#f59e0b' },
];

// Demo Comments
const DEMO_COMMENTS = [
  {
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    entityType: 'task',
    entityId: 'aaaa1111-1111-4111-8111-111111111111',
    content: 'Successfully integrated with OpenAI. Using gpt-4-turbo for better response times.',
    authorId: 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c',
  },
  {
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    entityType: 'task',
    entityId: 'aaaa1111-1111-4111-8111-111111111111',
    content: 'Great work! Can you share the API key rotation strategy?',
    authorId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
  },
  {
    tenantId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    entityType: 'task',
    entityId: 'aaaa4444-4444-4444-8444-444444444444',
    content: 'This is blocking our beta launch. Need to prioritize this week.',
    authorId: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
  },
  {
    tenantId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
    entityType: 'task',
    entityId: 'cccc1111-1111-4111-8111-111111111111',
    content: 'Matrix is sparse - 99.7% zeros. Using CSR format for memory efficiency.',
    authorId: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
  },
];

async function seed() {
  console.log('🌱 Starting database seed...\n');

  const pool = new Pool({ connectionString: DATABASE_URL });
  const tenantDb = TenantDatabase.fromPool(pool);

  try {
    // Clear existing data
    console.log('🧹 Clearing existing data...');
    const rawClient = await tenantDb.getRawConnection();
    try {
      await rawClient.query('SET session_replication_role = replica');
      await rawClient.query('TRUNCATE TABLE app.activity_log CASCADE');
      await rawClient.query('TRUNCATE TABLE app.comments CASCADE');
      await rawClient.query('TRUNCATE TABLE app.tasks CASCADE');
      await rawClient.query('TRUNCATE TABLE app.project_members CASCADE');
      await rawClient.query('TRUNCATE TABLE app.projects CASCADE');
      await rawClient.query('TRUNCATE TABLE app.tags CASCADE');
      await rawClient.query('TRUNCATE TABLE auth.users CASCADE');
      await rawClient.query('TRUNCATE TABLE tenant.tenant_members CASCADE');
      await rawClient.query('TRUNCATE TABLE tenant.tenants CASCADE');
      await rawClient.query('SET session_replication_role = DEFAULT');
    } finally {
      rawClient.release();
    }
    console.log('  ✅ Cleared existing data\n');

    // Seed Tenants
    console.log('🏢 Creating tenants...');
    for (const tenant of DEMO_TENANTS) {
      const client = await tenantDb.getRawConnection();
      try {
        await client.query(
          `INSERT INTO tenant.tenants (id, tenant_id, name, slug, status, plan, settings) VALUES ($1, $1, $2, $3, $4, $5, $6)`,
          [
            tenant.id,
            tenant.name,
            tenant.slug,
            tenant.status,
            tenant.plan,
            JSON.stringify(tenant.settings),
          ]
        );
        console.log(`  ✅ ${tenant.name}`);
      } finally {
        client.release();
      }
    }

    // Seed Users
    console.log('\n👥 Creating users...');
    for (const user of DEMO_USERS) {
      const client = await tenantDb.getRawConnection();
      try {
        await client.query(
          `INSERT INTO auth.users (id, tenant_id, email, first_name, last_name, password_hash, email_verified, status) VALUES ($1, $2, $3, $4, $5, '$2b$10$demo', true, 'active')`,
          [user.id, user.tenantId, user.email, user.firstName, user.lastName]
        );
        await client.query(
          `INSERT INTO tenant.tenant_members (tenant_id, user_id, role, status, joined_at) VALUES ($1, $2, $3, 'active', NOW() - INTERVAL '30 days')`,
          [user.tenantId, user.id, user.role]
        );
        console.log(`  ✅ ${user.firstName} ${user.lastName}`);
      } finally {
        client.release();
      }
    }

    // Seed Projects
    console.log('\n📁 Creating projects...');
    for (const project of DEMO_PROJECTS) {
      const client = await tenantDb.getRawConnection();
      try {
        await client.query(
          `INSERT INTO app.projects (id, tenant_id, name, slug, description, status, visibility, created_by) VALUES ($1, $2, $3, $4, $5, 'active', 'internal', $6)`,
          [
            project.id,
            project.tenantId,
            project.name,
            project.slug,
            project.description,
            project.createdBy,
          ]
        );
        // Add members
        const users = DEMO_USERS.filter((u) => u.tenantId === project.tenantId).slice(0, 3);
        for (const u of users) {
          await client.query(
            `INSERT INTO app.project_members (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)`,
            [project.tenantId, project.id, u.id, u.role === 'owner' ? 'owner' : 'member']
          );
        }
        console.log(`  ✅ ${project.name}`);
      } finally {
        client.release();
      }
    }

    // Seed Tasks
    console.log('\n📋 Creating tasks...');
    for (const task of DEMO_TASKS) {
      const client = await tenantDb.getRawConnection();
      try {
        await client.query(
          `INSERT INTO app.tasks (id, tenant_id, project_id, title, status, priority, assignee_id, reporter_id, tags, due_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            task.id,
            task.tenantId,
            task.projectId,
            task.title,
            task.status,
            task.priority,
            task.assigneeId,
            task.reporterId,
            task.tags,
            task.dueDate,
          ]
        );
        console.log(`  ✅ ${task.title}`);
      } finally {
        client.release();
      }
    }

    // Seed Tags
    console.log('\n🏷️  Creating tags...');
    for (const tag of DEMO_TAGS) {
      const client = await tenantDb.getRawConnection();
      try {
        await client.query(`INSERT INTO app.tags (tenant_id, name, color) VALUES ($1, $2, $3)`, [
          tag.tenantId,
          tag.name,
          tag.color,
        ]);
      } finally {
        client.release();
      }
    }
    console.log(`  ✅ ${DEMO_TAGS.length} tags`);

    // Seed Comments
    console.log('\n💬 Creating comments...');
    for (const comment of DEMO_COMMENTS) {
      const client = await tenantDb.getRawConnection();
      try {
        await client.query(
          `INSERT INTO app.comments (tenant_id, entity_type, entity_id, content, author_id) VALUES ($1, $2, $3, $4, $5)`,
          [
            comment.tenantId,
            comment.entityType,
            comment.entityId,
            comment.content,
            comment.authorId,
          ]
        );
      } finally {
        client.release();
      }
    }
    console.log(`  ✅ ${DEMO_COMMENTS.length} comments`);

    console.log('\n✨ Seed completed!\n');
    console.log('📊 Summary:');
    console.log(`   • ${DEMO_TENANTS.length} tenants`);
    console.log(`   • ${DEMO_USERS.length} users`);
    console.log(`   • ${DEMO_PROJECTS.length} projects`);
    console.log(`   • ${DEMO_TASKS.length} tasks`);
    console.log(`   • ${DEMO_TAGS.length} tags`);
    console.log(`   • ${DEMO_COMMENTS.length} comments`);
    console.log('\n🚀 Run "pnpm dev" to start\n');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
