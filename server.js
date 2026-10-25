<<<<<<< HEAD
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
=======
import "dotenv/config";
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
>>>>>>> 1b2ef7a9fb65521862522c690155c670d19f0940

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDirectory = process.env.AUTOSUPPLY_UPLOAD_DIR || path.join(__dirname, 'uploads');

/** @type {import('express').Express} */
export const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 3001);

// One single source of truth for the DB settings (previously two different default names were used).
const DB_NAME = process.env.DB_NAME || "skyrun";
const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
};

export const pool = mysql.createPool({
  ...DB_CONFIG,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  // Return DATE columns as "YYYY-MM-DD" strings so timezone shifts can't change the day.
  dateStrings: ["DATE"],
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Express 4 does not catch rejected promises in async handlers; this forwards them to the error handler.
const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

async function storeItemImage(image, imageFileName) {
  if (typeof image !== 'string' || !image.startsWith('data:')) {
    return image || null;
  }

  const match = image.match(/^data:(image\/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new Error('The uploaded image format is not supported.');
  }

  const extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
  };
  const imageBuffer = Buffer.from(match[2], 'base64');
  if (imageBuffer.length > 5 * 1024 * 1024) {
    throw new Error('Please select an image smaller than 5 MB.');
  }

  const safeOriginalFilename = typeof imageFileName === 'string'
    ? imageFileName
      .split(/[\\/]/)
      .pop()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim()
      .slice(0, 120)
    : '';
  const filename = safeOriginalFilename
    ? `${crypto.randomUUID()}-${safeOriginalFilename}`
    : `${crypto.randomUUID()}.${extensions[match[1]]}`;
  await fs.mkdir(uploadsDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadsDirectory, filename), imageBuffer, { flag: 'wx' });
  return `/api/uploads/${encodeURIComponent(filename)}`;
}

const inventorySeed = [
  [
    "001",
    "Ceramic Brake Pads (Set)",
    "BRAKES",
    "4801234567890",
    25,
    2450,
    "A-01",
    "L2",
    "MEDIUM",
    "MEDIUM",
    "HIGH",
    "Toyota Vios 2014-2020, Honda City 2012-2019",
  ],
  [
    "002",
    "High Performance Rotors",
    "BRAKES",
    "4801234567891",
    12,
    4200,
    "B-04",
    "L1",
    "LARGE",
    "HEAVY",
    "MEDIUM",
    "Mitsubishi Lancer EX, Subaru WRX",
  ],
  [
    "003",
    "Synthetic Oil Filter",
    "ENGINE",
    "4801234567892",
    85,
    450,
    "A-02",
    "L4",
    "SMALL",
    "LIGHT",
    "HIGH",
    "Toyota Corolla Altis, Mitsubishi Mirage",
  ],
  [
    "004",
    "Iridium Spark Plugs",
    "ENGINE",
    "4801234567893",
    120,
    350,
    "A-03",
    "L4",
    "SMALL",
    "LIGHT",
    "HIGH",
    "Honda Civic, Suzuki Swift",
  ],
  [
    "005",
    "Gas-Charged Shock Absorber",
    "SUSPENSION",
    "4801234567894",
    18,
    3800,
    "B-02",
    "L2",
    "MEDIUM",
    "MEDIUM",
    "MEDIUM",
    "Hyundai Accent, Kia Rio",
  ],
  [
    "006",
    "Front Control Arm Left",
    "SUSPENSION",
    "4801234567895",
    6,
    5200,
    "B-01",
    "L1",
    "MEDIUM",
    "HEAVY",
    "LOW",
    "Nissan Almera, Mazda 3",
  ],
  [
    "007",
    "LED Headlight Bulb H4",
    "ELECTRICAL",
    "4801234567896",
    40,
    1200,
    "A-04",
    "L3",
    "SMALL",
    "LIGHT",
    "HIGH",
    "Universal H4 Sockets (Vios, Mirage, Wigo)",
  ],
  [
    "008",
    "120A High Output Alternator",
    "ELECTRICAL",
    "4801234567897",
    4,
    9500,
    "C-01",
    "L1",
    "MEDIUM",
    "HEAVY",
    "LOW",
    "Toyota Fortuner, Hilux D-4D",
  ],
  [
    "009",
    "Front Fender Panel",
    "BODY",
    "4801234567898",
    5,
    4500,
    "C-02",
    "L3",
    "LARGE",
    "MEDIUM",
    "LOW",
    "Honda Civic EF/EG/EK",
  ],
  [
    "010",
    "Rear Bumper Cover",
    "BODY",
    "4801234567899",
    3,
    6800,
    "D-03",
    "L1",
    "LARGE",
    "HEAVY",
    "LOW",
    "Toyota Wigo 2017-2022",
  ],
  [
    "011",
    "ATF Transmission Fluid",
    "TRANSMISSION",
    "4801234567900",
    60,
    850,
    "A-05",
    "L2",
    "MEDIUM",
    "MEDIUM",
    "HIGH",
    "Toyota, Honda, Mitsubishi Automatic Transmissions",
  ],
  [
    "012",
    "Heavy Duty Clutch Kit",
    "TRANSMISSION",
    "4801234567901",
    8,
    12500,
    "D-01",
    "L1",
    "LARGE",
    "HEAVY",
    "MEDIUM",
    "Mitsubishi Triton/L200, Isuzu D-Max",
  ],
];

const defaultUsers = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "staff", password: "staff123", role: "staff" },
];

