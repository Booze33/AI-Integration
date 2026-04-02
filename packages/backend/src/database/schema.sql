-- ============================================================================
-- Multi-Tenant PostgreSQL Schema with Row-Level Security (RLS)
-- ============================================================================
-- Design Principles:
-- - tenant_id on EVERY table for row-level isolation
-- - Row-Level Security policies enforce tenant isolation at database level
-- - Separate schemas for logical organization (public, auth, app)
-- - Optimized indexes for tenant-scoped queries
-- - Audit columns (created_at, updated_at, created_by, updated_by)
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SCHEMA: tenant - Core tenant management
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS tenant;

-- Tenants table - Root of multi-tenancy
CREATE TABLE tenant.tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    plan            VARCHAR(50) NOT NULL DEFAULT 'free',
    settings        JSONB NOT NULL DEFAULT '{}',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    
    -- Ensure tenant_id matches id for the tenants table itself
    CONSTRAINT tenants_tenant_id_matches_id CHECK (tenant_id = id)
);

CREATE INDEX idx_tenants_tenant_id ON tenant.tenants(tenant_id);
CREATE INDEX idx_tenants_slug ON tenant.tenants(slug);
CREATE INDEX idx_tenants_status ON tenant.tenants(status);

-- Tenant members - Users associated with tenants (many-to-many)
CREATE TABLE tenant.tenant_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    invited_at      TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT tenant_members_unique UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_tenant_members_tenant_id ON tenant.tenant_members(tenant_id);
CREATE INDEX idx_tenant_members_user_id ON tenant.tenant_members(user_id);

-- Tenant invitations
CREATE TABLE tenant.tenant_invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'member',
    token           VARCHAR(255) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    invited_by      UUID NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_invitations_tenant_id ON tenant.tenant_invitations(tenant_id);
CREATE INDEX idx_tenant_invitations_token ON tenant.tenant_invitations(token);
CREATE INDEX idx_tenant_invitations_email ON tenant.tenant_invitations(email);

-- Enable RLS on tenant tables
ALTER TABLE tenant.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant schema
CREATE POLICY tenant_isolation ON tenant.tenants
    USING (id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY tenant_members_isolation ON tenant.tenant_members
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY tenant_invitations_isolation ON tenant.tenant_invitations
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);


-- ============================================================================
-- SCHEMA: auth - Authentication and user management
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS auth;

-- Users table - Global user accounts
CREATE TABLE auth.users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    email           VARCHAR(255) NOT NULL,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash   VARCHAR(255),
    first_name      VARCHAR(100),
    last_name       VARCHAR(100),
    avatar_url      TEXT,
    phone           VARCHAR(20),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'pending_verification')),
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET,
    login_count     INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    
    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX idx_users_tenant_id ON auth.users(tenant_id);
CREATE INDEX idx_users_email ON auth.users(email);
CREATE INDEX idx_users_status ON auth.users(status);

-- User sessions
CREATE TABLE auth.user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token           VARCHAR(500) NOT NULL,
    refresh_token   VARCHAR(500),
    ip_address      INET,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_tenant_id ON auth.user_sessions(tenant_id);
CREATE INDEX idx_user_sessions_user_id ON auth.user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON auth.user_sessions(token);
CREATE INDEX idx_user_sessions_expires_at ON auth.user_sessions(expires_at);

-- User roles (global roles within tenant)
CREATE TABLE auth.user_roles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL,
    granted_by      UUID REFERENCES auth.users(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT user_roles_unique UNIQUE (tenant_id, user_id, role)
);

CREATE INDEX idx_user_roles_tenant_id ON auth.user_roles(tenant_id);
CREATE INDEX idx_user_roles_user_id ON auth.user_roles(user_id);

-- Permissions
CREATE TABLE auth.permissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    resource        VARCHAR(100) NOT NULL,
    action          VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT permissions_unique UNIQUE (tenant_id, name)
);

CREATE INDEX idx_permissions_tenant_id ON auth.permissions(tenant_id);

-- Role permissions mapping
CREATE TABLE auth.role_permissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    role            VARCHAR(50) NOT NULL,
    permission_id   UUID NOT NULL REFERENCES auth.permissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT role_permissions_unique UNIQUE (tenant_id, role, permission_id)
);

CREATE INDEX idx_role_permissions_tenant_id ON auth.role_permissions(tenant_id);

-- Enable RLS on auth tables
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.role_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for auth schema
CREATE POLICY users_isolation ON auth.users
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY user_sessions_isolation ON auth.user_sessions
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY user_roles_isolation ON auth.user_roles
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY permissions_isolation ON auth.permissions
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY role_permissions_isolation ON auth.role_permissions
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);


-- ============================================================================
-- SCHEMA: app - Application-specific tables
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS app;

-- Projects table
CREATE TABLE app.projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    visibility      VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'internal', 'public')),
    settings        JSONB NOT NULL DEFAULT '{}',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_by      UUID NOT NULL,
    updated_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    
    CONSTRAINT projects_tenant_slug_unique UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_projects_tenant_id ON app.projects(tenant_id);
CREATE INDEX idx_projects_status ON app.projects(status);
CREATE INDEX idx_projects_created_by ON app.projects(created_by);

-- Project members
CREATE TABLE app.project_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    project_id      UUID NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT project_members_unique UNIQUE (tenant_id, project_id, user_id)
);

CREATE INDEX idx_project_members_tenant_id ON app.project_members(tenant_id);
CREATE INDEX idx_project_members_project_id ON app.project_members(project_id);
CREATE INDEX idx_project_members_user_id ON app.project_members(user_id);

