/**
 * Initial Schema Migration
 *
 * Creates the multi-tenant PostgreSQL schema with Row-Level Security.
 */

export const shorthands = undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(pgm: any): Promise<void> {
  // Enable required extensions
  pgm.createExtension('uuid-ossp', { ifNotExists: true });
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  // ============================================================================
  // SCHEMA: tenant - Core tenant management
  // ============================================================================
  pgm.createSchema('tenant', { ifNotExists: true });

  // Tenants table
  pgm.createTable(
    { schema: 'tenant', name: 'tenants' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true, default: pgm.func('uuid_generate_v4()') },
      name: { type: 'varchar(255)', notNull: true },
      slug: { type: 'varchar(100)', notNull: true, unique: true },
      status: { type: 'varchar(20)', notNull: true, default: 'active' },
      plan: { type: 'varchar(50)', notNull: true, default: 'free' },
      settings: { type: 'jsonb', notNull: true, default: '{}' },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      deleted_at: { type: 'timestamptz' },
    }
  );

  // Tenant members
  pgm.createTable(
    { schema: 'tenant', name: 'tenant_members' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      user_id: { type: 'uuid', notNull: true },
      role: { type: 'varchar(50)', notNull: true, default: 'member' },
      status: { type: 'varchar(20)', notNull: true, default: 'active' },
      invited_at: { type: 'timestamptz' },
      joined_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );
  pgm.addConstraint({ schema: 'tenant', name: 'tenant_members' }, 'tenant_members_unique', {
    unique: ['tenant_id', 'user_id'],
  });

  // Tenant invitations
  pgm.createTable(
    { schema: 'tenant', name: 'tenant_invitations' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      email: { type: 'varchar(255)', notNull: true },
      role: { type: 'varchar(50)', notNull: true, default: 'member' },
      token: {
        type: 'varchar(255)',
        notNull: true,
        unique: true,
        default: pgm.func("encode(gen_random_bytes(32), 'hex')"),
      },
      status: { type: 'varchar(20)', notNull: true, default: 'pending' },
      invited_by: { type: 'uuid', notNull: true },
      expires_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func("NOW() + INTERVAL '7 days'"),
      },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  // Indexes for tenant tables
  pgm.createIndex({ schema: 'tenant', name: 'tenants' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'tenants' }, 'slug', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'tenants' }, 'status', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'tenant_members' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'tenant_members' }, 'user_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'tenant_invitations' }, 'tenant_id', {
    ifNotExists: true,
  });
  pgm.createIndex({ schema: 'tenant', name: 'tenant_invitations' }, 'token', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'tenant_invitations' }, 'email', { ifNotExists: true });

  // Enable RLS on tenant tables
  pgm.sql('ALTER TABLE tenant.tenants ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE tenant.tenant_members ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE tenant.tenant_invitations ENABLE ROW LEVEL SECURITY');

  // RLS Policies for tenant schema
  pgm.sql(`CREATE POLICY tenant_isolation ON tenant.tenants
    USING (id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY tenant_members_isolation ON tenant.tenant_members
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY tenant_invitations_isolation ON tenant.tenant_invitations
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);

  // ============================================================================
  // SCHEMA: auth - Authentication and user management
  // ============================================================================
  pgm.createSchema('auth', { ifNotExists: true });

  // Users table
  pgm.createTable(
    { schema: 'auth', name: 'users' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      email: { type: 'varchar(255)', notNull: true, unique: true },
      email_verified: { type: 'boolean', notNull: true, default: false },
      password_hash: { type: 'varchar(255)' },
      first_name: { type: 'varchar(100)' },
      last_name: { type: 'varchar(100)' },
      avatar_url: { type: 'text' },
      phone: { type: 'varchar(20)' },
      status: { type: 'varchar(20)', notNull: true, default: 'active' },
      last_login_at: { type: 'timestamptz' },
      last_login_ip: { type: 'inet' },
      login_count: { type: 'integer', notNull: true, default: 0 },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      deleted_at: { type: 'timestamptz' },
    }
  );

  // User sessions
  pgm.createTable(
    { schema: 'auth', name: 'user_sessions' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'auth', name: 'users' },
        onDelete: 'CASCADE',
      },
      token: { type: 'varchar(500)', notNull: true },
      refresh_token: { type: 'varchar(500)' },
      ip_address: { type: 'inet' },
      user_agent: { type: 'text' },
      expires_at: { type: 'timestamptz', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  // User roles
  pgm.createTable(
    { schema: 'auth', name: 'user_roles' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'auth', name: 'users' },
        onDelete: 'CASCADE',
      },
      role: { type: 'varchar(50)', notNull: true },
      granted_by: { type: 'uuid', references: { schema: 'auth', name: 'users' } },
      granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      expires_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );
  pgm.addConstraint({ schema: 'auth', name: 'user_roles' }, 'user_roles_unique', {
    unique: ['tenant_id', 'user_id', 'role'],
  });

  // Permissions
  pgm.createTable(
    { schema: 'auth', name: 'permissions' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      name: { type: 'varchar(100)', notNull: true },
      description: { type: 'text' },
      resource: { type: 'varchar(100)', notNull: true },
      action: { type: 'varchar(50)', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );
  pgm.addConstraint({ schema: 'auth', name: 'permissions' }, 'permissions_unique', {
    unique: ['tenant_id', 'name'],
  });

  // Role permissions mapping
  pgm.createTable(
    { schema: 'auth', name: 'role_permissions' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      role: { type: 'varchar(50)', notNull: true },
      permission_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'auth', name: 'permissions' },
        onDelete: 'CASCADE',
      },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );
  pgm.addConstraint({ schema: 'auth', name: 'role_permissions' }, 'role_permissions_unique', {
    unique: ['tenant_id', 'role', 'permission_id'],
  });

  // Indexes for auth tables
  pgm.createIndex({ schema: 'auth', name: 'users' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'users' }, 'email', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'users' }, 'status', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'user_sessions' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'user_sessions' }, 'user_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'user_sessions' }, 'token', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'user_sessions' }, 'expires_at', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'user_roles' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'user_roles' }, 'user_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'permissions' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'auth', name: 'role_permissions' }, 'tenant_id', { ifNotExists: true });

  // Enable RLS on auth tables
  pgm.sql('ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE auth.user_sessions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE auth.user_roles ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE auth.permissions ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE auth.role_permissions ENABLE ROW LEVEL SECURITY');

  // RLS Policies for auth schema
  pgm.sql(`CREATE POLICY users_isolation ON auth.users
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY user_sessions_isolation ON auth.user_sessions
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY user_roles_isolation ON auth.user_roles
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY permissions_isolation ON auth.permissions
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY role_permissions_isolation ON auth.role_permissions
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);

  // ============================================================================
  // SCHEMA: app - Application-specific tables
  // ============================================================================
  pgm.createSchema('app', { ifNotExists: true });

  // Projects table
  pgm.createTable(
    { schema: 'app', name: 'projects' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      name: { type: 'varchar(255)', notNull: true },
      slug: { type: 'varchar(100)', notNull: true },
      description: { type: 'text' },
      status: { type: 'varchar(20)', notNull: true, default: 'active' },
      visibility: { type: 'varchar(20)', notNull: true, default: 'private' },
      settings: { type: 'jsonb', notNull: true, default: '{}' },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_by: { type: 'uuid', notNull: true },
      updated_by: { type: 'uuid' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      deleted_at: { type: 'timestamptz' },
    }
  );
  pgm.addConstraint({ schema: 'app', name: 'projects' }, 'projects_tenant_slug_unique', {
    unique: ['tenant_id', 'slug'],
  });

  // Project members
  pgm.createTable(
    { schema: 'app', name: 'project_members' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      project_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'app', name: 'projects' },
        onDelete: 'CASCADE',
      },
      user_id: { type: 'uuid', notNull: true },
      role: { type: 'varchar(50)', notNull: true, default: 'member' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );
  pgm.addConstraint({ schema: 'app', name: 'project_members' }, 'project_members_unique', {
    unique: ['tenant_id', 'project_id', 'user_id'],
  });

  // Tasks
  pgm.createTable(
    { schema: 'app', name: 'tasks' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      project_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'app', name: 'projects' },
        onDelete: 'CASCADE',
      },
      parent_id: {
        type: 'uuid',
        references: { schema: 'app', name: 'tasks' },
        onDelete: 'SET NULL',
      },
      title: { type: 'varchar(500)', notNull: true },
      description: { type: 'text' },
      status: { type: 'varchar(50)', notNull: true, default: 'todo' },
      priority: { type: 'varchar(20)', notNull: true, default: 'medium' },
      type: { type: 'varchar(50)', notNull: true, default: 'task' },
      assignee_id: { type: 'uuid' },
      reporter_id: { type: 'uuid', notNull: true },
      due_date: { type: 'timestamptz' },
      estimated_hours: { type: 'decimal(10,2)' },
      actual_hours: { type: 'decimal(10,2)' },
      tags: { type: 'text[]', default: '{}' },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      completed_at: { type: 'timestamptz' },
      deleted_at: { type: 'timestamptz' },
    }
  );

  // Comments
  pgm.createTable(
    { schema: 'app', name: 'comments' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      entity_type: { type: 'varchar(50)', notNull: true },
      entity_id: { type: 'uuid', notNull: true },
      parent_id: {
        type: 'uuid',
        references: { schema: 'app', name: 'comments' },
        onDelete: 'CASCADE',
      },
      content: { type: 'text', notNull: true },
      author_id: { type: 'uuid', notNull: true },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      deleted_at: { type: 'timestamptz' },
    }
  );

  // Attachments
  pgm.createTable(
    { schema: 'app', name: 'attachments' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      entity_type: { type: 'varchar(50)', notNull: true },
      entity_id: { type: 'uuid', notNull: true },
      filename: { type: 'varchar(255)', notNull: true },
      original_name: { type: 'varchar(255)', notNull: true },
      mime_type: { type: 'varchar(100)', notNull: true },
      size_bytes: { type: 'bigint', notNull: true },
      storage_path: { type: 'text', notNull: true },
      url: { type: 'text' },
      uploaded_by: { type: 'uuid', notNull: true },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      deleted_at: { type: 'timestamptz' },
    }
  );

  // Activity log
  pgm.createTable(
    { schema: 'app', name: 'activity_log' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      entity_type: { type: 'varchar(50)', notNull: true },
      entity_id: { type: 'uuid', notNull: true },
      action: { type: 'varchar(50)', notNull: true },
      actor_id: { type: 'uuid', notNull: true },
      actor_type: { type: 'varchar(20)', notNull: true, default: 'user' },
      changes: { type: 'jsonb' },
      ip_address: { type: 'inet' },
      user_agent: { type: 'text' },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  // Tags
  pgm.createTable(
    { schema: 'app', name: 'tags' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      name: { type: 'varchar(100)', notNull: true },
      color: { type: 'varchar(7)' },
      description: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );
  pgm.addConstraint({ schema: 'app', name: 'tags' }, 'tags_tenant_name_unique', {
    unique: ['tenant_id', 'name'],
  });

  // Indexes for app tables
  pgm.createIndex({ schema: 'app', name: 'projects' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'projects' }, 'status', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'projects' }, 'created_by', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'project_members' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'project_members' }, 'project_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'project_members' }, 'user_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'project_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'parent_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'assignee_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'reporter_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'status', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'priority', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'due_date', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tasks' }, 'tags', { method: 'gin', ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'comments' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'comments' }, ['entity_type', 'entity_id'], {
    ifNotExists: true,
  });
  pgm.createIndex({ schema: 'app', name: 'comments' }, 'author_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'comments' }, 'parent_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'attachments' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'attachments' }, ['entity_type', 'entity_id'], {
    ifNotExists: true,
  });
  pgm.createIndex({ schema: 'app', name: 'attachments' }, 'uploaded_by', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'activity_log' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'activity_log' }, ['entity_type', 'entity_id'], {
    ifNotExists: true,
  });
  pgm.createIndex({ schema: 'app', name: 'activity_log' }, 'actor_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'activity_log' }, 'created_at', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'tags' }, 'tenant_id', { ifNotExists: true });

  // Enable RLS on app tables
  pgm.sql('ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE app.project_members ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE app.comments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE app.attachments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE app.activity_log ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE app.tags ENABLE ROW LEVEL SECURITY');

  // RLS Policies for app schema
  pgm.sql(`CREATE POLICY projects_isolation ON app.projects
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY project_members_isolation ON app.project_members
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY tasks_isolation ON app.tasks
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY comments_isolation ON app.comments
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY attachments_isolation ON app.attachments
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY activity_log_isolation ON app.activity_log
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);
  pgm.sql(`CREATE POLICY tags_isolation ON app.tags
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  pgm.sql(`CREATE OR REPLACE FUNCTION app.set_tenant_context(p_tenant_id UUID)
    RETURNS VOID AS $$
    BEGIN
      PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
    END;
    $$ LANGUAGE plpgsql`);

  pgm.sql(`CREATE OR REPLACE FUNCTION app.get_tenant_id()
    RETURNS UUID AS $$
    BEGIN
      RETURN current_setting('app.current_tenant_id')::UUID;
    EXCEPTION
      WHEN invalid_parameter_value THEN
        RAISE EXCEPTION 'Tenant context not set. Call set_tenant_context() first.';
    END;
    $$ LANGUAGE plpgsql`);

  pgm.sql(`CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);

  // Apply updated_at triggers
  const tablesWithUpdatedAt = [
    { schema: 'tenant', name: 'tenants' },
    { schema: 'tenant', name: 'tenant_members' },
    { schema: 'tenant', name: 'tenant_invitations' },
    { schema: 'auth', name: 'users' },
    { schema: 'auth', name: 'user_sessions' },
    { schema: 'app', name: 'projects' },
    { schema: 'app', name: 'project_members' },
    { schema: 'app', name: 'tasks' },
    { schema: 'app', name: 'comments' },
    { schema: 'app', name: 'attachments' },
    { schema: 'app', name: 'tags' },
  ];

  for (const table of tablesWithUpdatedAt) {
    pgm.sql(`CREATE TRIGGER update_${table.name}_updated_at 
      BEFORE UPDATE ON ${table.schema}.${table.name}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);
  }

  // ============================================================================
  // VIEWS
  // ============================================================================

  pgm.sql(`CREATE VIEW auth.user_tenants AS
    SELECT 
      u.id AS user_id,
      u.email,
      u.first_name,
      u.last_name,
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      tm.role AS tenant_role,
      tm.status AS membership_status
    FROM auth.users u
    JOIN tenant.tenant_members tm ON u.id = tm.user_id
    JOIN tenant.tenants t ON tm.tenant_id = t.id`);

  pgm.sql(`CREATE VIEW app.project_summary AS
    SELECT 
      p.*,
      COUNT(DISTINCT pm.user_id) AS member_count,
      COUNT(DISTINCT t.id) AS task_count,
      COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) AS completed_task_count
    FROM app.projects p
    LEFT JOIN app.project_members pm ON p.id = pm.project_id
    LEFT JOIN app.tasks t ON p.id = t.project_id
    GROUP BY p.id`);

  pgm.sql(`CREATE VIEW app.task_details AS
    SELECT 
      t.*,
      assignee.first_name AS assignee_first_name,
      assignee.last_name AS assignee_last_name,
      assignee.avatar_url AS assignee_avatar_url,
      reporter.first_name AS reporter_first_name,
      reporter.last_name AS reporter_last_name,
      p.name AS project_name,
      p.slug AS project_slug
    FROM app.tasks t
    LEFT JOIN auth.users assignee ON t.assignee_id = assignee.id
    LEFT JOIN auth.users reporter ON t.reporter_id = reporter.id
    JOIN app.projects p ON t.project_id = p.id`);

  // Add comments
  pgm.sql("COMMENT ON SCHEMA tenant IS 'Core tenant management schema for multi-tenancy'");
  pgm.sql("COMMENT ON SCHEMA auth IS 'Authentication and user management schema'");
  pgm.sql("COMMENT ON SCHEMA app IS 'Application-specific business logic schema'");
  pgm.sql(
    "COMMENT ON TABLE tenant.tenants IS 'Root table for tenant definitions. Each tenant is an isolated organization.'"
  );
  pgm.sql(
    "COMMENT ON TABLE auth.users IS 'User accounts. Users can belong to multiple tenants via tenant_members.'"
  );
  pgm.sql(
    "COMMENT ON TABLE app.projects IS 'Projects belong to a tenant and contain tasks and other resources.'"
  );
  pgm.sql(
    "COMMENT ON TABLE app.tasks IS 'Work items within a project, supporting hierarchies via parent_id.'"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(pgm: any): Promise<void> {
  // Drop views
  pgm.dropView({ schema: 'app', name: 'task_details' }, { ifExists: true });
  pgm.dropView({ schema: 'app', name: 'project_summary' }, { ifExists: true });
  pgm.dropView({ schema: 'auth', name: 'user_tenants' }, { ifExists: true });

  // Drop functions
  pgm.sql('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
  pgm.sql('DROP FUNCTION IF EXISTS app.get_tenant_id() CASCADE');
  pgm.sql('DROP FUNCTION IF EXISTS app.set_tenant_context(UUID) CASCADE');

  // Drop app tables
  pgm.dropTable({ schema: 'app', name: 'tags' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'app', name: 'activity_log' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'app', name: 'attachments' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'app', name: 'comments' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'app', name: 'tasks' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'app', name: 'project_members' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'app', name: 'projects' }, { ifExists: true, cascade: true });

  // Drop auth tables
  pgm.dropTable({ schema: 'auth', name: 'role_permissions' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'auth', name: 'permissions' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'auth', name: 'user_roles' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'auth', name: 'user_sessions' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'auth', name: 'users' }, { ifExists: true, cascade: true });

  // Drop tenant tables
  pgm.dropTable(
    { schema: 'tenant', name: 'tenant_invitations' },
    { ifExists: true, cascade: true }
  );
  pgm.dropTable({ schema: 'tenant', name: 'tenant_members' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'tenant', name: 'tenants' }, { ifExists: true, cascade: true });

  // Drop schemas
  pgm.dropSchema('app', { ifExists: true });
  pgm.dropSchema('auth', { ifExists: true });
  pgm.dropSchema('tenant', { ifExists: true });

  // Drop extensions
  pgm.dropExtension('pgcrypto', { ifExists: true });
  pgm.dropExtension('uuid-ossp', { ifExists: true });
}