const movementSeed = [
  ["MOV-1001", "004", "OUT", 45, "2026-08-10", "Warehouse Staff"],
  ["MOV-1002", "003", "OUT", 35, "2026-08-11", "Warehouse Staff"],
  ["MOV-1003", "001", "OUT", 28, "2026-08-12", "Warehouse Staff"],
];

/**
 * Portable replacement for "ADD COLUMN IF NOT EXISTS"
 * (that syntax only works on MariaDB, not on MySQL).
 */
async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column],
  );
  if (rows[0].count === 0) {
    await pool.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
    );
  }
}

async function initializeDatabase() {
  // Try to create the database. On shared hosting this is usually not permitted
  // (the DB already exists), so a failure here is only a warning.
  const adminPool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 2,
  });
  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    console.warn("Skipping CREATE DATABASE:", error.message);
  } finally {
    await adminPool.end();
  }

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
    image LONGTEXT,
    ordering_cost DECIMAL(12,2) NOT NULL DEFAULT 100,
    holding_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    lead_time_days INT NOT NULL DEFAULT 7,
    safety_stock INT NOT NULL DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
<<<<<<< HEAD
  await pool.query('ALTER TABLE inventory MODIFY COLUMN image LONGTEXT NULL');
  await pool.query('ALTER TABLE inventory ADD COLUMN IF NOT EXISTS ordering_cost DECIMAL(12,2) NOT NULL DEFAULT 100');
  await pool.query('ALTER TABLE inventory ADD COLUMN IF NOT EXISTS holding_cost DECIMAL(12,2) NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE inventory ADD COLUMN IF NOT EXISTS lead_time_days INT NOT NULL DEFAULT 7');
  await pool.query('ALTER TABLE inventory ADD COLUMN IF NOT EXISTS safety_stock INT NOT NULL DEFAULT 10');
  await pool.query('UPDATE inventory SET holding_cost = price * 0.2 WHERE holding_cost = 0');
=======
  await addColumnIfMissing(
    "inventory",
    "ordering_cost",
    "DECIMAL(12,2) NOT NULL DEFAULT 100",
  );
  await addColumnIfMissing(
    "inventory",
    "holding_cost",
    "DECIMAL(12,2) NOT NULL DEFAULT 0",
  );
  await addColumnIfMissing(
    "inventory",
    "lead_time_days",
    "INT NOT NULL DEFAULT 7",
  );
  await addColumnIfMissing(
    "inventory",
    "safety_stock",
    "INT NOT NULL DEFAULT 10",
  );