-- Tasks / Work items
CREATE TABLE app.tasks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    project_id      UUID NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES app.tasks(id) ON DELETE SET NULL,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    status          VARCHAR(50) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done', 'cancelled')),
    priority        VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    type            VARCHAR(50) NOT NULL DEFAULT 'task',
    assignee_id     UUID,
    reporter_id     UUID NOT NULL,
    due_date        TIMESTAMPTZ,
    estimated_hours DECIMAL(10,2),
    actual_hours    DECIMAL(10,2),
    tags            TEXT[] DEFAULT '{}',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_tasks_tenant_id ON app.tasks(tenant_id);
CREATE INDEX idx_tasks_project_id ON app.tasks(project_id);
CREATE INDEX idx_tasks_parent_id ON app.tasks(parent_id);
CREATE INDEX idx_tasks_assignee_id ON app.tasks(assignee_id);
CREATE INDEX idx_tasks_reporter_id ON app.tasks(reporter_id);
CREATE INDEX idx_tasks_status ON app.tasks(status);
CREATE INDEX idx_tasks_priority ON app.tasks(priority);
CREATE INDEX idx_tasks_due_date ON app.tasks(due_date);
CREATE INDEX idx_tasks_tags ON app.tasks USING GIN(tags);

-- Comments
CREATE TABLE app.comments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID NOT NULL,
    parent_id       UUID REFERENCES app.comments(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    author_id       UUID NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_comments_tenant_id ON app.comments(tenant_id);
CREATE INDEX idx_comments_entity ON app.comments(entity_type, entity_id);
CREATE INDEX idx_comments_author_id ON app.comments(author_id);
CREATE INDEX idx_comments_parent_id ON app.comments(parent_id);

-- Attachments
CREATE TABLE app.attachments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID NOT NULL,
    filename        VARCHAR(255) NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,
    url             TEXT,
    uploaded_by     UUID NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_attachments_tenant_id ON app.attachments(tenant_id);
CREATE INDEX idx_attachments_entity ON app.attachments(entity_type, entity_id);
CREATE INDEX idx_attachments_uploaded_by ON app.attachments(uploaded_by);

-- Activity / Audit log
CREATE TABLE app.activity_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID NOT NULL,
    action          VARCHAR(50) NOT NULL,
    actor_id        UUID NOT NULL,
    actor_type      VARCHAR(20) NOT NULL DEFAULT 'user',
    changes         JSONB,
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_log_tenant_id ON app.activity_log(tenant_id);
CREATE INDEX idx_activity_log_entity ON app.activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_log_actor_id ON app.activity_log(actor_id);
CREATE INDEX idx_activity_log_created_at ON app.activity_log(created_at);

-- Tags (reusable labels)
CREATE TABLE app.tags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    name            VARCHAR(100) NOT NULL,
    color           VARCHAR(7),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT tags_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX idx_tags_tenant_id ON app.tags(tenant_id);

-- Enable RLS on app tables
ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies for app schema
CREATE POLICY projects_isolation ON app.projects
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY project_members_isolation ON app.project_members
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY tasks_isolation ON app.tasks
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY comments_isolation ON app.comments
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY attachments_isolation ON app.attachments
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY activity_log_isolation ON app.activity_log
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY tags_isolation ON app.tags
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);


-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to set current tenant context (call at start of each request)
CREATE OR REPLACE FUNCTION app.set_tenant_context(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
END;
$$ LANGUAGE plpgsql;

-- Function to get current tenant context
CREATE OR REPLACE FUNCTION app.get_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_tenant_id')::UUID;
EXCEPTION
    WHEN invalid_parameter_value THEN
        RAISE EXCEPTION 'Tenant context not set. Call set_tenant_context() first.';
END;
$$ LANGUAGE plpgsql;

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all relevant tables
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenant.tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_members_updated_at BEFORE UPDATE ON tenant.tenant_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_invitations_updated_at BEFORE UPDATE ON tenant.tenant_invitations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON auth.user_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON app.projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_members_updated_at BEFORE UPDATE ON app.project_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON app.tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON app.comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attachments_updated_at BEFORE UPDATE ON app.attachments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON app.tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- VIEWS for common queries
-- ============================================================================

-- View: Users with their tenant memberships
CREATE VIEW auth.user_tenants AS
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
JOIN tenant.tenants t ON tm.tenant_id = t.id;

-- View: Projects with member count
CREATE VIEW app.project_summary AS
SELECT 
    p.*,
    COUNT(DISTINCT pm.user_id) AS member_count,
    COUNT(DISTINCT t.id) AS task_count,
    COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) AS completed_task_count
FROM app.projects p
LEFT JOIN app.project_members pm ON p.id = pm.project_id
LEFT JOIN app.tasks t ON p.id = t.project_id
GROUP BY p.id;

-- View: Tasks with assignee details
CREATE VIEW app.task_details AS
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
JOIN app.projects p ON t.project_id = p.id;


-- ============================================================================
-- COMMENTS for documentation
-- ============================================================================
COMMENT ON SCHEMA tenant IS 'Core tenant management schema for multi-tenancy';
COMMENT ON SCHEMA auth IS 'Authentication and user management schema';
COMMENT ON SCHEMA app IS 'Application-specific business logic schema';

COMMENT ON TABLE tenant.tenants IS 'Root table for tenant definitions. Each tenant is an isolated organization.';
COMMENT ON TABLE auth.users IS 'User accounts. Users can belong to multiple tenants via tenant_members.';
COMMENT ON TABLE app.projects IS 'Projects belong to a tenant and contain tasks and other resources.';
COMMENT ON TABLE app.tasks IS 'Work items within a project, supporting hierarchies via parent_id.';

COMMENT ON FUNCTION app.set_tenant_context IS 'Sets the tenant context for the current session. Call this at the start of each request.';
COMMENT ON FUNCTION app.get_tenant_id IS 'Returns the current tenant ID from session context.';