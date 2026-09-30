import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => mockPool),
  },
}));

const { app, purgeExpiredHistory } = await import('./server.js');

describe('API backend', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.getConnection.mockReset();

    mockPool.getConnection.mockResolvedValue({
      release: vi.fn(),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      query: vi.fn(),
    });
  });

  it('logs in a valid user', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT username, role, email, phone FROM users')) {
        return [[{ username: 'admin', role: 'admin', email: 'admin@autosupply.local', phone: '+60123456789' }]];
      }

      return [[{ count: 0 }]];
    });

    const response = await request(app)
      .post('/api/login')
      .send({ username: 'admin', password: 'admin123' })
      .expect(200);

    expect(response.body).toMatchObject({
      username: 'admin',
      role: 'admin',
      email: 'admin@autosupply.local',
      phone: '+60123456789',
    });
  });

  it('rejects invalid login credentials', async () => {
    mockPool.query.mockResolvedValue([[]]);

    const response = await request(app)
      .post('/api/login')
      .send({ username: 'admin', password: 'wrong-pass' })
      .expect(401);

    expect(response.body).toMatchObject({ error: 'Invalid login details.' });
  });

  it('ignores legacy email validation when creating a user', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT COUNT(*) AS count FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1')) {
        return [[{ count: 0 }]];
      }

      return [[]];
    });

    const response = await request(app)
      .post('/api/users')
      .send({ username: 'adada', password: '12345', role: 'staff', email: 'not-an-email', phone: '1234567' })
      .expect(201);

    expect(response.body).toMatchObject({ ok: true, username: 'adada' });
  });

  it('purges old audit entries based on retention days', async () => {
    mockPool.query.mockResolvedValue([{ affectedRows: 7 }]);

    const deletedCount = await purgeExpiredHistory();

    expect(deletedCount).toBe(7);
    expect(mockPool.query).toHaveBeenCalledWith(
      'DELETE FROM inventory_audit WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [90],
    );
  });
});