>>>>>>> 1b2ef7a9fb65521862522c690155c670d19f0940
  await pool.query(`CREATE TABLE IF NOT EXISTS inventory_audit (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(32) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    action ENUM('ADD', 'DELETE') NOT NULL,
    item_data JSON NULL,
    created_by VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumnIfMissing("inventory_audit", "item_data", "JSON NULL");
  await addColumnIfMissing("inventory_audit", "created_by", "VARCHAR(64) NULL");

  await pool.query(`CREATE TABLE IF NOT EXISTS movements (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(32) NOT NULL,
    type ENUM('IN', 'OUT') NOT NULL,
    qty INT NOT NULL,
    movement_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT movements_item_fk FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumnIfMissing(
    "movements",
    "created_by",
    "VARCHAR(64) NULL AFTER movement_date",
  );
  await pool.query(
    "UPDATE movements SET created_by = 'Warehouse Staff' WHERE created_by IS NULL",
  );

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    role ENUM('admin', 'staff') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // The login route selects display_name, but the column never existed.
  await addColumnIfMissing("users", "display_name", "VARCHAR(100) NULL");

  // ---- Seed data ----
  const [[userCount]] = await pool.query("SELECT COUNT(*) AS count FROM users");
  if (userCount.count === 0) {
    const userEntries = defaultUsers.map(({ username, password, role }) => [
      username,
      hashPassword(password),
      role,
    ]);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ?",
      [userEntries],
    );
  }

  const [[inventoryCount]] = await pool.query(
    "SELECT COUNT(*) AS count FROM inventory",
  );
  if (inventoryCount.count === 0) {
    await pool.query(
      `INSERT INTO inventory
        (id, name, category, barcode, quantity, price, rack, level, size, weight, demand, compatible_vehicles)
        VALUES ?`,
      [inventorySeed],
    );
  }

  const [[movementCount]] = await pool.query(
    "SELECT COUNT(*) AS count FROM movements",
  );
  if (movementCount.count === 0) {
    await pool.query(
      "INSERT INTO movements (id, item_id, type, qty, movement_date, created_by) VALUES ?",
      [movementSeed],
    );
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
    orderingCost: Number(row.ordering_cost || 100),
    holdingCost: Number(row.holding_cost || Number(row.price) * 0.2),
    leadTimeDays: Number(row.lead_time_days || 7),
    safetyStock: Number(row.safety_stock ?? 10),
  };
}

function toMovement(row) {
  const date =
    row.movement_date instanceof Date
      ? row.movement_date.toISOString().slice(0, 10)
      : String(row.movement_date).slice(0, 10);
  const timestamp = row.created_at
    ? new Date(row.created_at).getTime()
    : new Date(date).getTime();
  return {
    id: row.id,
    itemId: row.item_id,
    type: row.type,
    qty: Number(row.qty),
    date,
    timestamp,
    createdBy: row.created_by || undefined,
  };
}

function toInventoryAudit(row) {
  const created = new Date(row.created_at);
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    action: row.action,
    date: created.toISOString().slice(0, 10),
    timestamp: created.getTime(),
    createdBy: row.created_by || undefined,
  };
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function normalizeItemId(value) {
  const id = String(value ?? "").trim();
  return /^\d+$/.test(id) ? String(Number(id)).padStart(3, "0") : id;
}

const HISTORY_RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS || 90);

export async function purgeExpiredHistory() {
  const [result] = await pool.query(
    "DELETE FROM inventory_audit WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [HISTORY_RETENTION_DAYS],
  );
  return Number(result?.affectedRows || 0);
}

export function scheduleHistoryCleanup() {
  setInterval(
    () => {
      void purgeExpiredHistory().catch((error) => {
        console.error("Audit history cleanup failed:", error.message);
      });
    },
    60 * 60 * 1000,
  );
}

/* ------------------------------ Health ------------------------------ */

