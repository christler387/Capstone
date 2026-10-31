import "dotenv/config";
import express from "express";
import cors from "cors";
import { SMTPClient } from "emailjs";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDirectory =
  process.env.AUTOSUPPLY_UPLOAD_DIR || path.join(__dirname, "uploads");

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
const passwordResetCodes = new Map();
const passwordResetRateLimits = new Map();
const PASSWORD_RESET_CODE_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_SECONDS = 5 * 60;
const PASSWORD_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_CODE_WINDOW_MS = 10 * 60 * 1000;

function getPasswordResetSecret() {
  const secret = process.env.JWT_RESET_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    return null;
  }
  return secret;
}

function getPasswordResetMailClient() {
  const { SMTP_HOST, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_FROM) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number.");
  }
  if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }

  const ssl = process.env.SMTP_SECURE === "true" || port === 465;
  return new SMTPClient({
    host: SMTP_HOST,
    port,
    ssl,
    tls: !ssl,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
  });
}

function hashPasswordResetCode(code, secret) {
  return crypto.createHmac("sha256", secret).update(code).digest();
}

function isPasswordResetRateLimited(req, action, limit, windowMs) {
  const key = `${action}:${req.ip || "unknown"}`;
  const now = Date.now();
  const recent = (passwordResetRateLimits.get(key) || []).filter(
    (timestamp) => timestamp > now - windowMs,
  );
  if (recent.length >= limit) {
    passwordResetRateLimits.set(key, recent);
    return true;
  }

  recent.push(now);
  passwordResetRateLimits.set(key, recent);
  if (passwordResetRateLimits.size > 5000) {
    for (const [storedKey, timestamps] of passwordResetRateLimits) {
      if (!timestamps.some((timestamp) => timestamp > now - windowMs)) {
        passwordResetRateLimits.delete(storedKey);
      }
    }
  }
  return false;
}

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

const userSessions = new Map();
const USER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function readSessionToken(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("autosupply_session="));
  return cookie ? cookie.slice("autosupply_session=".length) : null;
}

async function getAuthenticatedUser(req) {
  const token = readSessionToken(req);
  const session = token ? userSessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    userSessions.delete(token);
    return null;
  }

  const [[user]] = await pool.query(
    "SELECT id, username, role FROM users WHERE id=? LIMIT 1",
    [session.userId],
  );
  if (!user) userSessions.delete(token);
  return user || null;
}

function setUserSession(req, res, userId) {
  const now = Date.now();
  for (const [token, session] of userSessions) {
    if (session.expiresAt <= now) userSessions.delete(token);
  }

  const token = crypto.randomBytes(32).toString("hex");
  userSessions.set(token, {
    userId,
    expiresAt: now + USER_SESSION_TTL_MS,
  });
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `autosupply_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(USER_SESSION_TTL_MS / 1000)}${secure}`,
  );
}

function clearUserSession(req, res) {
  const token = readSessionToken(req);
  if (token) userSessions.delete(token);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `autosupply_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  );
}

// Saves a base64 image sent by the item form to the uploads folder and returns its URL.
async function storeItemImage(image, imageFileName) {
  if (typeof image !== "string" || !image.startsWith("data:")) {
    return image || null;
  }

  const match = image.match(
    /^data:(image\/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match) {
    throw new Error("The uploaded image format is not supported.");
  }

  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/avif": "avif",
  };
  const imageBuffer = Buffer.from(match[2], "base64");
  if (imageBuffer.length > 5 * 1024 * 1024) {
    throw new Error("Please select an image smaller than 5 MB.");
  }

  const safeOriginalFilename =
    typeof imageFileName === "string"
      ? imageFileName
          .split(/[\\/]/)
          .pop()
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
          .trim()
          .slice(0, 120)
      : "";
  const filename = safeOriginalFilename
    ? `${crypto.randomUUID()}-${safeOriginalFilename}`
    : `${crypto.randomUUID()}.${extensions[match[1]]}`;
  await fs.mkdir(uploadsDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadsDirectory, filename), imageBuffer, {
    flag: "wx",
  });
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
  // Existing databases may still have a TEXT image column, which is too small for uploaded images.
  await pool.query("ALTER TABLE inventory MODIFY COLUMN image LONGTEXT NULL");

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
    email VARCHAR(254) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // The login route selects display_name, but the column never existed.
  await addColumnIfMissing("users", "display_name", "VARCHAR(100) NULL");
  await addColumnIfMissing("users", "email", "VARCHAR(254) NULL");
  await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    jwt_id CHAR(36) PRIMARY KEY,
    expires_at DATETIME NOT NULL,
    INDEX password_reset_tokens_expiry_idx (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Warehouse layout: floors, aisles and racks. inventory.rack keeps the "A-01" style code.
  await pool.query(`CREATE TABLE IF NOT EXISTS floors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS aisles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    floor_id INT NOT NULL,
    code VARCHAR(8) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL,
    color VARCHAR(16) NOT NULL DEFAULT '#64748b',
    orientation ENUM('portrait', 'landscape') NOT NULL DEFAULT 'portrait',
    grid_col INT NOT NULL,
    grid_row INT NOT NULL,
    UNIQUE KEY uq_aisle_position (floor_id, grid_col, grid_row),
    CONSTRAINT fk_aisles_floor FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS racks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    aisle_id INT NOT NULL,
    rack_number INT NOT NULL,
    capacity INT NULL,
    UNIQUE KEY uq_rack_number (aisle_id, rack_number),
    CONSTRAINT fk_racks_aisle FOREIGN KEY (aisle_id) REFERENCES aisles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await seedWarehouseLayout();
  await repairOldSeedPositions();

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
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor || actor.role !== "admin") {
      return res
        .status(actor ? 403 : 401)
        .json({ error: "Administrator access is required." });
    }
    const [rows] = await pool.query(
      "SELECT id, username, role, email FROM users ORDER BY username",
    );
    res.json(rows);
  }),
);

