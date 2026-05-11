-- ============================================================================
-- Development Seed Data for Multi-Tenant Schema
-- ============================================================================
-- This file provides example data for development and testing
-- Run after schema.sql has been executed
-- ============================================================================

-- Clear existing data (for re-running seeds)
TRUNCATE TABLE tenant.tenant_invitations CASCADE;
TRUNCATE TABLE tenant.tenant_members CASCADE;
TRUNCATE TABLE tenant.tenants CASCADE;
TRUNCATE TABLE auth.role_permissions CASCADE;
TRUNCATE TABLE auth.permissions CASCADE;
TRUNCATE TABLE auth.user_roles CASCADE;
TRUNCATE TABLE auth.user_sessions CASCADE;
TRUNCATE TABLE auth.users CASCADE;
TRUNCATE TABLE app.activity_log CASCADE;
TRUNCATE TABLE app.attachments CASCADE;
TRUNCATE TABLE app.comments CASCADE;
TRUNCATE TABLE app.tasks CASCADE;
TRUNCATE TABLE app.project_members CASCADE;
TRUNCATE TABLE app.projects CASCADE;
TRUNCATE TABLE app.tags CASCADE;

-- ============================================================================
-- TENANTS
-- ============================================================================

-- Tenant 1: Acme Corporation
INSERT INTO tenant.tenants (id, tenant_id, name, slug, status, plan, settings) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'Acme Corporation', 'acme-corp', 'active', 'professional',
 '{"theme": "dark", "timezone": "America/New_York", "features": {"analytics": true, "integrations": true}}');

-- Tenant 2: TechStart Inc
INSERT INTO tenant.tenants (id, tenant_id, name, slug, status, plan, settings) VALUES
('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 
 'TechStart Inc', 'techstart', 'active', 'starter',
 '{"theme": "light", "timezone": "Europe/London", "features": {"analytics": false, "integrations": true}}');

-- Tenant 3: Trial Company
INSERT INTO tenant.tenants (id, tenant_id, name, slug, status, plan, settings) VALUES
('c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', 'c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', 
 'Trial Company', 'trial-company', 'trial', 'free',
 '{"theme": "light", "timezone": "UTC", "features": {"analytics": false, "integrations": false}}');

-- ============================================================================
-- USERS (Auth Schema)
-- ============================================================================