app.get(
  "/api/health",
  ah(async (_req, res) => {
    const connection = await pool.getConnection();
    connection.release();
    res.json({ ok: true, database: DB_NAME });
  }),
);

/* ------------------------------ Users ------------------------------- */

app.get(
  "/api/users",
  ah(async (_req, res) => {
    const [rows] = await pool.query(
      "SELECT id, username, role FROM users ORDER BY username",
    );
    res.json(rows);
  }),
);

app.post(
  "/api/users",
  ah(async (req, res) => {
    const { username, password, role } = req.body || {};

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required." });
    }

    const normalizedUsername = String(username).trim();
    const normalizedPassword = String(password).trim();
    const safeRole = role === "admin" ? "admin" : "staff";

    if (normalizedUsername.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters long." });
    }
    if (normalizedPassword.length < 4) {
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters long." });
    }

    const [[existing]] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE LOWER(username)=LOWER(?)",
      [normalizedUsername],
    );
    if (existing.count > 0) {
      return res.status(409).json({ error: "That username already exists." });
    }

<<<<<<< HEAD
  if (!rows || rows.length === 0) {
    return res.status(401).json({ error: 'Invalid login details.' });
  }

  const user = rows[0];
  res.json({
    username: user.username,
    role: user.role,
    email: user.email || '',
    phone: user.phone || '',
  });
});

app.get('/api/inventory', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM inventory ORDER BY id');
  res.json(rows.map(toItem));
});

