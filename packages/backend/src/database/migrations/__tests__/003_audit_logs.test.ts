import { describe, expect, it, vi } from 'vitest';
import { up } from '../003_audit_logs';

describe('003_audit_logs migration', () => {
  it('creates the app.audit_logs table with required columns', async () => {
    const pgm = {
      createTable: vi.fn(),
      createIndex: vi.fn(),
      func: vi.fn((value: string) => value),
    } as any;

    await up(pgm);

    expect(pgm.createTable).toHaveBeenCalledOnce();
    const [tableRef, columns] = pgm.createTable.mock.calls[0];
    expect(tableRef).toEqual({ schema: 'app', name: 'audit_logs' });
    expect(columns).toHaveProperty('tenant_id');
    expect(columns).toHaveProperty('user_id');
    expect(columns).toHaveProperty('action');
    expect(columns).toHaveProperty('resource');
    expect(columns).toHaveProperty('ip_address');
    expect(columns).toHaveProperty('user_agent');
    expect(columns).toHaveProperty('status_code');
    expect(columns).toHaveProperty('timestamp');
  });
});
