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

const { app } = await import('./server.js');

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
});