app.post('/api/inventory', asyncRoute(async (req, res) => {
  const item = req.body;
  const itemId = normalizeItemId(item.id);
  const { imageFileName, ...itemData } = item;
  const savedItem = { ...itemData, id: itemId, image: await storeItemImage(item.image, imageFileName) || undefined };
  const createdBy = item.createdBy || 'Unknown';
  await pool.query(`INSERT INTO inventory
    (id, name, category, barcode, quantity, price, rack, level, size, weight, demand, compatible_vehicles, image, ordering_cost, holding_cost, lead_time_days, safety_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    itemId, savedItem.name, savedItem.category, savedItem.barcode || null, savedItem.quantity || 0, savedItem.price || 0,
    savedItem.rack, savedItem.level || null, savedItem.size || null, savedItem.weight || null, savedItem.demand || null,
    savedItem.compatibleVehicles || null, savedItem.image || null, savedItem.orderingCost ?? 100,
    savedItem.holdingCost > 0 ? savedItem.holdingCost : savedItem.price * 0.2, savedItem.leadTimeDays ?? 7, savedItem.safetyStock ?? 10,
  ]);
  await pool.query(
    'INSERT INTO inventory_audit (id, item_id, item_name, action, item_data, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [`AUDIT-ADD-${crypto.randomUUID()}`, itemId, savedItem.name, 'ADD', JSON.stringify(savedItem), createdBy],
  );
  res.status(201).json(savedItem);
}));

app.put('/api/inventory/:id', asyncRoute(async (req, res) => {
  const item = req.body;
  const itemId = normalizeItemId(req.params.id);
  const submittedItemId = normalizeItemId(item.id || itemId);
  const { imageFileName, ...itemData } = item;
  const savedItem = { ...itemData, id: submittedItemId, image: await storeItemImage(item.image, imageFileName) || undefined };
  await pool.query(`UPDATE inventory SET name=?, category=?, barcode=?, quantity=?, price=?, rack=?, level=?, size=?, weight=?, demand=?, compatible_vehicles=?, image=?, ordering_cost=?, holding_cost=?, lead_time_days=?, safety_stock=? WHERE id=?`, [
    savedItem.name, savedItem.category, savedItem.barcode || null, savedItem.quantity || 0, savedItem.price || 0, savedItem.rack,
    savedItem.level || null, savedItem.size || null, savedItem.weight || null, savedItem.demand || null,
    savedItem.compatibleVehicles || null, savedItem.image || null, savedItem.orderingCost ?? 100,
    savedItem.holdingCost > 0 ? savedItem.holdingCost : savedItem.price * 0.2, savedItem.leadTimeDays ?? 7, savedItem.safetyStock ?? 10, itemId,
  ]);
  res.json(savedItem);
}));

app.delete('/api/inventory/:id', async (req, res) => {
  const itemId = normalizeItemId(req.params.id);
  const createdBy = req.body?.createdBy || 'Unknown';
  const [[item]] = await pool.query('SELECT * FROM inventory WHERE id=?', [itemId]);
  await pool.query('DELETE FROM inventory WHERE id=?', [itemId]);
  if (item) {
=======
>>>>>>> 1b2ef7a9fb65521862522c690155c670d19f0940
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      [normalizedUsername, hashPassword(normalizedPassword), safeRole],
    );

    res.status(201).json({ ok: true, username: normalizedUsername });
  }),
);

// NOTE: these two fixed-path routes MUST be declared before "/api/users/:id",
// otherwise Express matches ":id" = "change-password" and returns a 400.
app.put(
  "/api/users/change-password",
  ah(async (req, res) => {
    const { username, currentPassword, newPassword } = req.body || {};

    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Username, current password, and new password are required.",
      });
    }

    const normalizedUsername = String(username).trim();
    const newPasswordString = String(newPassword).trim();

    if (newPasswordString.length < 4) {
      return res
        .status(400)
        .json({ error: "New password must be at least 4 characters long." });
    }

    const [rows] = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1",
      [normalizedUsername],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = rows[0];
    if (user.password_hash !== hashPassword(String(currentPassword))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    await pool.query("UPDATE users SET password_hash=? WHERE id=?", [
      hashPassword(newPasswordString),
      user.id,
    ]);
    res.json({ ok: true, username: user.username });
  }),
);

app.put(
  "/api/users/change-username",
  ah(async (req, res) => {
    const { currentUsername, currentPassword, newUsername } = req.body || {};

    if (!currentUsername || !currentPassword || !newUsername) {
      return res.status(400).json({
        error:
          "Current username, current password, and new username are required.",
      });
    }

    const normalizedCurrentUsername = String(currentUsername).trim();
    const normalizedNewUsername = String(newUsername).trim();

    if (normalizedNewUsername.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters long." });
    }

    const [existingRows] = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1",
      [normalizedCurrentUsername],
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = existingRows[0];
    if (user.password_hash !== hashPassword(String(currentPassword))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const [[duplicate]] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE LOWER(username)=LOWER(?) AND id != ?",
      [normalizedNewUsername, user.id],
    );
    if (duplicate.count > 0) {
      return res
        .status(409)
        .json({ error: "That username is already in use." });
    }

    await pool.query("UPDATE users SET username=? WHERE id=?", [
      normalizedNewUsername,
      user.id,
    ]);
    res.json({ ok: true, username: normalizedNewUsername });
  }),
);

app.put(
  "/api/users/:id",
  ah(async (req, res) => {
    const { username, password, role, actorUsername } = req.body || {};
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || !username || !actorUsername) {
      return res
        .status(400)
        .json({ error: "User ID, username, and admin account are required." });
    }

    const [[actor]] = await pool.query(
      "SELECT role FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1",
      [String(actorUsername).trim()],
    );
    if (!actor || actor.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Administrator access is required." });
    }

    const normalizedUsername = String(username).trim();
    if (normalizedUsername.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters long." });
    }
    if (
      password !== undefined &&
      String(password).trim().length > 0 &&
      String(password).trim().length < 4
    ) {
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters long." });
    }

    const [[targetUser]] = await pool.query(
      "SELECT role FROM users WHERE id=? LIMIT 1",
      [userId],
    );
    if (!targetUser) {
      return res.status(404).json({ error: "User not found." });
    }
    if (targetUser.role !== "staff") {
      return res
        .status(403)
        .json({ error: "Only staff accounts can be managed here." });
    }

    const [[existing]] = await pool.query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id != ? LIMIT 1",
      [normalizedUsername, userId],
    );
    if (existing) {
      return res
        .status(409)
        .json({ error: "That username is already in use." });
    }

    const updates = ["username=?", "role=?"];
    const values = [normalizedUsername, role === "admin" ? "admin" : "staff"];
    if (password !== undefined && String(password).trim()) {
      updates.push("password_hash=?");
      values.push(hashPassword(String(password).trim()));
    }
    values.push(userId);
    const [result] = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id=?`,
      values,
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ ok: true, username: normalizedUsername });
  }),
);