-- Acme Corporation Users
INSERT INTO auth.users (id, tenant_id, email, email_verified, password_hash, first_name, last_name, status) VALUES
('d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'alice@acme.com', TRUE, '$2b$10$example_hash_alice', 'Alice', 'Johnson', 'active'),
('e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'bob@acme.com', TRUE, '$2b$10$example_hash_bob', 'Bob', 'Smith', 'active'),
('f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'charlie@acme.com', TRUE, '$2b$10$example_hash_charlie', 'Charlie', 'Brown', 'active');

-- TechStart Users
INSERT INTO auth.users (id, tenant_id, email, email_verified, password_hash, first_name, last_name, status) VALUES
('a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d', 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 
 'diana@techstart.io', TRUE, '$2b$10$example_hash_diana', 'Diana', 'Lee', 'active'),
('b8c9d0e1-f2a3-4b4c-5d6e-7f8a9b0c1d2e', 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 
 'eve@techstart.io', TRUE, '$2b$10$example_hash_eve', 'Eve', 'Wilson', 'active');

-- Trial Company Users
INSERT INTO auth.users (id, tenant_id, email, email_verified, password_hash, first_name, last_name, status) VALUES
('c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f', 'c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', 
 'frank@trial.co', TRUE, '$2b$10$example_hash_frank', 'Frank', 'Davis', 'active');

-- ============================================================================
-- TENANT MEMBERS
-- ============================================================================

-- Acme Corporation Members
INSERT INTO tenant.tenant_members (tenant_id, user_id, role, status, joined_at) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 'owner', 'active', NOW() - INTERVAL '365 days'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b', 'admin', 'active', NOW() - INTERVAL '180 days'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'member', 'active', NOW() - INTERVAL '30 days');

-- TechStart Members
INSERT INTO tenant.tenant_members (tenant_id, user_id, role, status, joined_at) VALUES
('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d', 'owner', 'active', NOW() - INTERVAL '90 days'),
('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 'b8c9d0e1-f2a3-4b4c-5d6e-7f8a9b0c1d2e', 'member', 'active', NOW() - INTERVAL '60 days');

-- Trial Company Member
INSERT INTO tenant.tenant_members (tenant_id, user_id, role, status, joined_at) VALUES
('c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f', 'c9d0e1f2-a3b4-4c5d-6e7f-8a9b0c1d2e3f', 'owner', 'active', NOW() - INTERVAL '7 days');

-- ============================================================================
-- TENANT INVITATIONS
-- ============================================================================

INSERT INTO tenant.tenant_invitations (tenant_id, email, role, status, invited_by, expires_at) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'newuser@example.com', 'member', 'pending', 
 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', NOW() + INTERVAL '7 days'),
('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 'hiring@techstart.io', 'admin', 'pending', 
 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d', NOW() + INTERVAL '5 days');

-- ============================================================================
-- USER ROLES
-- ============================================================================

INSERT INTO auth.user_roles (tenant_id, user_id, role, granted_by) VALUES
-- Acme roles
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 'super_admin', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b', 'project_manager', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'developer', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b'),
-- TechStart roles
('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d', 'super_admin', 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d'),
('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 'b8c9d0e1-f2a3-4b4c-5d6e-7f8a9b0c1d2e', 'developer', 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d');

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

-- Acme Permissions
INSERT INTO auth.permissions (tenant_id, name, description, resource, action) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'projects.create', 'Create new projects', 'projects', 'create'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'projects.read', 'View projects', 'projects', 'read'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'projects.update', 'Update projects', 'projects', 'update'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'projects.delete', 'Delete projects', 'projects', 'delete'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'tasks.create', 'Create tasks', 'tasks', 'create'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'tasks.read', 'View tasks', 'tasks', 'read'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'tasks.update', 'Update tasks', 'tasks', 'update'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'tasks.delete', 'Delete tasks', 'tasks', 'delete'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'users.manage', 'Manage users', 'users', 'manage');

-- ============================================================================
-- ROLE PERMISSIONS
-- ============================================================================

-- Super Admin gets all permissions
INSERT INTO auth.role_permissions (tenant_id, role, permission_id)
SELECT 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'super_admin', id
FROM auth.permissions WHERE tenant_id = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

-- Project Manager gets project and task permissions
INSERT INTO auth.role_permissions (tenant_id, role, permission_id)
SELECT 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'project_manager', id
FROM auth.permissions 
WHERE tenant_id = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' 
AND name LIKE 'projects.%' OR name LIKE 'tasks.%';

-- Developer gets read/update permissions
INSERT INTO auth.role_permissions (tenant_id, role, permission_id)
SELECT 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'developer', id
FROM auth.permissions 
WHERE tenant_id = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' 
AND (name LIKE '%.read' OR name LIKE '%.update' OR name = 'tasks.create');

-- ============================================================================
-- PROJECTS (using tenant context)
-- ============================================================================

-- Set tenant context for Acme
SELECT app.set_tenant_context('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d');

-- Acme Projects
INSERT INTO app.projects (id, tenant_id, name, slug, description, status, visibility, created_by) VALUES
('11111111-1111-4111-8111-111111111111', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'Website Redesign', 'website-redesign', 
 'Complete overhaul of the company website with modern design', 
 'active', 'internal', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a'),
('22222222-2222-4222-8222-222222222222', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'Mobile App Development', 'mobile-app', 
 'Native iOS and Android application', 
 'active', 'private', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a'),
('33333333-3333-4333-8333-333333333333', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 
 'Q1 Marketing Campaign', 'q1-marketing', 
 'Launch campaign for new product line', 
 'active', 'internal', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b');

-- Set tenant context for TechStart
SELECT app.set_tenant_context('b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e');

-- TechStart Projects
INSERT INTO app.projects (id, tenant_id, name, slug, description, status, visibility, created_by) VALUES
('44444444-4444-4444-8444-444444444444', 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 
 'MVP Development', 'mvp-dev', 
 'Minimum viable product for investor demo', 
 'active', 'private', 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d'),
('55555555-5555-4555-8555-555555555555', 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e', 
 'Backend API', 'backend-api', 
 'RESTful API for mobile and web clients', 
 'active', 'private', 'a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d');

-- ============================================================================
-- PROJECT MEMBERS
-- ============================================================================

-- Set tenant context for Acme
SELECT app.set_tenant_context('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d');

-- Website Redesign Members
INSERT INTO app.project_members (tenant_id, project_id, user_id, role) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 'owner'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b', 'admin'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'member');

-- Mobile App Members
INSERT INTO app.project_members (tenant_id, project_id, user_id, role) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '22222222-2222-4222-8222-222222222222', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b', 'owner'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '22222222-2222-4222-8222-222222222222', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'member');

-- ============================================================================
-- TAGS
-- ============================================================================

-- Acme Tags
INSERT INTO app.tags (tenant_id, name, color, description) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'bug', '#e74c3c', 'Bug fixes and issues'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'feature', '#3498db', 'New features'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'enhancement', '#2ecc71', 'Improvements to existing features'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'documentation', '#9b59b6', 'Documentation updates'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'urgent', '#e67e22', 'High priority items');

-- ============================================================================
-- TASKS
-- ============================================================================

-- Website Redesign Tasks
INSERT INTO app.tasks (id, tenant_id, project_id, title, description, status, priority, type, assignee_id, reporter_id, due_date, tags) VALUES
('aaaa1111-1111-4111-8111-111111111111', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111',
 'Design homepage mockups', 'Create wireframes and high-fidelity mockups for the new homepage', 
 'in_progress', 'high', 'task', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
 NOW() + INTERVAL '7 days', ARRAY['feature', 'design']),

('aaaa2222-2222-4222-8222-222222222222', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111',
 'Implement responsive navigation', 'Build mobile-friendly navigation component', 
 'todo', 'medium', 'task', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
 NOW() + INTERVAL '14 days', ARRAY['feature', 'frontend']),

('aaaa3333-3333-4333-8333-333333333333', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111',
 'Fix footer links', 'Footer links are broken on mobile devices', 
 'done', 'low', 'bug', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
 NOW() - INTERVAL '2 days', ARRAY['bug']),

-- Subtask for homepage mockups
('aaaa4444-4444-4444-8444-444444444444', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '11111111-1111-4111-8111-111111111111',
 'Create color palette', 'Define brand colors and design tokens', 
 'done', 'medium', 'subtask', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c',
 NOW() - INTERVAL '5 days', ARRAY['design'], 'aaaa1111-1111-4111-8111-111111111111');

-- Mobile App Tasks
INSERT INTO app.tasks (id, tenant_id, project_id, title, description, status, priority, type, assignee_id, reporter_id, due_date, tags) VALUES
('bbbb1111-1111-4111-8111-111111111111', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '22222222-2222-4222-8222-222222222222',
 'Setup React Native project', 'Initialize React Native with TypeScript and navigation', 
 'done', 'high', 'task', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
 NOW() - INTERVAL '10 days', ARRAY['feature', 'setup']),

('bbbb2222-2222-4222-8222-222222222222', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '22222222-2222-4222-8222-222222222222',
 'Implement user authentication', 'Add login, signup, and password reset screens', 
 'in_progress', 'urgent', 'feature', NULL, 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b',
 NOW() + INTERVAL '5 days', ARRAY['feature', 'security']);

-- ============================================================================
-- COMMENTS
-- ============================================================================

-- Comments on tasks
INSERT INTO app.comments (tenant_id, entity_type, entity_id, content, author_id) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'task', 'aaaa1111-1111-4111-8111-111111111111',
 'I have completed the wireframes. Moving on to high-fidelity mockups now.', 
 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'task', 'aaaa1111-1111-4111-8111-111111111111',
 'Great progress! Can you share a preview when ready?', 
 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'task', 'bbbb2222-2222-4222-8222-222222222222',
 'We need to ensure OAuth2 support for social logins.', 
 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b');

-- ============================================================================
-- ACTIVITY LOG
-- ============================================================================

INSERT INTO app.activity_log (tenant_id, entity_type, entity_id, action, actor_id, changes) VALUES
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'task', 'aaaa1111-1111-4111-8111-111111111111', 
 'created', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 
 '{"title": "Design homepage mockups", "status": "todo"}'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'task', 'aaaa1111-1111-4111-8111-111111111111', 
 'updated', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 
 '{"status": {"from": "todo", "to": "in_progress"}}'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'task', 'aaaa3333-3333-4333-8333-333333333333', 
 'completed', 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c', 
 '{"status": {"from": "in_progress", "to": "done"}, "completed_at": "2025-03-31T10:00:00Z"}'),
('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'project', '11111111-1111-4111-8111-111111111111', 
 'created', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 
 '{"name": "Website Redesign", "status": "active"}');

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Uncomment these to verify the seed data

-- -- Check tenants
-- SELECT app.set_tenant_context('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d');
-- SELECT * FROM tenant.tenants;

-- -- Check users in Acme tenant
-- SELECT * FROM auth.users;

-- -- Check projects
-- SELECT * FROM app.projects;

-- -- Check tasks
-- SELECT * FROM app.tasks;

-- -- Check project summary view
-- SELECT * FROM app.project_summary;

-- -- Check task details view
-- SELECT * FROM app.task_details;