app.post(
  "/api/users",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor || actor.role !== "admin") {
      return res
        .status(actor ? 403 : 401)
        .json({ error: "Administrator access is required." });
    }

    const { username, password, role, email } = req.body || {};

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

    const emailValue = String(email || "").trim();
    const normalizedEmail = emailValue ? emailValue.toLowerCase() : null;
    if (
      normalizedEmail &&
      (normalizedEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
    ) {
      return res.status(400).json({ error: "Enter a valid recovery email." });
    }

    const [[existing]] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE LOWER(username)=LOWER(?)",
      [normalizedUsername],
    );
    if (existing.count > 0) {
      return res.status(409).json({ error: "That username already exists." });
    }

    await pool.query(
      "INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)",
      [
        normalizedUsername,
        hashPassword(normalizedPassword),
        safeRole,
        normalizedEmail,
      ],
    );

    res.status(201).json({ ok: true, username: normalizedUsername });
  }),
);

// Fixed-path user routes must be declared before "/api/users/:id".
app.put(
  "/api/users/recovery-email",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor) {
      return res.status(401).json({ error: "Sign in to update your recovery email." });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!currentPassword || !email) {
      return res.status(400).json({
        error: "Current password and recovery email are required.",
      });
    }
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({ error: "Enter a valid recovery email." });
    }

    const [[account]] = await pool.query(
      "SELECT id, password_hash FROM users WHERE id=? LIMIT 1",
      [actor.id],
    );
    if (!account || account.password_hash !== hashPassword(currentPassword)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    await pool.query("UPDATE users SET email=? WHERE id=?", [email, actor.id]);
    passwordResetCodes.delete(actor.id);
    res.json({ ok: true });
  }),
);

app.put(
  "/api/users/change-password",
  ah(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const actor = await getAuthenticatedUser(req);

    if (!actor) {
      return res.status(401).json({ error: "Sign in to change your password." });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Current password and new password are required.",
      });
    }

    const newPasswordString = String(newPassword).trim();

    if (newPasswordString.length < 4) {
      return res
        .status(400)
        .json({ error: "New password must be at least 4 characters long." });
    }

    const [rows] = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE id=? LIMIT 1",
      [actor.id],
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
    const { currentPassword, newUsername } = req.body || {};
    const actor = await getAuthenticatedUser(req);

    if (!actor) {
      return res.status(401).json({ error: "Sign in to change your username." });
    }
    if (!currentPassword || !newUsername) {
      return res.status(400).json({
        error: "Current password and new username are required.",
      });
    }

    const normalizedNewUsername = String(newUsername).trim();

    if (normalizedNewUsername.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters long." });
    }

    const [existingRows] = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE id=? LIMIT 1",
      [actor.id],
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
    const { username, password, role, email } = req.body || {};
    const userId = Number(req.params.id);
    const actor = await getAuthenticatedUser(req);

    if (!Number.isInteger(userId) || !username) {
      return res
        .status(400)
        .json({ error: "User ID and username are required." });
    }
    if (!actor || actor.role !== "admin") {
      return res
        .status(actor ? 403 : 401)
        .json({ error: "Administrator access is required." });
    }

    const normalizedUsername = String(username).trim();
    const normalizedRole = role === "admin" || role === "staff" ? role : null;
    if (normalizedUsername.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters long." });
    }
    if (!normalizedRole) {
      return res.status(400).json({ error: "A valid account role is required." });
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

    const emailValue = String(email || "").trim();
    const normalizedEmail = emailValue ? emailValue.toLowerCase() : null;
    if (
      email !== undefined &&
      normalizedEmail &&
      (normalizedEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
    ) {
      return res.status(400).json({ error: "Enter a valid recovery email." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [adminRows] = await connection.query(
        "SELECT id FROM users WHERE role='admin' FOR UPDATE",
      );
      const [[targetUser]] = await connection.query(
        "SELECT id, role FROM users WHERE id=? LIMIT 1 FOR UPDATE",
        [userId],
      );
      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({ error: "User not found." });
      }

      const [[currentActor]] = await connection.query(
        "SELECT role FROM users WHERE id=? LIMIT 1",
        [actor.id],
      );
      if (!currentActor || currentActor.role !== "admin") {
        await connection.rollback();
        return res
          .status(403)
          .json({ error: "Administrator access is required." });
      }
      if (targetUser.id === actor.id) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: "You cannot manage your own account here." });
      }
      if (
        targetUser.role === "admin" &&
        normalizedRole !== "admin" &&
        adminRows.length <= 1
      ) {
        await connection.rollback();
        return res.status(400).json({
          error: "You cannot demote the last administrator account.",
        });
      }

      const [[existing]] = await connection.query(
        "SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id != ? LIMIT 1",
        [normalizedUsername, userId],
      );
      if (existing) {
        await connection.rollback();
        return res
          .status(409)
          .json({ error: "That username is already in use." });
      }

      const updates = ["username=?", "role=?"];
      const values = [normalizedUsername, normalizedRole];
      if (email !== undefined) {
        updates.push("email=?");
        values.push(normalizedEmail);
      }
      if (password !== undefined && String(password).trim()) {
        updates.push("password_hash=?");
        values.push(hashPassword(String(password).trim()));
      }
      values.push(userId);
      await connection.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id=?`,
        values,
      );
      await connection.commit();
      if (email !== undefined || (password !== undefined && String(password).trim())) {
        passwordResetCodes.delete(userId);
      }
      if (password !== undefined && String(password).trim()) {
        for (const [token, session] of userSessions) {
          if (session.userId === userId) userSessions.delete(token);
        }
      }
      res.json({ ok: true, username: normalizedUsername });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.delete(
  "/api/users/:id",
  ah(async (req, res) => {
    const userId = Number(req.params.id);
    const actor = await getAuthenticatedUser(req);
    if (!Number.isInteger(userId)) {
      return res
        .status(400)
        .json({ error: "A valid user ID is required." });
    }
    if (!actor || actor.role !== "admin") {
      return res
        .status(actor ? 403 : 401)
        .json({ error: "Administrator access is required." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [adminRows] = await connection.query(
        "SELECT id FROM users WHERE role='admin' FOR UPDATE",
      );
      const [[targetUser]] = await connection.query(
        "SELECT id, role FROM users WHERE id=? LIMIT 1 FOR UPDATE",
        [userId],
      );
      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({ error: "User not found." });
      }

      const [[currentActor]] = await connection.query(
        "SELECT role FROM users WHERE id=? LIMIT 1",
        [actor.id],
      );
      if (!currentActor || currentActor.role !== "admin") {
        await connection.rollback();
        return res
          .status(403)
          .json({ error: "Administrator access is required." });
      }
      if (actor.id === userId) {
        await connection.rollback();
        return res.status(400).json({ error: "You cannot delete your own account." });
      }
      if (targetUser.role === "admin" && adminRows.length <= 1) {
        await connection.rollback();
        return res.status(400).json({
          error: "You cannot delete the last administrator account.",
        });
      }

      await connection.query("DELETE FROM users WHERE id=?", [userId]);
      await connection.commit();
      for (const [token, session] of userSessions) {
        if (session.userId === userId) userSessions.delete(token);
      }
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.post(
  "/api/password-reset/request",
  ah(async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!username || !email || username.length > 64 || email.length > 254) {
      return res.status(400).json({ error: "Enter your username and recovery email." });
    }

    if (
      isPasswordResetRateLimited(
        req,
        "request",
        3,
        PASSWORD_RESET_REQUEST_WINDOW_MS,
      )
    ) {
      return res.status(429).json({
        error: "Too many recovery requests. Please try again later.",
      });
    }

    const secret = getPasswordResetSecret();
    if (!secret) {
      return res.status(503).json({
        error: "Password recovery is not configured. Contact your administrator.",
      });
    }

    let mailClient;
    try {
      mailClient = getPasswordResetMailClient();
    } catch (error) {
      console.error("Password recovery SMTP configuration is invalid:", error);
      return res.status(503).json({
        error: "Password recovery email is misconfigured. Contact your administrator.",
      });
    }
    if (!mailClient) {
      return res.status(503).json({
        error: "Password recovery email is not configured. Contact your administrator.",
      });
    }

    const [[account]] = await pool.query(
      `SELECT id, username, email FROM users
       WHERE LOWER(username)=LOWER(?) AND LOWER(email)=LOWER(?)
       LIMIT 1`,
      [username, email],
    );

    if (account) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      passwordResetCodes.delete(account.id);
      let emailSent = true;
      try {
        await mailClient.sendAsync({
          from: process.env.SMTP_FROM,
          to: account.email,
          subject: "Your AutoSupply password reset code",
          text: `Your password reset code is ${code}. It expires in 10 minutes. If you did not request a password reset, ignore this email.`,
        });
      } catch (error) {
        emailSent = false;
        console.error("Password recovery email delivery failed:", error);
      } finally {
        mailClient.smtp.close();
      }

      if (emailSent) {
        passwordResetCodes.set(account.id, {
          codeHash: hashPasswordResetCode(code, secret),
          expiresAt: Date.now() + PASSWORD_RESET_CODE_TTL_MS,
          attempts: 0,
        });
      }
    } else {
      mailClient.smtp.close();
    }

    res.json({
      message:
        "If the username and recovery email match an account, a verification code has been sent.",
    });
  }),
);

app.post(
  "/api/password-reset/verify-code",
  ah(async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!username || !email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter your username, email, and 6-digit code." });
    }

    if (
      isPasswordResetRateLimited(
        req,
        "verify",
        10,
        PASSWORD_RESET_CODE_WINDOW_MS,
      )
    ) {
      return res.status(429).json({
        error: "Too many code attempts. Request a new code and try again.",
      });
    }

    const secret = getPasswordResetSecret();
    if (!secret) {
      return res.status(503).json({
        error: "Password recovery is not configured. Contact your administrator.",
      });
    }

    const [[account]] = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(username)=LOWER(?) AND LOWER(email)=LOWER(?)
       LIMIT 1`,
      [username, email],
    );
    const resetCode = account ? passwordResetCodes.get(account.id) : null;
    if (
      !resetCode ||
      resetCode.expiresAt <= Date.now() ||
      resetCode.attempts >= 5
    ) {
      if (account) passwordResetCodes.delete(account.id);
      return res.status(400).json({
        error: "The code is invalid or expired. Request a new code.",
      });
    }

    resetCode.attempts += 1;
    const submittedHash = hashPasswordResetCode(code, secret);
    if (!crypto.timingSafeEqual(resetCode.codeHash, submittedHash)) {
      if (resetCode.attempts >= 5) passwordResetCodes.delete(account.id);
      return res.status(400).json({
        error: "The code is invalid or expired. Request a new code.",
      });
    }
    passwordResetCodes.delete(account.id);

    const resetToken = jwt.sign(
      { purpose: "password_reset" },
      secret,
      {
        algorithm: "HS256",
        subject: String(account.id),
        issuer: "autosupply",
        audience: "autosupply-password-reset",
        expiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS,
        jwtid: crypto.randomUUID(),
      },
    );
    res.json({ resetToken, expiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS });
  }),
);