app.delete(
  "/api/users/:id",
  ah(async (req, res) => {
    const { actorUsername } = req.body || {};
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || !actorUsername) {
      return res
        .status(400)
        .json({ error: "User ID and admin account are required." });
    }

    const [[actor]] = await pool.query(
      "SELECT id, role FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1",
      [String(actorUsername).trim()],
    );
    if (!actor || actor.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Administrator access is required." });
    }
    if (actor.id === userId) {
      return res
        .status(400)
        .json({ error: "You cannot delete the active administrator account." });
    }

    const [[targetUser]] = await pool.query(
      "SELECT role FROM users WHERE id=? LIMIT 1",
      [userId],
    );
    if (!targetUser) {
      return res.status(404).json({ error: "User not found." });
    }
    if (targetUser.role !== "staff") {
      return res
        .status(403)
        .json({ error: "Only staff accounts can be managed here." });
    }

    const [result] = await pool.query("DELETE FROM users WHERE id=?", [userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ ok: true });
  }),
);

app.post(
  "/api/login",
  ah(async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required." });
    }

    const [rows] = await pool.query(
      `SELECT username, role, display_name
       FROM users
       WHERE LOWER(username) = LOWER(?)
         AND password_hash = ?
       LIMIT 1`,
      [String(username).trim(), hashPassword(String(password))],
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid login details." });
    }

    const user = rows[0];
    res.json({
      username: user.username,
      role: user.role,
      displayName: user.display_name || user.username,
      email: "",
      phone: "",
    });
  }),
);

<<<<<<< HEAD
app.use('/api/uploads', express.static(uploadsDirectory));
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
=======
/* ----------------------------- Inventory ---------------------------- */

const INVENTORY_COLUMNS =
  "id, name, category, barcode, quantity, price, rack, level, size, weight, demand, compatible_vehicles, image, ordering_cost, holding_cost, lead_time_days, safety_stock";

function inventoryValues(id, item) {
  const price = Number(item.price) || 0;
  return [
    id,
    item.name,
    item.category,
    item.barcode || null,
    item.quantity || 0,
    price,
    item.rack,
    item.level || null,
    item.size || null,
    item.weight || null,
    item.demand || null,
    item.compatibleVehicles || null,
    item.image || null,
    item.orderingCost ?? 100,
    item.holdingCost > 0 ? item.holdingCost : price * 0.2,
    item.leadTimeDays ?? 7,
    item.safetyStock ?? 10,
  ];
}

app.get(
  "/api/inventory",
  ah(async (_req, res) => {
    const [rows] = await pool.query("SELECT * FROM inventory ORDER BY id");
    res.json(rows.map(toItem));
  }),
);

