import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const app = express();
const port = Number(process.env.API_PORT || 3001);
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'skyrun',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
});

app.use(cors());
app.use(express.json());

const inventorySeed = [
  ['STK-001', 'Ceramic Brake Pads (Set)', 'BRAKES', '4801234567890', 25, 2450, 'A-01', 'L2', 'MEDIUM', 'MEDIUM', 'HIGH', 'Toyota Vios 2014-2020, Honda City 2012-2019'],
  ['STK-002', 'High Performance Rotors', 'BRAKES', '4801234567891', 12, 4200, 'B-04', 'L1', 'LARGE', 'HEAVY', 'MEDIUM', 'Mitsubishi Lancer EX, Subaru WRX'],
  ['STK-003', 'Synthetic Oil Filter', 'ENGINE', '4801234567892', 85, 450, 'A-02', 'L4', 'SMALL', 'LIGHT', 'HIGH', 'Toyota Corolla Altis, Mitsubishi Mirage'],
  ['STK-004', 'Iridium Spark Plugs', 'ENGINE', '4801234567893', 120, 350, 'A-03', 'L4', 'SMALL', 'LIGHT', 'HIGH', 'Honda Civic, Suzuki Swift'],
  ['STK-005', 'Gas-Charged Shock Absorber', 'SUSPENSION', '4801234567894', 18, 3800, 'B-02', 'L2', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'Hyundai Accent, Kia Rio'],
  ['STK-006', 'Front Control Arm Left', 'SUSPENSION', '4801234567895', 6, 5200, 'B-01', 'L1', 'MEDIUM', 'HEAVY', 'LOW', 'Nissan Almera, Mazda 3'],
  ['STK-007', 'LED Headlight Bulb H4', 'ELECTRICAL', '4801234567896', 40, 1200, 'A-04', 'L3', 'SMALL', 'LIGHT', 'HIGH', 'Universal H4 Sockets (Vios, Mirage, Wigo)'],
  ['STK-008', '120A High Output Alternator', 'ELECTRICAL', '4801234567897', 4, 9500, 'C-01', 'L1', 'MEDIUM', 'HEAVY', 'LOW', 'Toyota Fortuner, Hilux D-4D'],
  ['STK-009', 'Front Fender Panel', 'BODY', '4801234567898', 5, 4500, 'C-02', 'L3', 'LARGE', 'MEDIUM', 'LOW', 'Honda Civic EF/EG/EK'],
  ['STK-010', 'Rear Bumper Cover', 'BODY', '4801234567899', 3, 6800, 'D-03', 'L1', 'LARGE', 'HEAVY', 'LOW', 'Toyota Wigo 2017-2022'],
  ['STK-011', 'ATF Transmission Fluid', 'TRANSMISSION', '4801234567900', 60, 850, 'A-05', 'L2', 'MEDIUM', 'MEDIUM', 'HIGH', 'Toyota, Honda, Mitsubishi Automatic Transmissions'],
  ['STK-012', 'Heavy Duty Clutch Kit', 'TRANSMISSION', '4801234567901', 8, 12500, 'D-01', 'L1', 'LARGE', 'HEAVY', 'MEDIUM', 'Mitsubishi Triton/L200, Isuzu D-Max'],
];

const defaultUsers = [
  ['admin', 'admin123', 'admin'],
  ['staff', 'staff123', 'staff'],
];

const movementSeed = [
  ['MOV-1001', 'STK-004', 'OUT', 45, '2026-08-10'],
  ['MOV-1002', 'STK-003', 'OUT', 35, '2026-08-11'],
  ['MOV-1003', 'STK-001', 'OUT', 28, '2026-08-12'],
];