app.post(
  "/api/password-reset/reset",
  ah(async (req, res) => {
    const authorization = String(req.headers.authorization || "");
    const resetToken = authorization.match(/^Bearer\s+(\S+)$/i)?.[1] || "";
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: "Reset token and new password are required." });
    }
    if (newPassword.length < 4) {
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters long." });
    }

    const secret = getPasswordResetSecret();
    if (!secret) {
      return res.status(503).json({
        error: "Password recovery is not configured. Contact your administrator.",
      });
    }

    let claims;
    try {
      claims = jwt.verify(resetToken, secret, {
        algorithms: ["HS256"],
        issuer: "autosupply",
        audience: "autosupply-password-reset",
      });
    } catch {
      return res.status(401).json({
        error: "The reset token is invalid or expired. Verify your code again.",
      });
    }
    if (
      typeof claims !== "object" ||
      claims.purpose !== "password_reset" ||
      !/^\d+$/.test(claims.sub || "") ||
      !claims.jti ||
      !claims.exp
    ) {
      return res.status(401).json({ error: "Invalid password reset token." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "DELETE FROM password_reset_tokens WHERE expires_at <= NOW()",
      );
      try {
        await connection.query(
          "INSERT INTO password_reset_tokens (jwt_id, expires_at) VALUES (?, ?)",
          [claims.jti, new Date(claims.exp * 1000)],
        );
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          await connection.rollback();
          return res.status(401).json({
            error: "This reset token has already been used. Verify your code again.",
          });
        }
        throw error;
      }

      const [result] = await connection.query(
        "UPDATE users SET password_hash=? WHERE id=?",
        [hashPassword(newPassword), Number(claims.sub)],
      );
      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "User account no longer exists." });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    passwordResetCodes.delete(Number(claims.sub));
    for (const [sessionToken, session] of userSessions) {
      if (session.userId === Number(claims.sub)) userSessions.delete(sessionToken);
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
      `SELECT id, username, role, display_name
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
    setUserSession(req, res, user.id);
    res.json({
      username: user.username,
      role: user.role,
      displayName: user.display_name || user.username,
      email: "",
      phone: "",
    });
  }),
);

app.post("/api/logout", (req, res) => {
  clearUserSession(req, res);
  res.json({ ok: true });
});

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
    const { imageFileName, ...itemData } = req.body || {};
    const barcode =
      typeof itemData.barcode === "string" ? itemData.barcode.trim() : "";
    if (!itemData.name || !itemData.category || !itemData.rack) {
      return res
        .status(400)
        .json({ error: "Name, category, and rack are required." });
    }
    const itemId = normalizeItemId(itemData.id);
    if (!itemId) {
      return res.status(400).json({ error: "Item ID is required." });
    }
    if (barcode) {
      const [[existingItem]] = await pool.query(
        "SELECT id FROM inventory WHERE TRIM(barcode)=? LIMIT 1",
        [barcode],
      );
      if (existingItem) {
        return res
          .status(409)
          .json({ error: "That barcode is already registered to another item." });
      }
    }
    const item = {
      ...itemData,
      barcode: barcode || null,
      image: (await storeItemImage(itemData.image, imageFileName)) || undefined,
    };
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
    const { imageFileName, ...itemData } = req.body || {};
    const itemId = normalizeItemId(req.params.id);
    const barcode =
      typeof itemData.barcode === "string" ? itemData.barcode.trim() : "";
    const submittedItemId = normalizeItemId(itemData.id || itemId);
    if (barcode) {
      const [[existingItem]] = await pool.query(
        "SELECT id FROM inventory WHERE TRIM(barcode)=? AND id<>? LIMIT 1",
        [barcode, itemId],
      );
      if (existingItem) {
        return res
          .status(409)
          .json({ error: "That barcode is already registered to another item." });
      }
    }
    const item = {
      ...itemData,
      barcode: barcode || null,
      image: (await storeItemImage(itemData.image, imageFileName)) || undefined,
    };
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

/* ------------------------- Warehouse layout ------------------------- */

// Matches the aisles, colors and grid positions the map used before the layout moved into the database.
const defaultLayoutAisles = [
  { code: "A", category: "High Demand Only", color: "#1f9d8b", gridCol: 1, gridRow: 1 },
  { code: "B", category: "High Demand Only", color: "#1f9d8b", gridCol: 2, gridRow: 1 },
  { code: "C", category: "High Demand Only", color: "#1f9d8b", gridCol: 3, gridRow: 1 },
  { code: "D", category: "High Demand Only", color: "#1f9d8b", gridCol: 4, gridRow: 1 },
  { code: "E", category: "Body & Brakes", color: "#F59E0B", gridCol: 5, gridRow: 1 },
  { code: "F", category: "Body & Brakes", color: "#F59E0B", gridCol: 6, gridRow: 1 },
  { code: "G", category: "Electrical & Engine", color: "#6366F1", gridCol: 7, gridRow: 1 },
  { code: "H", category: "Electrical & Engine", color: "#6366F1", gridCol: 8, gridRow: 1 },
  { code: "I", category: "Suspension & Transmission", color: "#0891B2", gridCol: 5, gridRow: 4 },
  { code: "J", category: "Suspension & Transmission", color: "#0891B2", gridCol: 6, gridRow: 4 },
  { code: "K", category: "Misc", color: "#DB2777", gridCol: 7, gridRow: 4 },
  { code: "L", category: "Misc", color: "#DB2777", gridCol: 8, gridRow: 4 },
];

const DEFAULT_RACKS_PER_AISLE = 3;
const MAX_RACKS_PER_AISLE = 10;
const AISLE_ORIENTATIONS = ["portrait", "landscape"];

async function seedWarehouseLayout() {
  const [[floorCount]] = await pool.query("SELECT COUNT(*) AS count FROM floors");
  if (floorCount.count > 0) return;

  const [floorResult] = await pool.query(
    "INSERT INTO floors (name, sort_order) VALUES (?, ?)",
    ["Floor 1", 1],
  );
  for (const aisle of defaultLayoutAisles) {
    const [aisleResult] = await pool.query(
      "INSERT INTO aisles (floor_id, code, category, color, orientation, grid_col, grid_row) VALUES (?, ?, ?, ?, 'portrait', ?, ?)",
      [floorResult.insertId, aisle.code, aisle.category, aisle.color, aisle.gridCol, aisle.gridRow],
    );
    for (let number = 1; number <= DEFAULT_RACKS_PER_AISLE; number += 1) {
      await pool.query(
        "INSERT INTO racks (aisle_id, rack_number) VALUES (?, ?)",
        [aisleResult.insertId, number],
      );
    }
  }
}

// One-time repair for databases seeded before aisles I to L moved to row 4. It only moves aisles still
// at their old seed spots, and only when nothing else is in the way, so a layout changed by a user is left alone.
async function repairOldSeedPositions() {
  const [oldSpots] = await pool.query(
    "SELECT id FROM aisles WHERE code IN ('I','J','K','L') AND grid_row = 2 AND grid_col BETWEEN 5 AND 8",
  );
  if (oldSpots.length !== 4) return;

  const [[blocking]] = await pool.query(
    "SELECT COUNT(*) AS count FROM aisles WHERE grid_row BETWEEN 4 AND 6 AND grid_col BETWEEN 5 AND 8 AND code NOT IN ('I','J','K','L')",
  );
  if (blocking.count > 0) return;

  await pool.query(
    "UPDATE aisles SET grid_row = 4 WHERE code IN ('I','J','K','L') AND grid_row = 2 AND grid_col BETWEEN 5 AND 8",
  );
  console.log("Moved aisles I to L below the three-rack aisles.");
}

function rackCode(aisleCode, rackNumber) {
  return `${aisleCode}-${String(rackNumber).padStart(2, "0")}`;
}

// Returns floors → aisles → racks in the shape the frontend uses.
async function readWarehouseLayout(db = pool) {
  const [floorRows] = await db.query(
    "SELECT id, name, sort_order FROM floors ORDER BY sort_order, id",
  );
  const [aisleRows] = await db.query(
    "SELECT id, floor_id, code, category, color, orientation, grid_col, grid_row FROM aisles ORDER BY code",
  );
  const [rackRows] = await db.query(
    "SELECT id, aisle_id, rack_number, capacity FROM racks ORDER BY aisle_id, rack_number",
  );

  const aisleById = new Map();
  for (const row of aisleRows) {
    aisleById.set(row.id, {
      id: row.id,
      floorId: row.floor_id,
      code: row.code,
      category: row.category,
      color: row.color,
      orientation: row.orientation,
      gridCol: row.grid_col,
      gridRow: row.grid_row,
      racks: [],
    });
  }
  for (const row of rackRows) {
    const aisle = aisleById.get(row.aisle_id);
    if (!aisle) continue;
    aisle.racks.push({
      id: row.id,
      number: row.rack_number,
      code: rackCode(aisle.code, row.rack_number),
      capacity: row.capacity,
    });
  }

  return floorRows.map((floor) => ({
    id: floor.id,
    name: floor.name,
    sortOrder: floor.sort_order,
    aisles: [...aisleById.values()].filter((aisle) => aisle.floorId === floor.id),
  }));
}

async function requireAdmin(req, res) {
  const actor = await getAuthenticatedUser(req);
  if (!actor || actor.role !== "admin") {
    res
      .status(actor ? 403 : 401)
      .json({ error: "Administrator access is required." });
    return null;
  }
  return actor;
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Items whose rack code is in this aisle (A-01, A-02 …) block changes to the aisle.
async function aisleHasStock(db, aisleCode) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS count FROM inventory WHERE rack LIKE ?",
    [`${aisleCode}-%`],
  );
  return row.count > 0;
}

async function rackHasStock(db, code) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS count FROM inventory WHERE rack = ?",
    [code],
  );
  return row.count > 0;
}

// The floor grid has this many columns. One column is the width of one portrait aisle.
// A portrait aisle is one column wide; its header row and racks stack down (rows = racks + 1).
// A landscape aisle has one rack per column (columns = racks); header row plus one rack row (rows = 2).
const GRID_COLUMNS = 8;

function rackFootprint(orientation, rackCount) {
  const racks = Math.max(rackCount, 1);
  return orientation === "landscape"
    ? { cols: racks, rows: 1 }
    : { cols: 1, rows: racks };
}

// True when an aisle with this orientation and rack count at this cell would leave the grid
// or overlap another aisle on the floor.
async function isFootprintBlocked(db, floorId, gridCol, gridRow, orientation, rackCount, exceptAisleId = null) {
  const footprint = rackFootprint(orientation, rackCount);
  if (gridCol < 1 || gridRow < 1 || gridCol + footprint.cols - 1 > GRID_COLUMNS) return true;

  const [others] = await db.query(
    `SELECT a.id, a.grid_col, a.grid_row, a.orientation,
            (SELECT COUNT(*) FROM racks r WHERE r.aisle_id = a.id) AS rack_count
     FROM aisles a WHERE a.floor_id=? AND a.id<>?`,
    [floorId, exceptAisleId ?? 0],
  );
  return others.some((other) => {
    const otherFootprint = rackFootprint(other.orientation, other.rack_count);
    return (
      other.grid_col <= gridCol + footprint.cols - 1 &&
      other.grid_col + otherFootprint.cols - 1 >= gridCol &&
      other.grid_row <= gridRow + footprint.rows - 1 &&
      other.grid_row + otherFootprint.rows - 1 >= gridRow
    );
  });
}

app.get(
  "/api/layout",
  ah(async (_req, res) => {
    res.json(await readWarehouseLayout());
  }),
);

app.post(
  "/api/layout/floors",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const name = cleanText(req.body?.name, 100);
    if (!name) return res.status(400).json({ error: "Floor name is required." });

    const [[last]] = await pool.query("SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM floors");
    await pool.query("INSERT INTO floors (name, sort_order) VALUES (?, ?)", [name, last.maxOrder + 1]);
    res.status(201).json(await readWarehouseLayout());
  }),
);

app.put(
  "/api/layout/floors/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const floorId = toPositiveInt(req.params.id);
    if (!floorId) return res.status(400).json({ error: "Invalid floor." });

    const [[floor]] = await pool.query("SELECT id FROM floors WHERE id=?", [floorId]);
    if (!floor) return res.status(404).json({ error: "Floor not found." });

    const updates = [];
    const values = [];
    if (req.body?.name !== undefined) {
      const name = cleanText(req.body.name, 100);
      if (!name) return res.status(400).json({ error: "Floor name is required." });
      updates.push("name=?");
      values.push(name);
    }
    if (req.body?.sortOrder !== undefined) {
      const sortOrder = Number(req.body.sortOrder);
      if (!Number.isInteger(sortOrder)) return res.status(400).json({ error: "Invalid sort order." });
      updates.push("sort_order=?");
      values.push(sortOrder);
    }
    if (updates.length > 0) {
      await pool.query(`UPDATE floors SET ${updates.join(", ")} WHERE id=?`, [...values, floorId]);
    }
    res.json(await readWarehouseLayout());
  }),
);

app.delete(
  "/api/layout/floors/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const floorId = toPositiveInt(req.params.id);
    if (!floorId) return res.status(400).json({ error: "Invalid floor." });

    const [[floorCount]] = await pool.query("SELECT COUNT(*) AS count FROM floors");
    if (floorCount.count <= 1) {
      return res.status(400).json({ error: "The warehouse needs at least one floor." });
    }

    const [aisles] = await pool.query("SELECT code FROM aisles WHERE floor_id=?", [floorId]);
    for (const aisle of aisles) {
      if (await aisleHasStock(pool, aisle.code)) {
        return res.status(409).json({
          error: `Aisle ${aisle.code} still holds items. Move them before deleting this floor.`,
        });
      }
    }

    await pool.query("DELETE FROM floors WHERE id=?", [floorId]);
    res.json(await readWarehouseLayout());
  }),
);

app.post(
  "/api/layout/aisles",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const body = req.body || {};
    const floorId = toPositiveInt(body.floorId);
    const code = cleanText(body.code, 8).toUpperCase();
    const category = cleanText(body.category, 100);
    const color = typeof body.color === "string" ? body.color : "#64748b";
    const orientation = body.orientation || "portrait";
    const gridCol = toPositiveInt(body.gridCol);
    const gridRow = toPositiveInt(body.gridRow);
    const rackCount = body.rackCount === undefined ? DEFAULT_RACKS_PER_AISLE : toPositiveInt(body.rackCount);

    if (!floorId) return res.status(400).json({ error: "Choose a floor for the aisle." });
    if (!/^[A-Z0-9]{1,8}$/.test(code)) {
      return res.status(400).json({ error: "Aisle name must be 1 to 8 letters or numbers." });
    }
    if (!category) return res.status(400).json({ error: "Choose a category for the aisle." });
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: "Invalid aisle color." });
    if (!AISLE_ORIENTATIONS.includes(orientation)) return res.status(400).json({ error: "Invalid orientation." });
    if (!gridCol || !gridRow) return res.status(400).json({ error: "Choose a position for the aisle." });
    if (!rackCount || rackCount > MAX_RACKS_PER_AISLE) {
      return res.status(400).json({ error: `An aisle needs 1 to ${MAX_RACKS_PER_AISLE} racks.` });
    }

    const [[floor]] = await pool.query("SELECT id FROM floors WHERE id=?", [floorId]);
    if (!floor) return res.status(404).json({ error: "Floor not found." });

    const [[codeTaken]] = await pool.query("SELECT id FROM aisles WHERE code=?", [code]);
    if (codeTaken) return res.status(409).json({ error: `Aisle ${code} already exists.` });
    if (await isFootprintBlocked(pool, floorId, gridCol, gridRow, orientation, rackCount)) {
      return res.status(409).json({ error: "That spot is taken or does not fit on this floor." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [aisleResult] = await connection.query(
        "INSERT INTO aisles (floor_id, code, category, color, orientation, grid_col, grid_row) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [floorId, code, category, color, orientation, gridCol, gridRow],
      );
      for (let number = 1; number <= rackCount; number += 1) {
        await connection.query(
          "INSERT INTO racks (aisle_id, rack_number) VALUES (?, ?)",
          [aisleResult.insertId, number],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.status(201).json(await readWarehouseLayout());
  }),
);

app.put(
  "/api/layout/aisles/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const aisleId = toPositiveInt(req.params.id);
    if (!aisleId) return res.status(400).json({ error: "Invalid aisle." });

    const [[aisle]] = await pool.query(
      "SELECT id, floor_id, code, orientation, grid_col, grid_row, (SELECT COUNT(*) FROM racks r WHERE r.aisle_id = aisles.id) AS rack_count FROM aisles WHERE id=?",
      [aisleId],
    );
    if (!aisle) return res.status(404).json({ error: "Aisle not found." });

    const body = req.body || {};
    const next = {
      floorId: aisle.floor_id,
      code: aisle.code,
      category: undefined,
      color: undefined,
      orientation: aisle.orientation,
      gridCol: aisle.grid_col,
      gridRow: aisle.grid_row,
    };

    if (body.floorId !== undefined) {
      next.floorId = toPositiveInt(body.floorId);
      if (!next.floorId) return res.status(400).json({ error: "Invalid floor." });
    }
    if (body.code !== undefined) {
      next.code = cleanText(body.code, 8).toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(next.code)) {
        return res.status(400).json({ error: "Aisle name must be 1 to 8 letters or numbers." });
      }
      // Rack codes in inventory are built from the aisle name, so a rename would orphan stock.
      if (next.code !== aisle.code && (await aisleHasStock(pool, aisle.code))) {
        return res.status(409).json({ error: `Aisle ${aisle.code} still holds items and cannot be renamed.` });
      }
      if (next.code !== aisle.code) {
        const [[codeTaken]] = await pool.query("SELECT id FROM aisles WHERE code=? AND id<>?", [next.code, aisleId]);
        if (codeTaken) return res.status(409).json({ error: `Aisle ${next.code} already exists.` });
      }
    }
    if (body.category !== undefined) {
      next.category = cleanText(body.category, 100);
      if (!next.category) return res.status(400).json({ error: "Choose a category for the aisle." });
    }
    if (body.color !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) return res.status(400).json({ error: "Invalid aisle color." });
      next.color = body.color;
    }
    if (body.orientation !== undefined) {
      if (!AISLE_ORIENTATIONS.includes(body.orientation)) return res.status(400).json({ error: "Invalid orientation." });
      next.orientation = body.orientation;
    }
    if (body.gridCol !== undefined) {
      next.gridCol = toPositiveInt(body.gridCol);
      if (!next.gridCol) return res.status(400).json({ error: "Invalid position." });
    }
    if (body.gridRow !== undefined) {
      next.gridRow = toPositiveInt(body.gridRow);
      if (!next.gridRow) return res.status(400).json({ error: "Invalid position." });
    }

    const shapeChanged =
      next.floorId !== aisle.floor_id ||
      next.gridCol !== aisle.grid_col ||
      next.gridRow !== aisle.grid_row ||
      next.orientation !== aisle.orientation;
    if (
      shapeChanged &&
      (await isFootprintBlocked(pool, next.floorId, next.gridCol, next.gridRow, next.orientation, aisle.rack_count, aisleId))
    ) {
      return res.status(409).json({ error: "That spot is taken or does not fit on this floor." });
    }

    const updates = [];
    const values = [];
    const columns = {
      floorId: "floor_id",
      code: "code",
      category: "category",
      color: "color",
      orientation: "orientation",
      gridCol: "grid_col",
      gridRow: "grid_row",
    };
    for (const [key, column] of Object.entries(columns)) {
      if (body[key] !== undefined) {
        updates.push(`${column}=?`);
        values.push(next[key]);
      }
    }
    if (updates.length > 0) {
      await pool.query(`UPDATE aisles SET ${updates.join(", ")} WHERE id=?`, [...values, aisleId]);
    }
    res.json(await readWarehouseLayout());
  }),
);

app.delete(
  "/api/layout/aisles/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const aisleId = toPositiveInt(req.params.id);
    if (!aisleId) return res.status(400).json({ error: "Invalid aisle." });

    const [[aisle]] = await pool.query("SELECT code FROM aisles WHERE id=?", [aisleId]);
    if (!aisle) return res.status(404).json({ error: "Aisle not found." });
    if (await aisleHasStock(pool, aisle.code)) {
      return res.status(409).json({ error: `Aisle ${aisle.code} still holds items. Move them before deleting it.` });
    }

    await pool.query("DELETE FROM aisles WHERE id=?", [aisleId]);
    res.json(await readWarehouseLayout());
  }),
);

app.post(
  "/api/layout/aisles/:id/racks",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const aisleId = toPositiveInt(req.params.id);
    if (!aisleId) return res.status(400).json({ error: "Invalid aisle." });

    const [[aisle]] = await pool.query("SELECT id, orientation FROM aisles WHERE id=?", [aisleId]);
    if (!aisle) return res.status(404).json({ error: "Aisle not found." });

    const [[counts]] = await pool.query(
      "SELECT COUNT(*) AS count, COALESCE(MAX(rack_number), 0) AS maxNumber FROM racks WHERE aisle_id=?",
      [aisleId],
    );
    if (counts.count >= MAX_RACKS_PER_AISLE) {
      return res.status(400).json({ error: `An aisle can have at most ${MAX_RACKS_PER_AISLE} racks.` });
    }
    // A landscape aisle has one rack per grid column, so it cannot be wider than the grid.
    if (aisle.orientation === "landscape" && counts.count + 1 > GRID_COLUMNS) {
      return res.status(400).json({ error: `A landscape aisle can have at most ${GRID_COLUMNS} racks.` });
    }
    await pool.query(
      "INSERT INTO racks (aisle_id, rack_number) VALUES (?, ?)",
      [aisleId, counts.maxNumber + 1],
    );
    res.status(201).json(await readWarehouseLayout());
  }),
);

app.put(
  "/api/layout/racks/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const rackId = toPositiveInt(req.params.id);
    if (!rackId) return res.status(400).json({ error: "Invalid rack." });

    const [[rack]] = await pool.query("SELECT id FROM racks WHERE id=?", [rackId]);
    if (!rack) return res.status(404).json({ error: "Rack not found." });

    // Only capacity can change; numbers stay sequential. Empty capacity means no limit.
    const rawCapacity = req.body?.capacity;
    let capacity = null;
    if (rawCapacity !== undefined && rawCapacity !== null && rawCapacity !== "") {
      capacity = toPositiveInt(rawCapacity);
      if (!capacity) return res.status(400).json({ error: "Capacity must be a positive number." });
    }
    await pool.query("UPDATE racks SET capacity=? WHERE id=?", [capacity, rackId]);
    res.json(await readWarehouseLayout());
  }),
);

app.delete(
  "/api/layout/racks/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const rackId = toPositiveInt(req.params.id);
    if (!rackId) return res.status(400).json({ error: "Invalid rack." });

    const [[rack]] = await pool.query(
      `SELECT r.id, r.rack_number, a.code, a.id AS aisle_id
       FROM racks r JOIN aisles a ON a.id = r.aisle_id WHERE r.id=?`,
      [rackId],
    );
    if (!rack) return res.status(404).json({ error: "Rack not found." });

    const [[counts]] = await pool.query(
      "SELECT COUNT(*) AS count, MAX(rack_number) AS maxNumber FROM racks WHERE aisle_id=?",
      [rack.aisle_id],
    );
    if (counts.count <= 1) {
      return res.status(400).json({ error: "An aisle needs at least one rack. Delete the aisle instead." });
    }
    // Only the highest-numbered rack can go, so the numbers stay 1..n.
    if (rack.rack_number !== counts.maxNumber) {
      return res.status(400).json({ error: "Remove the highest-numbered rack first to keep numbering sequential." });
    }

    const code = rackCode(rack.code, rack.rack_number);
    if (await rackHasStock(pool, code)) {
      return res.status(409).json({ error: `Rack ${code} still holds items. Move them to another rack first.` });
    }

    await pool.query("DELETE FROM racks WHERE id=?", [rackId]);
    res.json(await readWarehouseLayout());
  }),
);

// Saves a whole layout in one request. The server checks the complete result first, then applies
// it inside one transaction, so a failed save never leaves the layout half-changed.
app.put(
  "/api/layout",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const floorsInput = Array.isArray(req.body?.floors) ? req.body.floors : null;
    if (!floorsInput || floorsInput.length === 0) {
      return res.status(400).json({ error: "The layout must contain at least one floor." });
    }

    const [dbFloors] = await pool.query("SELECT id FROM floors");
    const floorIds = new Set(dbFloors.map((floor) => floor.id));
    const [dbAisles] = await pool.query(
      `SELECT a.id, a.floor_id, a.code, a.category, a.color, a.orientation, a.grid_col, a.grid_row,
              (SELECT COUNT(*) FROM racks r WHERE r.aisle_id = a.id) AS rack_count
       FROM aisles a`,
    );
    const dbAisleById = new Map(dbAisles.map((aisle) => [aisle.id, aisle]));

    // 1. Validate every aisle in the submitted layout.
    const submitted = [];
    const codes = new Set();
    for (const floorInput of floorsInput) {
      const floorId = toPositiveInt(floorInput?.id);
      if (!floorId || !floorIds.has(floorId)) {
        return res.status(400).json({ error: "The layout refers to a floor that does not exist." });
      }
      for (const input of Array.isArray(floorInput.aisles) ? floorInput.aisles : []) {
        const id = toPositiveInt(input.id);
        const saved = id ? dbAisleById.get(id) : undefined;
        if (!saved) return res.status(400).json({ error: "The layout refers to an aisle that does not exist." });
        const code = cleanText(input.code, 8).toUpperCase();
        const category = cleanText(input.category, 100);
        const color = typeof input.color === "string" ? input.color : saved.color;
        const orientation = input.orientation;
        const gridCol = toPositiveInt(input.gridCol);
        const gridRow = toPositiveInt(input.gridRow);
        const rackCount = toPositiveInt(input.rackCount);
        if (!/^[A-Z0-9]{1,8}$/.test(code)) {
          return res.status(400).json({ error: "Aisle names must be 1 to 8 letters or numbers." });
        }
        if (codes.has(code)) return res.status(409).json({ error: `Aisle ${code} appears more than once.` });
        codes.add(code);
        if (!category) return res.status(400).json({ error: `Aisle ${code} needs a category.` });
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: `Aisle ${code} has an invalid color.` });
        if (!AISLE_ORIENTATIONS.includes(orientation)) return res.status(400).json({ error: `Aisle ${code} has an invalid orientation.` });
        if (!gridCol || !gridRow) return res.status(400).json({ error: `Aisle ${code} needs a position.` });
        if (!rackCount || rackCount > MAX_RACKS_PER_AISLE) {
          return res.status(400).json({ error: `Aisle ${code} needs 1 to ${MAX_RACKS_PER_AISLE} racks.` });
        }
        submitted.push({ id, floorId, code, category, color, orientation, gridCol, gridRow, rackCount, saved });
      }
    }

    // 2. Check that nothing overlaps and nothing leaves the grid. Only aisles that were changed are
    // checked, so an overlap that already exists in the saved layout does not block unrelated saves.
    const isChanged = (aisle) =>
      aisle.floorId !== aisle.saved.floor_id ||
      aisle.gridCol !== aisle.saved.grid_col ||
      aisle.gridRow !== aisle.saved.grid_row ||
      aisle.orientation !== aisle.saved.orientation ||
      aisle.rackCount !== aisle.saved.rack_count;
    for (const floorId of floorIds) {
      const onFloor = submitted.filter((aisle) => aisle.floorId === floorId);
      for (const aisle of onFloor) {
        if (!isChanged(aisle)) continue;
        const footprint = rackFootprint(aisle.orientation, aisle.rackCount);
        if (aisle.gridCol + footprint.cols - 1 > GRID_COLUMNS) {
          return res.status(409).json({ error: `Aisle ${aisle.code} does not fit on the floor.` });
        }
        for (const other of onFloor) {
          if (other === aisle) continue;
          if (!isChanged(aisle) && !isChanged(other)) continue;
          const otherFootprint = rackFootprint(other.orientation, other.rackCount);
          const overlaps =
            other.gridCol <= aisle.gridCol + footprint.cols - 1 &&
            other.gridCol + otherFootprint.cols - 1 >= aisle.gridCol &&
            other.gridRow <= aisle.gridRow + footprint.rows - 1 &&
            other.gridRow + otherFootprint.rows - 1 >= aisle.gridRow;
          if (overlaps) {
            return res.status(409).json({ error: `Aisle ${aisle.code} overlaps Aisle ${other.code}.` });
          }
        }
      }
    }

    // 3. Work out what goes, and make sure no stock is orphaned by it.
    const submittedIds = new Set(submitted.map((aisle) => aisle.id));
    const removedAisles = dbAisles.filter((aisle) => floorIds.has(aisle.floor_id) && !submittedIds.has(aisle.id));
    for (const aisle of removedAisles) {
      if (await aisleHasStock(pool, aisle.code)) {
        return res.status(409).json({ error: `Aisle ${aisle.code} still holds items. Move them before deleting it.` });
      }
    }
    for (const aisle of submitted) {
      if (aisle.code !== aisle.saved.code && (await aisleHasStock(pool, aisle.saved.code))) {
        return res.status(409).json({ error: `Aisle ${aisle.saved.code} still holds items and cannot be renamed.` });
      }
      for (let number = aisle.rackCount + 1; number <= aisle.saved.rack_count; number += 1) {
        const code = rackCode(aisle.saved.code, number);
        if (await rackHasStock(pool, code)) {
          return res.status(409).json({ error: `Rack ${code} still holds items. Move them to another rack first.` });
        }
      }
    }

    // 4. Apply everything in one transaction.
    const moved = submitted.filter(
      (aisle) => aisle.floorId !== aisle.saved.floor_id || aisle.gridCol !== aisle.saved.grid_col || aisle.gridRow !== aisle.saved.grid_row,
    );
    const renamed = submitted.filter((aisle) => aisle.code !== aisle.saved.code);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const aisle of removedAisles) {
        await connection.query("DELETE FROM aisles WHERE id=?", [aisle.id]);
      }
      // Temporary names avoid clashes when two aisles swap names.
      for (const aisle of renamed) {
        await connection.query("UPDATE aisles SET code=? WHERE id=?", [`T${aisle.id}`, aisle.id]);
      }
      // Park moved aisles on rows below the grid so that swaps cannot collide.
      for (const [index, aisle] of moved.entries()) {
        await connection.query("UPDATE aisles SET floor_id=?, grid_col=1, grid_row=? WHERE id=?", [
          aisle.floorId,
          100000 + index,
          aisle.id,
        ]);
      }
      for (const aisle of submitted) {
        const current = aisle.saved.rack_count;
        if (aisle.rackCount < current) {
          await connection.query("DELETE FROM racks WHERE aisle_id=? AND rack_number>?", [aisle.id, aisle.rackCount]);
        } else if (aisle.rackCount > current) {
          const [[last]] = await connection.query(
            "SELECT COALESCE(MAX(rack_number), 0) AS maxNumber FROM racks WHERE aisle_id=?",
            [aisle.id],
          );
          for (let added = 1; added <= aisle.rackCount - current; added += 1) {
            await connection.query("INSERT INTO racks (aisle_id, rack_number) VALUES (?, ?)", [aisle.id, last.maxNumber + added]);
          }
        }
        await connection.query(
          "UPDATE aisles SET code=?, category=?, color=?, orientation=?, floor_id=?, grid_col=?, grid_row=? WHERE id=?",
          [aisle.code, aisle.category, aisle.color, aisle.orientation, aisle.floorId, aisle.gridCol, aisle.gridRow, aisle.id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json(await readWarehouseLayout());
  }),
);

/* ------------------------ Static files & errors --------------------- */

app.use("/api/uploads", express.static(uploadsDirectory));
app.use(express.static(path.join(__dirname, "dist")));
// Regex works on Express 4 and 5, and unknown /api routes get a JSON 404 instead of index.html.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
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

// Hostinger's Node.js launcher requires listen() within 3 seconds and does not
// run the entry file as `node server.js`, so the server listens first and the
// database setup runs in the background.
export function startServer() {
  app.listen(port, () =>
    console.log(`API listening on http://localhost:${port}`),
  );

  initializeDatabase()
    .then(() => {
      void purgeExpiredHistory().catch((error) => {
        console.error("Initial audit history cleanup failed:", error.message);
      });
      scheduleHistoryCleanup();
    })
    .catch((error) => {
      console.error("Database initialization failed:", error.message);
    });
}

startServer();