app.post(
  "/api/inventory",
  ah(async (req, res) => {
    const item = req.body || {};
    if (!item.name || !item.category || !item.rack) {
      return res
        .status(400)
        .json({ error: "Name, category, and rack are required." });
    }
    const itemId = normalizeItemId(item.id);
    if (!itemId) {
      return res.status(400).json({ error: "Item ID is required." });
    }
    const createdBy = item.createdBy || "Unknown";

    await pool.query(
      `INSERT INTO inventory (${INVENTORY_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      inventoryValues(itemId, item),
    );
    await pool.query(
      "INSERT INTO inventory_audit (id, item_id, item_name, action, item_data, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [
        `AUDIT-ADD-${crypto.randomUUID()}`,
        itemId,
        item.name,
        "ADD",
        JSON.stringify({ ...item, id: itemId }),
        createdBy,
      ],
    );
    res.status(201).json({ ...item, id: itemId });
  }),
);

app.put(
  "/api/inventory/:id",
  ah(async (req, res) => {
    const item = req.body || {};
    const itemId = normalizeItemId(req.params.id);
    const submittedItemId = normalizeItemId(item.id || itemId);
    const values = inventoryValues(itemId, item).slice(1); // drop id; it goes in WHERE
    const [result] = await pool.query(
      `UPDATE inventory SET name=?, category=?, barcode=?, quantity=?, price=?, rack=?, level=?, size=?, weight=?, demand=?, compatible_vehicles=?, image=?, ordering_cost=?, holding_cost=?, lead_time_days=?, safety_stock=? WHERE id=?`,
      [...values, itemId],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item not found." });
    }
    res.json({ ...item, id: submittedItemId });
  }),
);

app.delete(
  "/api/inventory/:id",
  ah(async (req, res) => {
    const itemId = normalizeItemId(req.params.id);
    const createdBy = req.body?.createdBy || "Unknown";
    const [[item]] = await pool.query("SELECT * FROM inventory WHERE id=?", [
      itemId,
    ]);
    if (!item) {
      return res.status(404).json({ error: "Item not found." });
    }
    await pool.query("DELETE FROM inventory WHERE id=?", [itemId]);
    await pool.query(
      "INSERT INTO inventory_audit (id, item_id, item_name, action, item_data, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [
        `AUDIT-DELETE-${crypto.randomUUID()}`,
        itemId,
        item.name,
        "DELETE",
        JSON.stringify(toItem(item)),
        createdBy,
      ],
    );
    res.status(204).end();
  }),
);

app.get(
  "/api/inventory-audit",
  ah(async (_req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM inventory_audit ORDER BY created_at DESC",
    );
    res.json(rows.map(toInventoryAudit));
  }),
);

app.patch(
  "/api/inventory-audit/:id/undo",
  ah(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[audit]] = await connection.query(
        "SELECT * FROM inventory_audit WHERE id=? FOR UPDATE",
        [req.params.id],
      );
      if (!audit) {
        await connection.rollback();
        return res.status(404).json({ error: "Audit entry not found." });
      }
      if (!audit.item_data && audit.action === "DELETE") {
        await connection.rollback();
        return res.status(400).json({
          error:
            "This audit entry cannot be undone because its item snapshot is unavailable.",
        });
      }

      if (audit.action === "ADD") {
        await connection.query("DELETE FROM inventory WHERE id=?", [
          audit.item_id,
        ]);
      } else {
        const item =
          typeof audit.item_data === "string"
            ? JSON.parse(audit.item_data)
            : audit.item_data;
        await connection.query(
          `INSERT INTO inventory (${INVENTORY_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          inventoryValues(audit.item_id, item),
        );
      }
      await connection.query("DELETE FROM inventory_audit WHERE id=?", [
        req.params.id,
      ]);
      await connection.commit();
      res.json({ ok: true, action: audit.action });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

/* ----------------------------- Movements ---------------------------- */

app.get(
  "/api/movements",
  ah(async (_req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM movements ORDER BY movement_date DESC, created_at DESC",
    );
    res.json(rows.map(toMovement));
  }),
);

app.post(
  "/api/movements",
  ah(async (req, res) => {
    const movement = req.body || {};
    const qty = Number(movement.qty);
    const itemId = normalizeItemId(movement.itemId);

    if (!itemId || !["IN", "OUT"].includes(movement.type)) {
      return res
        .status(400)
        .json({
          error: "A valid item and movement type (IN/OUT) are required.",
        });
    }
    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ error: "Quantity must be a positive whole number." });
    }

    const id = movement.id || `MOV-${crypto.randomUUID()}`;
    const date = movement.date || new Date().toISOString().slice(0, 10);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [[item]] = await connection.query(
        "SELECT quantity FROM inventory WHERE id=? FOR UPDATE",
        [itemId],
      );
      if (!item) {
        await connection.rollback();
        return res.status(404).json({ error: "Item not found." });
      }
      if (movement.type === "OUT" && qty > item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          error: `Insufficient stock. Only ${item.quantity} unit(s) available.`,
        });
      }

      const delta = movement.type === "IN" ? qty : -qty;
      await connection.query(
        "INSERT INTO movements (id, item_id, type, qty, movement_date, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [id, itemId, movement.type, qty, date, movement.createdBy || null],
      );
      await connection.query(
        "UPDATE inventory SET quantity = GREATEST(0, quantity + ?) WHERE id=?",
        [delta, itemId],
      );
      await connection.commit();
      res
        .status(201)
        .json({ ...movement, id, itemId, qty, date, timestamp: Date.now() });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.delete(
  "/api/movements/:id",
  ah(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[movement]] = await connection.query(
        "SELECT * FROM movements WHERE id=? FOR UPDATE",
        [req.params.id],
      );
      if (!movement) {
        await connection.rollback(); // was missing: left the transaction open
        return res.status(404).json({ error: "Movement not found" });
      }
      const delta = movement.type === "IN" ? -movement.qty : movement.qty;
      await connection.query("DELETE FROM movements WHERE id=?", [
        req.params.id,
      ]);
      await connection.query(
        "UPDATE inventory SET quantity = GREATEST(0, quantity + ?) WHERE id=?",
        [delta, movement.item_id],
      );
      await connection.commit();
      res.status(204).end();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.patch(
  "/api/movements/:id/undo",
  ah(async (req, res) => {
    const requestedQty = Number(req.body?.qty);
    if (!Number.isInteger(requestedQty) || requestedQty < 1) {
      return res
        .status(400)
        .json({ error: "Undo quantity must be a positive whole number." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[movement]] = await connection.query(
        "SELECT * FROM movements WHERE id=? FOR UPDATE",
        [req.params.id],
      );
      if (!movement) {
        await connection.rollback();
        return res.status(404).json({ error: "Movement not found" });
      }
      if (requestedQty > movement.qty) {
        await connection.rollback();
        return res
          .status(400)
          .json({
            error: "Undo quantity cannot exceed the movement quantity.",
          });
      }

      const delta = movement.type === "IN" ? -requestedQty : requestedQty;
      const remainingQty = movement.qty - requestedQty;
      if (remainingQty === 0) {
        await connection.query("DELETE FROM movements WHERE id=?", [
          req.params.id,
        ]);
      } else {
        await connection.query("UPDATE movements SET qty=? WHERE id=?", [
          remainingQty,
          req.params.id,
        ]);
      }
      await connection.query(
        "UPDATE inventory SET quantity = GREATEST(0, quantity + ?) WHERE id=?",
        [delta, movement.item_id],
      );
      await connection.commit();

      if (remainingQty === 0) {
        return res.json({ deleted: true });
      }
      res.json({
        deleted: false,
        movement: toMovement({ ...movement, qty: remainingQty }),
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

/* ------------------------ Static files & errors --------------------- */

app.use(express.static(path.join(__dirname, "dist")));
// Regex works on Express 4 and 5, and unknown /api routes get a JSON 404 instead of index.html.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
>>>>>>> 1b2ef7a9fb65521862522c690155c670d19f0940
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === "ER_DUP_ENTRY") {
    return res
      .status(409)
      .json({ error: "A record with that ID already exists." });
  }
  if (error?.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({ error: "Referenced item does not exist." });
  }
  res.status(500).json({ error: "Database request failed" });
});

export async function startServer() {
  await initializeDatabase();
  void purgeExpiredHistory().catch((error) => {
    console.error("Initial audit history cleanup failed:", error.message);
  });
  scheduleHistoryCleanup();
  app.listen(port, () =>
    console.log(`API listening on http://localhost:${port}`),
  );
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer().catch((error) => {
    console.error("Database initialization failed:", error.message);
    process.exit(1);
  });
}