async function initializeDatabase() {
  const adminPool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 2,
  });
  await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'skyrun'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await adminPool.end();

  await pool.query(`CREATE TABLE IF NOT EXISTS inventory (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    barcode VARCHAR(64),
    quantity INT NOT NULL DEFAULT 0,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    rack VARCHAR(32) NOT NULL,
    level VARCHAR(16),
    size VARCHAR(16),
    weight VARCHAR(16),
    demand VARCHAR(16),
    compatible_vehicles TEXT,
    image TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS movements (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(32) NOT NULL,
    type ENUM('IN', 'OUT') NOT NULL,
    qty INT NOT NULL,
    movement_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT movements_item_fk FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    role ENUM('admin', 'staff') NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[userCount]] = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (userCount.count === 0) {
    const userEntries = defaultUsers.map(([username, password, role]) => [
      username,
      crypto.createHash('sha256').update(password).digest('hex'),
      role,
      role === 'admin' ? 'Administrator' : 'Warehouse Staff',
    ]);
    await pool.query('INSERT INTO users (username, password_hash, role, display_name) VALUES ?', [userEntries]);
  }

  const [[inventoryCount]] = await pool.query('SELECT COUNT(*) AS count FROM inventory');
  if (inventoryCount.count === 0) {
    await pool.query(`INSERT INTO inventory
      (id, name, category, barcode, quantity, price, rack, level, size, weight, demand, compatible_vehicles)
      VALUES ?`, [inventorySeed]);
  }
  const [[movementCount]] = await pool.query('SELECT COUNT(*) AS count FROM movements');
  if (movementCount.count === 0) {
    await pool.query('INSERT INTO movements (id, item_id, type, qty, movement_date) VALUES ?', [movementSeed]);
  }
}

function toItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    barcode: row.barcode || undefined,
    quantity: Number(row.quantity),
    price: Number(row.price),
    rack: row.rack,
    level: row.level || undefined,
    size: row.size || undefined,
    weight: row.weight || undefined,
    demand: row.demand || undefined,
    compatibleVehicles: row.compatible_vehicles || undefined,
    image: row.image || undefined,
  };
}

function toMovement(row) {
  const date = row.movement_date instanceof Date
    ? row.movement_date.toISOString().slice(0, 10)
    : String(row.movement_date).slice(0, 10);
  return { id: row.id, itemId: row.item_id, type: row.type, qty: Number(row.qty), date, timestamp: new Date(date).getTime() };
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

app.get('/api/health', async (_req, res) => {
  const connection = await pool.getConnection();
  connection.release();
  res.json({ ok: true, database: process.env.DB_NAME || 'skyrun' });
});

app.get('/api/users', async (_req, res) => {
  const [rows] = await pool.query('SELECT id, username, role, display_name FROM users ORDER BY username');
  res.json(rows);
});

app.put('/api/users/change-password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body || {};

  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Username, current password, and new password are required.' });
  }

  const normalizedUsername = String(username).trim();
  const newPasswordString = String(newPassword).trim();

  if (newPasswordString.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
  }

  const [rows] = await pool.query('SELECT id, username, password_hash FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1', [normalizedUsername]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const user = rows[0];
  if (user.password_hash !== hashPassword(String(currentPassword))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  await pool.query('UPDATE users SET password_hash=? WHERE id=?', [hashPassword(newPasswordString), user.id]);
  res.json({ ok: true, username: user.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const normalizedUsername = String(username).trim();
  const [rows] = await pool.query('SELECT username, role, display_name FROM users WHERE LOWER(username)=LOWER(?) AND password_hash=? LIMIT 1', [normalizedUsername, hashPassword(String(password))]);

  if (rows.length === 0) {
    return res.status(401).json({ error: 'Invalid login details.' });
  }

  const user = rows[0];
  res.json({
    username: user.username,
    role: user.role,
    displayName: user.display_name,
  });
});

app.get('/api/inventory', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM inventory ORDER BY id');
  res.json(rows.map(toItem));
});

app.post('/api/inventory', async (req, res) => {
  const item = req.body;
  await pool.query(`INSERT INTO inventory
    (id, name, category, barcode, quantity, price, rack, level, size, weight, demand, compatible_vehicles, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    item.id, item.name, item.category, item.barcode || null, item.quantity || 0, item.price || 0,
    item.rack, item.level || null, item.size || null, item.weight || null, item.demand || null,
    item.compatibleVehicles || null, item.image || null,
  ]);
  res.status(201).json(item);
});

app.put('/api/inventory/:id', async (req, res) => {
  const item = req.body;
  await pool.query(`UPDATE inventory SET name=?, category=?, barcode=?, quantity=?, price=?, rack=?, level=?, size=?, weight=?, demand=?, compatible_vehicles=?, image=? WHERE id=?`, [
    item.name, item.category, item.barcode || null, item.quantity || 0, item.price || 0, item.rack,
    item.level || null, item.size || null, item.weight || null, item.demand || null,
    item.compatibleVehicles || null, item.image || null, req.params.id,
  ]);
  res.json({ ...item, id: req.params.id });
});

app.delete('/api/inventory/:id', async (req, res) => {
  await pool.query('DELETE FROM inventory WHERE id=?', [req.params.id]);
  res.status(204).end();
});

app.get('/api/movements', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM movements ORDER BY movement_date DESC, created_at DESC');
  res.json(rows.map(toMovement));
});

app.post('/api/movements', async (req, res) => {
  const movement = req.body;
  const id = movement.id || `MOV-${crypto.randomUUID()}`;
  const date = movement.date || new Date().toISOString().slice(0, 10);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const delta = movement.type === 'IN' ? movement.qty : -movement.qty;
    await connection.query('INSERT INTO movements (id, item_id, type, qty, movement_date) VALUES (?, ?, ?, ?, ?)', [id, movement.itemId, movement.type, movement.qty, date]);
    await connection.query('UPDATE inventory SET quantity = GREATEST(0, quantity + ?) WHERE id=?', [delta, movement.itemId]);
    await connection.commit();
    res.status(201).json({ ...movement, id, date, timestamp: new Date(date).getTime() });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.delete('/api/movements/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[movement]] = await connection.query('SELECT * FROM movements WHERE id=? FOR UPDATE', [req.params.id]);
    if (!movement) return res.status(404).json({ error: 'Movement not found' });
    const delta = movement.type === 'IN' ? -movement.qty : movement.qty;
    await connection.query('DELETE FROM movements WHERE id=?', [req.params.id]);
    await connection.query('UPDATE inventory SET quantity = GREATEST(0, quantity + ?) WHERE id=?', [delta, movement.item_id]);
    await connection.commit();
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Database request failed' });
});

initializeDatabase()
  .then(() => app.listen(port, () => console.log(`API listening on http://localhost:${port}`)))
  .catch((error) => {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  });
