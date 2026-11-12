import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read .env from the project folder, whatever folder the server is started from.
const { parsed: projectEnv } = dotenv.config({ path: path.join(__dirname, ".env") });
for (const name of [
  "JWT_RESET_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "SMTP_USER",
  "SMTP_PASSWORD",
]) {
  const useProjectValue =
    !process.env[name]?.trim() ||
    (name === "JWT_RESET_SECRET" && Buffer.byteLength(process.env[name]) < 32);
  if (useProjectValue && projectEnv?.[name]?.trim()) {
    process.env[name] = projectEnv[name];
  }
}
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

export const pool = mysql.createPool({
  ...DB_CONFIG,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  // Return DATE columns as "YYYY-MM-DD" strings so timezone shifts can't change the day.
  dateStrings: ["DATE"],
});

// Behind Hostinger's proxy, use the visitor's real address for rate limits (not the proxy's).
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Express 4 does not catch rejected promises in async handlers; this forwards them to the error handler.
const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Item writes run one at a time, so two people saving at once cannot both pass the
// "ID / barcode is free" check and then both insert it. The lock is held on one connection.
const INVENTORY_LOCK = "skyrun:inventory";
async function withInventoryLock(run) {
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 15) AS acquired", [INVENTORY_LOCK]);
    if (Number(lock?.acquired) !== 1) {
      const busy = new Error("The system is busy with another change. Please try again.");
      busy.httpStatus = 503;
      throw busy;
    }
    try {
      return await run(connection);
    } finally {
      await connection.query("SELECT RELEASE_LOCK(?)", [INVENTORY_LOCK]);
    }
  } finally {
    connection.release();
  }
}

// The next free numeric item ID, for telling someone who picked a taken ID what to use instead.
async function nextFreeItemId(connection) {
  const [[row]] = await connection.query(
    "SELECT COALESCE(MAX(CAST(id AS UNSIGNED)), 0) AS maxId FROM inventory WHERE id REGEXP '^[0-9]+$'",
  );
  return String(Number(row.maxId) + 1).padStart(3, "0");
}

const USER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function readSessionToken(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("autosupply_session="));
  return cookie ? cookie.slice("autosupply_session=".length) : null;
}

const hashSessionToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Looks up the signed-in user. Sessions are stored in the database, so they survive server restarts.
async function getAuthenticatedUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const [[user]] = await pool.query(
    `SELECT u.id, u.username, u.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()
     LIMIT 1`,
    [hashSessionToken(token)],
  );
  return user || null;
}

// Removes every session of one user, for example after a password change or account deletion.
async function endAllSessionsForUser(userId) {
  await pool.query("DELETE FROM user_sessions WHERE user_id=?", [userId]);
}

async function setUserSession(req, res, userId) {
  await pool.query("DELETE FROM user_sessions WHERE expires_at <= NOW()");

  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))",
    [hashSessionToken(token), userId, Math.floor(USER_SESSION_TTL_MS / 1000)],
  );
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `autosupply_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(USER_SESSION_TTL_MS / 1000)}${secure}`,
  );
}

async function clearUserSession(req, res) {
  const token = readSessionToken(req);
  if (token) await pool.query("DELETE FROM user_sessions WHERE token_hash=?", [hashSessionToken(token)]);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `autosupply_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  );
}

// Saves a base64 image sent by the item form to the uploads folder and returns its URL.
async function storeItemImage(image, imageFileName) {
  if (typeof image !== "string" || !image.startsWith("data:")) {
    // A pasted address must be a web link or an uploaded picture path, so it cannot run as a script.
    if (image && !/^(https?:\/\/|\/api\/uploads\/)/i.test(image.trim())) {
      throw Object.assign(new Error("The picture address must start with https:// or http://."), { status: 400 });
    }
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

// Item form fields that are typed or picked from suggestions, in the order they are stored.
// Each maps to a camelCase property on the item and a snake_case column in inventory.
const ITEM_DESCRIPTOR_FIELDS = [
  ["brand", "brand"],
  ["itemType", "item_type"],
  ["model", "model"],
  ["partNumber", "part_number"],
  ["color", "color"],
  ["unitOfMeasure", "unit_of_measure"],
  ["supplier", "supplier"],
];
const ITEM_DESCRIPTOR_COLUMNS = ITEM_DESCRIPTOR_FIELDS.map(([, column]) => column);

// Every table uses the character set of the inventory table, because a foreign key
// must match it (MySQL error 150 otherwise). Set in initializeDatabase.
let tableOptions = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

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
  ) ${tableOptions}`);
  const [[idColumn]] = await pool.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory' AND COLUMN_NAME = 'id'`,
  );
  if (/^[a-z0-9_]+$/i.test(idColumn?.charset || "") && /^[a-z0-9_]+$/i.test(idColumn?.collation || "")) {
    tableOptions = `ENGINE=InnoDB DEFAULT CHARSET=${idColumn.charset} COLLATE=${idColumn.collation}`;
  }
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
  // Supplier discount in percent. Local cost = purchase cost less this discount.
  await addColumnIfMissing("inventory", "discount", "DECIMAL(5,2) NOT NULL DEFAULT 0");
  // Bumped on every change to the item, so an edit made from an older copy is refused.
  await addColumnIfMissing("inventory", "version", "INT NOT NULL DEFAULT 0");
  // Descriptive fields shown in the item form (nullable: existing items start without them).
  for (const column of ITEM_DESCRIPTOR_COLUMNS) {
    await addColumnIfMissing("inventory", column, "VARCHAR(100) NULL");
  }
  // Existing databases may still have a TEXT image column, which is too small for uploaded images.
  await pool.query("ALTER TABLE inventory MODIFY COLUMN image LONGTEXT NULL");
  // A rack is optional, so an item can be saved before it is placed on the map.
  await pool.query("ALTER TABLE inventory MODIFY COLUMN rack VARCHAR(32) NULL");

  await pool.query(`CREATE TABLE IF NOT EXISTS inventory_audit (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(32) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    action ENUM('ADD', 'DELETE') NOT NULL,
    item_data JSON NULL,
    created_by VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ${tableOptions}`);
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
  ) ${tableOptions}`);
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
  ) ${tableOptions}`);
  // The login route selects display_name, but the column never existed.
  await addColumnIfMissing("users", "display_name", "VARCHAR(100) NULL");
  await addColumnIfMissing("users", "email", "VARCHAR(255) NULL");
  await addColumnIfMissing("users", "email_verified_at", "DATETIME NULL");
  await addColumnIfMissing("users", "password_updated_at", "DATETIME NULL");
  // Sign-in sessions. Only a hash of each token is stored, so a copy of this table cannot be used to sign in.
  await pool.query(`CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_sessions_user (user_id),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${tableOptions}`);

  await pool.query(`CREATE TABLE IF NOT EXISTS email_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    email VARCHAR(255) NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_codes_lookup (user_id, purpose, id),
    CONSTRAINT fk_email_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${tableOptions}`);

  // Warehouse layout: floors, aisles and racks. inventory.rack keeps the "A-01" style code.
  await pool.query(`CREATE TABLE IF NOT EXISTS floors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ${tableOptions}`);
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
  ) ${tableOptions}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS racks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    aisle_id INT NOT NULL,
    rack_number INT NOT NULL,
    capacity INT NULL,
    UNIQUE KEY uq_rack_number (aisle_id, rack_number),
    CONSTRAINT fk_racks_aisle FOREIGN KEY (aisle_id) REFERENCES aisles(id) ON DELETE CASCADE
  ) ${tableOptions}`);
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

  // Quantity changes are recorded in the audit log as QTY entries.
  await pool.query("ALTER TABLE inventory_audit MODIFY COLUMN action ENUM('ADD', 'DELETE', 'QTY') NOT NULL");

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
  await createStockCardTables();
  await createSalesTable();
  await pool.query(`CREATE TABLE IF NOT EXISTS change_requests (
    id VARCHAR(64) PRIMARY KEY,
    request_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    invoice VARCHAR(64) NOT NULL DEFAULT '',
    item_id VARCHAR(32) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    old_value INT NULL,
    new_value INT NULL,
    reason VARCHAR(255) NULL,
    requested_by VARCHAR(64) NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(16) NOT NULL,
    decided_by VARCHAR(64) NULL,
    decided_at TIMESTAMP NULL,
    decision_note VARCHAR(255) NULL,
    KEY idx_change_requests_status (status),
    KEY idx_change_requests_invoice (invoice)
  ) ${tableOptions}`);
  await pool.query("ALTER TABLE change_requests MODIFY old_value DECIMAL(12,2) NULL, MODIFY new_value DECIMAL(12,2) NULL");
  await addColumnIfMissing("movements", "reference", "VARCHAR(64) NULL");
  await addColumnIfMissing("movements", "supplier_id", "INT NULL");
  await backfillStockLedger();
}

function toItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    barcode: row.barcode || undefined,
    quantity: Number(row.quantity),
    price: Number(row.price),
    rack: row.rack || "",
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
    version: Number(row.version || 0),
    brand: row.brand || undefined,
    itemType: row.item_type || undefined,
    model: row.model || undefined,
    partNumber: row.part_number || undefined,
    color: row.color || undefined,
    unitOfMeasure: row.unit_of_measure || undefined,
    discount: Number(row.discount || 0),
    supplier: row.supplier || undefined,
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

// The old and new quantity stored with a QTY audit entry.
function quantityChangeOf(itemData) {
  let data = itemData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!data || !Number.isFinite(Number(data.oldQuantity))) return undefined;
  return { from: Number(data.oldQuantity), to: Number(data.newQuantity) };
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
    quantityChange: row.action === "QTY" ? quantityChangeOf(row.item_data) : undefined,
  };
}

// ---- Passwords ----
// New passwords are stored as "scrypt$<salt>$<hash>" with a random salt per password. Older
// accounts still have an unsalted SHA-256 hash (64 hex characters); they are upgraded on sign-in.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function isLegacyPasswordHash(stored) {
  return /^[a-f0-9]{64}$/i.test(stored || "");
}

function verifyPassword(stored, password) {
  if (!stored) return false;
  if (isLegacyPasswordHash(stored)) {
    const legacy = crypto.createHash("sha256").update(String(password)).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(stored.toLowerCase()), Buffer.from(legacy));
  }
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, "base64"), expected.length, SCRYPT_OPTIONS);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---- Email ----
// Settings come from the environment (.env locally, site environment variables on Hostinger).
function getMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error("Email is not configured on the server.");
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
}

async function sendMail({ to, subject, text }) {
  const mailer = getMailer();
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

// ---- One-time codes (email verification and password reset) ----
const CODE_TTL_MINUTES = 15;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function codeSecret() {
  if (!process.env.JWT_RESET_SECRET) {
    throw new Error("JWT_RESET_SECRET is not set on the server.");
  }
  return process.env.JWT_RESET_SECRET;
}

function hashCode(code) {
  return crypto.createHmac("sha256", codeSecret()).update(code).digest("hex");
}

function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 255 && EMAIL_PATTERN.test(email) ? email : null;
}

// Sends a new code. Earlier unused codes of the same purpose stop working.
async function issueCode(userId, purpose, email) {
  const [[recent]] = await pool.query(
    "SELECT created_at FROM email_codes WHERE user_id=? AND purpose=? ORDER BY id DESC LIMIT 1",
    [userId, purpose],
  );
  if (recent && Date.now() - new Date(recent.created_at).getTime() < CODE_RESEND_SECONDS * 1000) {
    const error = new Error("Please wait a minute before requesting another code.");
    error.status = 429;
    throw error;
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await pool.query("UPDATE email_codes SET used_at=NOW() WHERE user_id=? AND purpose=? AND used_at IS NULL", [
    userId,
    purpose,
  ]);
  await pool.query(
    "INSERT INTO email_codes (user_id, purpose, email, code_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
    [userId, purpose, email, hashCode(code), CODE_TTL_MINUTES],
  );

  const subject = purpose === "verify_email" ? "Verify your AutoSupply recovery email" : "Your AutoSupply password reset code";
  const intro = purpose === "verify_email"
    ? "Use this code to confirm this recovery email address:"
    : "Use this code to reset your AutoSupply password:";
  await sendMail({
    to: email,
    subject,
    text: `${intro}\n\n${code}\n\nThe code expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,
  });
}

// Returns true once, and only for the latest unused code sent to this email.
async function checkCode(userId, purpose, email, code) {
  const [[row]] = await pool.query(
    "SELECT id, code_hash, attempts, expires_at, email FROM email_codes WHERE user_id=? AND purpose=? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
    [userId, purpose],
  );
  if (!row || row.email !== email) return { ok: false, message: "The code is incorrect or has expired." };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, message: "The code has expired. Request a new one." };
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    return { ok: false, message: "Too many wrong attempts. Request a new code." };
  }

  const given = Buffer.from(hashCode(String(code || "").trim()));
  const expected = Buffer.from(row.code_hash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    await pool.query("UPDATE email_codes SET attempts = attempts + 1 WHERE id=?", [row.id]);
    return { ok: false, message: "The code is incorrect or has expired." };
  }

  await pool.query("UPDATE email_codes SET used_at=NOW() WHERE id=?", [row.id]);
  return { ok: true };
}

function sendFailure(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ error: error.message });
  console.error(fallback, error?.message || error);
  return res.status(502).json({ error: "Could not send the email. Check the email settings on the server." });
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
      "SELECT id, username, role, email, email_verified_at FROM users ORDER BY username",
    );
    res.json(
      rows.map((row) => ({
        id: row.id,
        username: row.username,
        role: row.role,
        email: row.email || "",
        emailVerified: Boolean(row.email_verified_at),
      })),
    );
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
    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters long." });
    }

    const [[existing]] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE LOWER(username)=LOWER(?)",
      [normalizedUsername],
    );
    if (existing.count > 0) {
      return res.status(409).json({ error: "That username already exists." });
    }

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

    if (newPasswordString.length < MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters long." });
    }

    const [rows] = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE id=? LIMIT 1",
      [actor.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = rows[0];
    // Only wrong current-password attempts count, so the owner is locked out after repeated guesses.
    const attemptsKey = `change-password:${user.id}`;
    if (blockedByLimit(res, [attemptsKey], "Too many failed password attempts.")) return;
    if (!verifyPassword(user.password_hash, String(currentPassword))) {
      recordLoginFailure(attemptsKey, 5);
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    loginFailures.delete(attemptsKey);

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
    if (!verifyPassword(user.password_hash, String(currentPassword))) {
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
      String(password).trim().length < MIN_PASSWORD_LENGTH
    ) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters long." });
    }

    // An empty email clears the recovery email. Any other value must be a valid address.
    const emailInput = email === undefined ? undefined : String(email).trim();
    const normalizedEmail = emailInput ? normalizeEmail(emailInput) : null;
    if (emailInput && !normalizedEmail) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [adminRows] = await connection.query(
        "SELECT id FROM users WHERE role='admin' FOR UPDATE",
      );
      const [[targetUser]] = await connection.query(
        "SELECT id, role, email FROM users WHERE id=? LIMIT 1 FOR UPDATE",
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

      const emailChanged =
        emailInput !== undefined && (normalizedEmail || "") !== (targetUser.email || "").toLowerCase();
      if (emailChanged && normalizedEmail) {
        const [[emailTaken]] = await connection.query(
          "SELECT id FROM users WHERE LOWER(email)=? AND id<>? AND email_verified_at IS NOT NULL LIMIT 1",
          [normalizedEmail, userId],
        );
        if (emailTaken) {
          await connection.rollback();
          return res.status(409).json({ error: "That email is already used by another account." });
        }
      }

      const updates = ["username=?", "role=?"];
      const values = [normalizedUsername, normalizedRole];
      if (password !== undefined && String(password).trim()) {
        updates.push("password_hash=?");
        values.push(hashPassword(String(password).trim()));
      }
      if (emailChanged) {
        // A new address must be confirmed again, so it starts unverified.
        updates.push("email=?", "email_verified_at=NULL");
        values.push(normalizedEmail);
      }
      values.push(userId);
      await connection.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id=?`,
        values,
      );
      await connection.commit();
      if (password !== undefined && String(password).trim()) {
        await endAllSessionsForUser(userId);
      }

      // Send the confirmation code to the new address. The user confirms it from their Recovery Email dialog.
      let codeSent = false;
      if (emailChanged && normalizedEmail) {
        try {
          await issueCode(userId, "verify_email", normalizedEmail);
          codeSent = true;
        } catch (error) {
          console.error("Sending the verification email failed:", error?.message || error);
        }
      }
      res.json({
        ok: true,
        username: normalizedUsername,
        emailChanged: emailChanged && Boolean(normalizedEmail),
        codeSent,
      });
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
      await endAllSessionsForUser(userId);
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

// ---- Sign-in rate limit: slows down password guessing and login floods ----
// Failures are counted per account and per IP address. Too many in the window locks that key for a while.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES_PER_ACCOUNT = 5;
const LOGIN_MAX_FAILURES_PER_IP = 30;
const loginFailures = new Map(); // key -> { count, windowStart, lockedUntil }

function lockRemainingMs(key) {
  const entry = loginFailures.get(key);
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) loginFailures.delete(key);
  return Math.max(0, remaining);
}

function recordLoginFailure(key, maxFailures) {
  const now = Date.now();
  if (loginFailures.size > 10000) {
    // Drop old entries so the map cannot grow without limit.
    for (const [oldKey, oldEntry] of loginFailures) {
      if (now - oldEntry.windowStart > LOGIN_WINDOW_MS && oldEntry.lockedUntil < now) loginFailures.delete(oldKey);
    }
  }
  let entry = loginFailures.get(key);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= maxFailures) entry.lockedUntil = now + LOGIN_LOCK_MS;
  loginFailures.set(key, entry);
}

function tooManyLoginsResponse(res, waitMs, message = "Too many failed sign-in attempts.") {
  const minutes = Math.ceil(waitMs / 60000);
  res.setHeader("Retry-After", String(Math.ceil(waitMs / 1000)));
  return res.status(429).json({
    error: `${message} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  });
}

// The one minimum length for every password the app accepts.
const MIN_PASSWORD_LENGTH = 8;

// Sends a 429 and returns true when any of the keys is locked. Used by the password routes.
function blockedByLimit(res, keys, message) {
  const waitMs = Math.max(...keys.map(lockRemainingMs));
  if (waitMs <= 0) return false;
  tooManyLoginsResponse(res, waitMs, message);
  return true;
}

app.post(
  "/api/login",
  ah(async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required." });
    }

    const accountKey = `account:${String(username).trim().toLowerCase()}`;
    const ipKey = `ip:${req.ip}`;
    const lockedFor = Math.max(lockRemainingMs(accountKey), lockRemainingMs(ipKey));
    if (lockedFor > 0) return tooManyLoginsResponse(res, lockedFor);

    // Find the account by username (case-insensitive), then check the password in code, so
    // older hashes and the new salted hashes are both handled.
    const [rows] = await pool.query(
      `SELECT id, username, role, display_name, email, email_verified_at, password_hash
       FROM users
       WHERE LOWER(username) = LOWER(?)
       LIMIT 1`,
      [String(username).trim()],
    );
    const user = rows[0];
    if (!user || !verifyPassword(user.password_hash, String(password))) {
      // Same message for a wrong username and a wrong password, so accounts cannot be guessed.
      recordLoginFailure(accountKey, LOGIN_MAX_FAILURES_PER_ACCOUNT);
      recordLoginFailure(ipKey, LOGIN_MAX_FAILURES_PER_IP);
      const nowLocked = Math.max(lockRemainingMs(accountKey), lockRemainingMs(ipKey));
      if (nowLocked > 0) return tooManyLoginsResponse(res, nowLocked);
      return res.status(401).json({ error: "Invalid login details." });
    }
    loginFailures.delete(accountKey);
    if (isLegacyPasswordHash(user.password_hash)) {
      await pool.query("UPDATE users SET password_hash=? WHERE id=?", [hashPassword(String(password)), user.id]);
    }

    await setUserSession(req, res, user.id);
    res.json({
      username: user.username,
      role: user.role,
      displayName: user.display_name || user.username,
      email: user.email || "",
      emailVerified: Boolean(user.email_verified_at),
      phone: "",
    });
  }),
);

// ---- Recovery email and password reset ----

// Current recovery email and whether it has been verified.
app.get(
  "/api/account/recovery-email",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor) return res.status(401).json({ error: "Sign in to see your recovery email." });
    const [[user]] = await pool.query("SELECT email, email_verified_at FROM users WHERE id=? LIMIT 1", [actor.id]);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ email: user.email || "", emailVerified: Boolean(user.email_verified_at) });
  }),
);

// Sets the recovery email for the signed-in user. It stays unverified until the code is entered.
app.put(
  "/api/account/recovery-email",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor) return res.status(401).json({ error: "Sign in to change your recovery email." });

    const { currentPassword, email: rawEmail } = req.body || {};
    const email = normalizeEmail(rawEmail);
    if (!email) return res.status(400).json({ error: "Enter a valid email address." });
    if (!currentPassword) return res.status(400).json({ error: "Enter your current password." });

    const [[user]] = await pool.query("SELECT id, password_hash FROM users WHERE id=? LIMIT 1", [actor.id]);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!verifyPassword(user.password_hash, String(currentPassword))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const [[taken]] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE LOWER(email)=? AND id<>? AND email_verified_at IS NOT NULL",
      [email, user.id],
    );
    if (taken.count > 0) {
      return res.status(409).json({ error: "That email is already used by another account." });
    }

    await pool.query("UPDATE users SET email=?, email_verified_at=NULL WHERE id=?", [email, user.id]);
    try {
      await issueCode(user.id, "verify_email", email);
    } catch (error) {
      return sendFailure(res, error, "Sending the verification email failed:");
    }
    res.json({ ok: true, email, emailVerified: false });
  }),
);

// Confirms the recovery email with the code that was emailed to it.
app.post(
  "/api/account/recovery-email/verify",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor) return res.status(401).json({ error: "Sign in to verify your recovery email." });

    const [[user]] = await pool.query("SELECT id, email FROM users WHERE id=? LIMIT 1", [actor.id]);
    if (!user || !user.email) return res.status(400).json({ error: "Add a recovery email first." });

    const result = await checkCode(user.id, "verify_email", user.email, req.body?.code);
    if (!result.ok) return res.status(400).json({ error: result.message });

    await pool.query("UPDATE users SET email_verified_at=NOW() WHERE id=?", [user.id]);
    res.json({ ok: true, email: user.email, emailVerified: true });
  }),
);

// Sends a reset code to a verified recovery email. The answer is the same whether or not
// the email belongs to an account, so the form cannot be used to find accounts.
app.post(
  "/api/password/forgot",
  ah(async (req, res) => {
    const generic = { ok: true, message: "If that email belongs to an account, a code has been sent." };
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.json(generic);

    // Every request sends an email, so limit how often one address or one IP can ask.
    const emailKey = `forgot:${email}`;
    const ipKey = `forgot-ip:${req.ip}`;
    if (blockedByLimit(res, [emailKey, ipKey], "Too many code requests.")) return;
    recordLoginFailure(emailKey, 3);
    recordLoginFailure(ipKey, 20);

    const [[user]] = await pool.query(
      "SELECT id FROM users WHERE LOWER(email)=? AND email_verified_at IS NOT NULL LIMIT 1",
      [email],
    );
    if (user) {
      try {
        await issueCode(user.id, "reset_password", email);
      } catch (error) {
        if (error?.status) return res.status(error.status).json({ error: error.message });
        console.error("Sending the reset code failed:", error?.message || error);
      }
    }
    res.json(generic);
  }),
);

// Sets a new password with the emailed code, and signs the account out everywhere.
app.post(
  "/api/password/reset",
  ah(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = req.body?.code;
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!email || !code) return res.status(400).json({ error: "Enter the email and the code we sent you." });
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "The new password must be at least 8 characters long." });
    }

    const emailKey = `reset:${email}`;
    const ipKey = `reset-ip:${req.ip}`;
    if (blockedByLimit(res, [emailKey, ipKey], "Too many reset attempts.")) return;
    recordLoginFailure(emailKey, 5);
    recordLoginFailure(ipKey, 30);

    const [[user]] = await pool.query(
      "SELECT id FROM users WHERE LOWER(email)=? AND email_verified_at IS NOT NULL LIMIT 1",
      [email],
    );
    if (!user) return res.status(400).json({ error: "The code is incorrect or has expired." });

    const result = await checkCode(user.id, "reset_password", email, code);
    if (!result.ok) return res.status(400).json({ error: result.message });

    await pool.query("UPDATE users SET password_hash=?, password_updated_at=NOW() WHERE id=?", [
      hashPassword(newPassword),
      user.id,
    ]);
    await endAllSessionsForUser(user.id);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/logout",
  ah(async (req, res) => {
    await clearUserSession(req, res);
    res.json({ ok: true });
  }),
);

/* ----------------------------- Inventory ---------------------------- */

const INVENTORY_COLUMNS =
  "id, name, category, barcode, quantity, price, rack, level, size, weight, demand, compatible_vehicles, image, ordering_cost, holding_cost, lead_time_days, safety_stock, discount, " +
  ITEM_DESCRIPTOR_COLUMNS.join(", ");

// One "?" per column in INVENTORY_COLUMNS.
const INVENTORY_PLACEHOLDERS = INVENTORY_COLUMNS.split(",").map(() => "?").join(", ");

function inventoryValues(id, item) {
  const price = Number(item.price) || 0;
  return [
    id,
    item.name,
    item.category,
    item.barcode || null,
    item.quantity || 0,
    price,
    item.rack || null,
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
    Math.min(100, Math.max(0, Number(item.discount) || 0)),
    ...ITEM_DESCRIPTOR_FIELDS.map(([field]) => (item[field] || "").toString().trim() || null),
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
    const item = {
      ...itemData,
      image: (await storeItemImage(itemData.image, imageFileName)) || undefined,
    };
    if (!item.name || !item.category) {
      return res
        .status(400)
        .json({ error: "Name and category are required." });
    }
    const itemId = normalizeItemId(item.id);
    if (!itemId) {
      return res.status(400).json({ error: "Item ID is required." });
    }
    // The signed-in user is recorded; the name sent by the browser is only a fallback.
    const actor = await getAuthenticatedUser(req);
    const createdBy = actor?.username || item.createdBy || "Unknown";

    const outcome = await withInventoryLock(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[sameId]] = await connection.query(
          "SELECT id FROM inventory WHERE id=? LIMIT 1",
          [itemId],
        );
        if (sameId) {
          await connection.rollback();
          const next = await nextFreeItemId(connection);
          return {
            status: 409,
            error: `Item ID ${itemId} is already used by another item. The next free ID is ${next}.`,
          };
        }
        await connection.query(
          `INSERT INTO inventory (${INVENTORY_COLUMNS})
           VALUES (${INVENTORY_PLACEHOLDERS})`,
          inventoryValues(itemId, item),
        );
        if (Number(item.quantity) > 0) {
          await recordStockLedger(connection, {
            sourceId: `BB-${itemId}`,
            itemId,
            type: "BEGINNING_BALANCE",
            reference: `BB-${itemId}`,
            description: "Opening balance",
            qtyIn: Number(item.quantity),
            balanceAfter: Number(item.quantity),
            recordedBy: createdBy,
          });
        }
        await connection.query(
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
        await connection.commit();
        return { status: 201 };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });

    if (outcome.status !== 201) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    res.status(201).json({ ...item, id: itemId, version: 0 });
  }),
);

// Makes a copy of an item under a new Item ID. The copy has no stock and no barcode, so its stock card starts empty.
// The duplication is written to the audit log.
app.post(
  "/api/inventory/:id/duplicate",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const sourceId = normalizeItemId(req.params.id);
    const newId = normalizeItemId(req.body?.newId);
    if (!newId) return res.status(400).json({ error: "Enter the Item ID for the copy." });

    const outcome = await withInventoryLock(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[source]] = await connection.query("SELECT * FROM inventory WHERE id=?", [sourceId]);
        if (!source) {
          await connection.rollback();
          return { status: 404, error: "Item not found." };
        }
        const [[taken]] = await connection.query("SELECT id FROM inventory WHERE id=?", [newId]);
        if (taken) {
          const next = await nextFreeItemId(connection);
          await connection.rollback();
          return { status: 409, error: `Item ID ${newId} is already used by another item. The next free ID is ${next}.` };
        }
        const copy = {
          ...toItem(source),
          id: newId,
          quantity: 0,
          barcode: undefined,
          version: 0,
        };
        await connection.query(
          `INSERT INTO inventory (${INVENTORY_COLUMNS}) VALUES (${INVENTORY_PLACEHOLDERS})`,
          inventoryValues(newId, copy),
        );
        await connection.query(
          "INSERT INTO inventory_audit (id, item_id, item_name, action, item_data, created_by) VALUES (?, ?, ?, ?, ?, ?)",
          [
            `AUDIT-DUP-${crypto.randomUUID()}`,
            newId,
            copy.name,
            "ADD",
            JSON.stringify({ ...copy, duplicatedFrom: sourceId }),
            actor.username,
          ],
        );
        await connection.commit();
        return { status: 201, id: newId };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });

    if (outcome.status !== 201) return res.status(outcome.status).json({ error: outcome.error });
    res.status(201).json({ id: outcome.id });
  }),
);

app.put(
  "/api/inventory/:id",
  ah(async (req, res) => {
    const { imageFileName, ...itemData } = req.body || {};
    const item = {
      ...itemData,
      image: (await storeItemImage(itemData.image, imageFileName)) || undefined,
    };
    const itemId = normalizeItemId(req.params.id);
    const submittedItemId = normalizeItemId(item.id || itemId);
    if (submittedItemId !== itemId) {
      return res.status(400).json({ error: "The Item ID cannot be changed. Duplicate the item to make one with a new ID." });
    }
    // The version the form was opened with. A save based on an older version would overwrite
    // someone else's change, so it is refused.
    const expectedVersion =
      item.version === undefined || item.version === null ? null : Number(item.version);
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const actorName = actor.username;
    const values = inventoryValues(itemId, item).slice(1); // drop id; it goes in WHERE

    const outcome = await withInventoryLock(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[current]] = await connection.query(
          "SELECT version, quantity, price, discount FROM inventory WHERE id=? FOR UPDATE",
          [itemId],
        );
        if (!current) {
          await connection.rollback();
          return { status: 404, error: "Item not found." };
        }
        if (expectedVersion !== null && Number(current.version) !== expectedVersion) {
          await connection.rollback();
          return {
            status: 409,
            error: "Someone else changed this item while you were editing it. Close the form, open the item again and make your change.",
          };
        }
        await connection.query(
          `UPDATE inventory SET name=?, category=?, barcode=?, quantity=?, price=?, rack=?, level=?, size=?, weight=?, demand=?, compatible_vehicles=?, image=?, ordering_cost=?, holding_cost=?, lead_time_days=?, safety_stock=?, discount=?, ${ITEM_DESCRIPTOR_COLUMNS.map((column) => `${column}=?`).join(", ")}, version = version + 1 WHERE id=?`,
          [...values, itemId],
        );
        const oldQuantity = Number(current.quantity);
        const newQuantity = Number(item.quantity) || 0;
        if (newQuantity !== oldQuantity) {
          await recordStockLedger(connection, {
            sourceId: `ADJ-${crypto.randomUUID()}`,
            itemId,
            type: "STOCK_ADJUSTMENT",
            reference: `ADJ-${Date.now().toString().slice(-8)}`,
            description: `Quantity changed from ${oldQuantity} to ${newQuantity}`,
            qtyIn: Math.max(0, newQuantity - oldQuantity),
            qtyOut: Math.max(0, oldQuantity - newQuantity),
            balanceAfter: newQuantity,
            recordedBy: actorName,
          });
          await connection.query(
            "INSERT INTO inventory_audit (id, item_id, item_name, action, item_data, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            [
              `AUDIT-QTY-${crypto.randomUUID()}`,
              itemId,
              item.name,
              "QTY",
              JSON.stringify({ oldQuantity, newQuantity, delta: newQuantity - oldQuantity }),
              actorName,
            ],
          );
        }
        const oldPrice = round2(Number(current.price));
        const newPrice = round2(Number(item.price) || 0);
        const oldDiscount = Number(current.discount) || 0;
        const newDiscount = Number(item.discount) || 0;
        if (oldPrice !== newPrice || oldDiscount !== newDiscount) {
          const parts = [];
          if (oldPrice !== newPrice) parts.push(`Price changed from ${oldPrice.toFixed(2)} to ${newPrice.toFixed(2)}`);
          if (oldDiscount !== newDiscount) parts.push(`Discount changed from ${oldDiscount}% to ${newDiscount}%`);
          const description = parts.join("; ");
          await recordStockLedger(connection, {
            sourceId: `PRICE-${crypto.randomUUID()}`,
            itemId,
            type: "PRICE_CHANGE",
            reference: `PRICE-${Date.now().toString().slice(-8)}`,
            description,
            qtyIn: 0,
            qtyOut: 0,
            balanceAfter: await currentItemQuantity(connection, itemId),
            recordedBy: actorName,
          });
          // A staff member's price change is recorded as a request that is approved at once, so the audit trail shows it.
          if (!isAdmin(actor)) {
            await recordChangeRequest(connection, {
              type: "PRICE_CHANGE", targetId: itemId, invoice: "", itemId, itemName: String(item.name || itemId),
              oldValue: oldPrice, newValue: newPrice, reason: description, requestedBy: actorName,
              status: "APPROVED", decidedBy: "Automatic", note: "Approved automatically; the change is audited.",
            });
          }
        }
        await connection.commit();
        return { status: 200, version: Number(current.version) + 1 };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });

    if (outcome.status !== 200) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    res.json({ ...item, id: submittedItemId, version: outcome.version });
  }),
);


// Deletes a stock movement and takes its stock back out. The stock card keeps the record.
async function applyMovementDelete(connection, movementId, actorName) {
  const [[movement]] = await connection.query("SELECT * FROM movements WHERE id=? FOR UPDATE", [movementId]);
  if (!movement) return { status: 404, error: "Movement not found" };
  const delta = movement.type === "IN" ? -movement.qty : movement.qty;
  await connection.query("DELETE FROM movements WHERE id=?", [movementId]);
  await connection.query(
    "UPDATE inventory SET quantity = GREATEST(0, quantity + ?), version = version + 1 WHERE id=?",
    [delta, movement.item_id],
  );
  await recordStockLedger(connection, {
    sourceId: `DEL-${movement.id}`,
    itemId: movement.item_id,
    type: "INVENTORY_CORRECTION",
    reference: movement.id,
    description: "Stock movement deleted",
    qtyIn: movement.type === "OUT" ? movement.qty : 0,
    qtyOut: movement.type === "IN" ? movement.qty : 0,
    balanceAfter: await currentItemQuantity(connection, movement.item_id),
    recordedBy: actorName,
  });
  return { status: 204 };
}

// Undoes part of a stock movement. The undone quantity is recorded on the stock card.
async function applyMovementUndo(connection, movementId, requestedQty, actorName) {
  if (!Number.isInteger(requestedQty) || requestedQty < 1) {
    return { status: 400, error: "Undo quantity must be a positive whole number." };
  }
  const [[movement]] = await connection.query("SELECT * FROM movements WHERE id=? FOR UPDATE", [movementId]);
  if (!movement) return { status: 404, error: "Movement not found" };
  if (requestedQty > movement.qty) {
    return { status: 400, error: "Undo quantity cannot exceed the movement quantity." };
  }
  const delta = movement.type === "IN" ? -requestedQty : requestedQty;
  const remainingQty = movement.qty - requestedQty;
  if (remainingQty === 0) {
    await connection.query("DELETE FROM movements WHERE id=?", [movementId]);
  } else {
    await connection.query("UPDATE movements SET qty=? WHERE id=?", [remainingQty, movementId]);
  }
  await connection.query(
    "UPDATE inventory SET quantity = GREATEST(0, quantity + ?), version = version + 1 WHERE id=?",
    [delta, movement.item_id],
  );
  await recordStockLedger(connection, {
    sourceId: `UNDO-${crypto.randomUUID()}`,
    itemId: movement.item_id,
    type: "INVENTORY_CORRECTION",
    reference: movement.id,
    description: `Undo of ${requestedQty} unit(s)`,
    qtyIn: movement.type === "OUT" ? requestedQty : 0,
    qtyOut: movement.type === "IN" ? requestedQty : 0,
    balanceAfter: await currentItemQuantity(connection, movement.item_id),
    recordedBy: actorName,
  });
  return { status: 200, deleted: remainingQty === 0, remainingQty, movement: { ...movement, qty: remainingQty } };
}

// Deletes an item and writes its delete to the audit log.
async function applyItemDelete(connection, itemId, actorName) {
  const [[item]] = await connection.query("SELECT * FROM inventory WHERE id=? FOR UPDATE", [itemId]);
  if (!item) return { status: 404, error: "Item not found." };
  await connection.query("DELETE FROM inventory WHERE id=?", [itemId]);
  await connection.query(
    "INSERT INTO inventory_audit (id, item_id, item_name, action, item_data, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    [`AUDIT-DELETE-${crypto.randomUUID()}`, itemId, item.name, "DELETE", JSON.stringify(toItem(item)), actorName],
  );
  return { status: 204 };
}

app.delete(
  "/api/movements/:id",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const id = cleanText(req.params.id, 64);
    if (!isAdmin(actor)) return sendForApproval(res, actor, "MOVEMENT_DELETE", id, cleanText(req.body?.reason, 255));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await applyMovementDelete(connection, id, actor.username);
      if (result.status !== 204) {
        await connection.rollback();
        return res.status(result.status).json({ error: result.error });
      }
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
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const id = cleanText(req.params.id, 64);
    const requestedQty = Number(req.body?.qty);
    if (!Number.isInteger(requestedQty) || requestedQty < 1) {
      return res.status(400).json({ error: "Undo quantity must be a positive whole number." });
    }
    if (!isAdmin(actor)) {
      return sendForApproval(res, actor, "MOVEMENT_UNDO", id, cleanText(req.body?.reason, 255), requestedQty);
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await applyMovementUndo(connection, id, requestedQty, actor.username);
      if (result.status !== 200) {
        await connection.rollback();
        return res.status(result.status).json({ error: result.error });
      }
      await connection.commit();
      if (result.deleted) return res.json({ deleted: true });
      res.json({ deleted: false, movement: toMovement(result.movement) });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.delete(
  "/api/inventory/:id",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const itemId = normalizeItemId(req.params.id);
    if (!isAdmin(actor)) return sendForApproval(res, actor, "ITEM_DELETE", itemId, cleanText(req.body?.reason, 255));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await applyItemDelete(connection, itemId, actor.username);
      if (result.status !== 204) {
        await connection.rollback();
        return res.status(result.status).json({ error: result.error });
      }
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
      } else if (audit.action === "QTY") {
        const change = quantityChangeOf(audit.item_data);
        if (!change) {
          await connection.rollback();
          return res.status(400).json({
            error: "This entry cannot be undone because its quantity details are unavailable.",
          });
        }
        const [result] = await connection.query(
          "UPDATE inventory SET quantity = GREATEST(0, quantity - ?), version = version + 1 WHERE id=?",
          [change.to - change.from, audit.item_id],
        );
        if (result.affectedRows === 0) {
          await connection.rollback();
          return res.status(404).json({ error: "Item not found." });
        }
        await recordStockLedger(connection, {
          sourceId: `UNDO-AUD-${audit.id}`,
          itemId: audit.item_id,
          type: "INVENTORY_CORRECTION",
          reference: audit.id,
          description: "Quantity change undone",
          qtyIn: change.to < change.from ? change.from - change.to : 0,
          qtyOut: change.to > change.from ? change.to - change.from : 0,
          balanceAfter: await currentItemQuantity(connection, audit.item_id),
        });
      } else {
        const item =
          typeof audit.item_data === "string"
            ? JSON.parse(audit.item_data)
            : audit.item_data;
        await connection.query(
          `INSERT INTO inventory (${INVENTORY_COLUMNS})
           VALUES (${INVENTORY_PLACEHOLDERS})`,
          inventoryValues(audit.item_id, item),
        );
        if (Number(item.quantity) > 0) {
          await recordStockLedger(connection, {
            sourceId: `BB-${audit.item_id}`,
            itemId: audit.item_id,
            type: "BEGINNING_BALANCE",
            reference: `BB-${audit.item_id}`,
            description: "Item restored, opening balance",
            qtyIn: Number(item.quantity),
            balanceAfter: Number(item.quantity),
          });
        }
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

/* ------------------- Stock card and suppliers (tables and helpers) ------------------- */

const STOCK_TXN_TYPES = [
  "BEGINNING_BALANCE",
  "STOCK_IN",
  "STOCK_OUT",
  "PURCHASE_RETURN",
  "CUSTOMER_RETURN",
  "STOCK_ADJUSTMENT",
  "DAMAGED_ITEMS",
  "INVENTORY_CORRECTION",
];

// Local time as "YYYY-MM-DD HH:MM:SS", so the stock card shows the time the warehouse recorded it.
function localDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function createStockCardTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_code VARCHAR(32) NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(120) NULL,
    contact_number VARCHAR(40) NULL,
    email VARCHAR(160) NULL,
    address TEXT NULL,
    notes TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ${tableOptions}`);

  // One row per supplier and item. The supplier's own code is unique within that supplier only.
  await pool.query(`CREATE TABLE IF NOT EXISTS supplier_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    item_id VARCHAR(32) NOT NULL,
    supplier_item_code VARCHAR(64) NOT NULL,
    purchase_price DECIMAL(12,2) NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_item_code (supplier_id, supplier_item_code),
    UNIQUE KEY uq_supplier_item (supplier_id, item_id),
    KEY idx_supplier_items_item (item_id),
    CONSTRAINT supplier_items_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    CONSTRAINT supplier_items_item_fk FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
  ) ${tableOptions}`);

  // Every change to an item's quantity is written here, in the same transaction as the change.
  // source_id is unique, so the same change can never be recorded twice.
  await pool.query(`CREATE TABLE IF NOT EXISTS stock_ledger (
    id VARCHAR(64) PRIMARY KEY,
    source_id VARCHAR(96) NOT NULL UNIQUE,
    item_id VARCHAR(32) NOT NULL,
    txn_date DATE NOT NULL,
    txn_time DATETIME NOT NULL,
    reference VARCHAR(64) NOT NULL,
    txn_type VARCHAR(32) NOT NULL,
    description VARCHAR(255) NULL,
    supplier_id INT NULL,
    qty_in INT NOT NULL DEFAULT 0,
    qty_out INT NOT NULL DEFAULT 0,
    balance_after INT NOT NULL,
    recorded_by VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_stock_ledger_item_time (item_id, txn_time),
    KEY idx_stock_ledger_reference (reference),
    CONSTRAINT stock_ledger_item_fk FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
  ) ${tableOptions}`);
}

// Writes one stock card line. Call it inside the transaction that changed the quantity.
async function recordStockLedger(connection, entry) {
  const when = entry.time ? new Date(entry.time) : new Date();
  await connection.query(
    `INSERT IGNORE INTO stock_ledger
      (id, source_id, item_id, txn_date, txn_time, reference, txn_type, description, supplier_id, qty_in, qty_out, balance_after, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `SL-${crypto.randomUUID()}`,
      entry.sourceId,
      entry.itemId,
      localDateTimeString(when).slice(0, 10),
      localDateTimeString(when),
      String(entry.reference).slice(0, 64),
      entry.type,
      entry.description ? String(entry.description).slice(0, 255) : null,
      entry.supplierId ?? null,
      Math.max(0, Number(entry.qtyIn) || 0),
      Math.max(0, Number(entry.qtyOut) || 0),
      Number(entry.balanceAfter) || 0,
      entry.recordedBy ? String(entry.recordedBy).slice(0, 64) : null,
    ],
  );
}

async function currentItemQuantity(connection, itemId) {
  const [[row]] = await connection.query("SELECT quantity FROM inventory WHERE id=?", [itemId]);
  return row ? Number(row.quantity) : 0;
}

// Runs once, when the stock card table is empty. It rebuilds each item's history from the
// movements and quantity changes that were already recorded, so existing items start with a full card.
async function backfillStockLedger() {
  const [[existing]] = await pool.query("SELECT COUNT(*) AS count FROM stock_ledger");
  if (existing.count > 0) return;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [items] = await connection.query("SELECT id, quantity FROM inventory");
    for (const item of items) {
      const [movements] = await connection.query(
        "SELECT id, type, qty, movement_date, created_at, created_by FROM movements WHERE item_id=?",
        [item.id],
      );
      const [audits] = await connection.query(
        "SELECT id, item_data, created_at FROM inventory_audit WHERE item_id=? AND action='QTY'",
        [item.id],
      );

      const events = [];
      for (const m of movements) {
        const qty = Number(m.qty) || 0;
        events.push({
          sourceId: m.id,
          time: new Date(m.created_at || m.movement_date),
          type: m.type === "IN" ? "STOCK_IN" : "STOCK_OUT",
          delta: m.type === "IN" ? qty : -qty,
          reference: m.id,
          recordedBy: m.created_by,
        });
      }
      for (const a of audits) {
        const data = typeof a.item_data === "string" ? JSON.parse(a.item_data) : a.item_data || {};
        const delta = Number(data.delta) || 0;
        if (!delta) continue;
        events.push({
          sourceId: `AUD-${a.id}`,
          time: new Date(a.created_at),
          type: "STOCK_ADJUSTMENT",
          delta,
          reference: a.id,
          recordedBy: data.recordedBy || null,
        });
      }
      events.sort((a, b) => a.time - b.time);

      const net = events.reduce((sum, e) => sum + e.delta, 0);
      const beginning = Number(item.quantity) - net;
      const firstTime = events.length ? new Date(events[0].time.getTime() - 1000) : new Date();
      await recordStockLedger(connection, {
        sourceId: `BB-${item.id}`,
        itemId: item.id,
        type: "BEGINNING_BALANCE",
        reference: `BB-${item.id}`,
        description: "Opening balance",
        qtyIn: Math.max(0, beginning),
        balanceAfter: beginning,
        recordedBy: "System",
        time: firstTime,
      });

      let running = beginning;
      for (const e of events) {
        running += e.delta;
        await recordStockLedger(connection, {
          sourceId: e.sourceId,
          itemId: item.id,
          type: e.type,
          reference: e.reference,
          description: e.type === "STOCK_ADJUSTMENT" ? "Quantity changed on item" : null,
          qtyIn: e.delta > 0 ? e.delta : 0,
          qtyOut: e.delta < 0 ? -e.delta : 0,
          balanceAfter: running,
          recordedBy: e.recordedBy,
          time: e.time,
        });
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/* ----------------------------- Stock card ---------------------------- */

const isIsoDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

app.get(
  "/api/items/:id/stock-card",
  ah(async (req, res) => {
    const itemId = normalizeItemId(req.params.id);
    const [[item]] = await pool.query("SELECT * FROM inventory WHERE id=?", [itemId]);
    if (!item) return res.status(404).json({ error: "Item not found." });

    const from = isIsoDate(req.query.from) ? req.query.from : "";
    const to = isIsoDate(req.query.to) ? req.query.to : "";
    const type = STOCK_TXN_TYPES.includes(req.query.type) ? req.query.type : "";
    const reference = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64).toLowerCase() : "";

    const [all] = await pool.query(
      `SELECT id, DATE_FORMAT(txn_date, '%Y-%m-%d') AS txn_date, DATE_FORMAT(txn_time, '%Y-%m-%d %H:%i:%s') AS txn_time,
              reference, txn_type, description, supplier_id, qty_in, qty_out, balance_after, recorded_by
       FROM stock_ledger WHERE item_id=? ORDER BY txn_time, created_at, id`,
      [itemId],
    );

    // Totals cover the whole history, whatever filter is applied to the table.
    const summary = { beginning: 0, totalIn: 0, totalOut: 0, adjustments: 0, balance: Number(item.quantity) };
    for (const row of all) {
      const qtyIn = Number(row.qty_in) || 0;
      const qtyOut = Number(row.qty_out) || 0;
      if (row.txn_type === "BEGINNING_BALANCE") summary.beginning += qtyIn - qtyOut;
      else if (row.txn_type === "STOCK_IN") summary.totalIn += qtyIn;
      else if (row.txn_type === "STOCK_OUT") summary.totalOut += qtyOut;
      else summary.adjustments += qtyIn - qtyOut;
    }
    if (all.length > 0) summary.balance = Number(all[all.length - 1].balance_after);

    const rows = all
      .filter((row) => (!from || row.txn_date >= from) && (!to || row.txn_date <= to))
      .filter((row) => !type || row.txn_type === type)
      .filter((row) => !reference || String(row.reference).toLowerCase().includes(reference))
      .map((row) => ({
        id: row.id,
        date: row.txn_date,
        time: row.txn_time,
        reference: row.reference,
        type: row.txn_type,
        description: row.description || "",
        supplierId: row.supplier_id ?? null,
        qtyIn: Number(row.qty_in) || 0,
        qtyOut: Number(row.qty_out) || 0,
        balance: Number(row.balance_after),
        recordedBy: row.recorded_by || "",
      }));

    res.json({
      item: toItem(item),
      summary,
      rows,
      types: STOCK_TXN_TYPES,
    });
  }),
);

/* ------------------------------ Suppliers ---------------------------- */

const SUPPLIER_STATUS_ACTIVE = 1;

function cleanSupplier(body) {
  const email = cleanText(body.email, 160);
  return {
    name: cleanText(body.name, 150),
    contactPerson: cleanText(body.contactPerson, 120) || null,
    contactNumber: cleanText(body.contactNumber, 40) || null,
    email: email || null,
    address: cleanText(body.address, 1000) || null,
    notes: cleanText(body.notes, 1000) || null,
    emailOk: !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  };
}

function toSupplier(row) {
  return {
    id: row.id,
    supplierId: row.supplier_code || `SUP-${String(row.id).padStart(4, "0")}`,
    name: row.name,
    contactPerson: row.contact_person || "",
    contactNumber: row.contact_number || "",
    email: row.email || "",
    address: row.address || "",
    notes: row.notes || "",
    isActive: Number(row.is_active) === SUPPLIER_STATUS_ACTIVE,
    itemCount: Number(row.item_count) || 0,
  };
}

function toSupplierItem(row) {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    itemId: row.item_id,
    supplierItemCode: row.supplier_item_code,
    purchasePrice: row.purchase_price === null || row.purchase_price === undefined ? null : Number(row.purchase_price),
    notes: row.notes || "",
    itemName: row.item_name,
    itemCategory: row.item_category,
    itemBarcode: row.item_barcode || "",
    itemPartNumber: row.item_part_number || "",
    itemQuantity: Number(row.item_quantity) || 0,
    itemUnit: row.item_unit || "PCS",
  };
}

app.get(
  "/api/suppliers",
  ah(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*, (SELECT COUNT(*) FROM supplier_items si WHERE si.supplier_id = s.id) AS item_count
       FROM suppliers s ORDER BY s.name`,
    );
    res.json(rows.map(toSupplier));
  }),
);

app.get(
  "/api/suppliers/:id",
  ah(async (req, res) => {
    const supplierId = toPositiveInt(req.params.id);
    if (!supplierId) return res.status(400).json({ error: "Invalid supplier." });
    const [[row]] = await pool.query(
      `SELECT s.*, (SELECT COUNT(*) FROM supplier_items si WHERE si.supplier_id = s.id) AS item_count
       FROM suppliers s WHERE s.id=?`,
      [supplierId],
    );
    if (!row) return res.status(404).json({ error: "Supplier not found." });
    const [items] = await pool.query(
      `SELECT si.*, i.name AS item_name, i.category AS item_category, i.barcode AS item_barcode,
              i.part_number AS item_part_number, i.quantity AS item_quantity, i.unit_of_measure AS item_unit
       FROM supplier_items si JOIN inventory i ON i.id = si.item_id
       WHERE si.supplier_id=? ORDER BY i.name`,
      [supplierId],
    );
    res.json({ ...toSupplier(row), items: items.map(toSupplierItem) });
  }),
);

app.post(
  "/api/suppliers",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const data = cleanSupplier(req.body || {});
    if (!data.name) return res.status(400).json({ error: "Supplier name is required." });
    if (!data.emailOk) return res.status(400).json({ error: "Enter a valid email address." });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        `INSERT INTO suppliers (name, contact_person, contact_number, email, address, notes, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.name, data.contactPerson, data.contactNumber, data.email, data.address, data.notes, SUPPLIER_STATUS_ACTIVE, actor.username],
      );
      const supplierCode = `SUP-${String(result.insertId).padStart(4, "0")}`;
      await connection.query("UPDATE suppliers SET supplier_code=? WHERE id=?", [supplierCode, result.insertId]);
      await connection.commit();
      res.status(201).json({ id: result.insertId, supplierId: supplierCode });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.put(
  "/api/suppliers/:id",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const supplierId = toPositiveInt(req.params.id);
    if (!supplierId) return res.status(400).json({ error: "Invalid supplier." });
    const data = cleanSupplier(req.body || {});
    if (!data.name) return res.status(400).json({ error: "Supplier name is required." });
    if (!data.emailOk) return res.status(400).json({ error: "Enter a valid email address." });
    const [result] = await pool.query(
      `UPDATE suppliers SET name=?, contact_person=?, contact_number=?, email=?, address=?, notes=? WHERE id=?`,
      [data.name, data.contactPerson, data.contactNumber, data.email, data.address, data.notes, supplierId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Supplier not found." });
    res.json({ ok: true });
  }),
);

app.patch(
  "/api/suppliers/:id/status",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const supplierId = toPositiveInt(req.params.id);
    if (!supplierId) return res.status(400).json({ error: "Invalid supplier." });
    const active = req.body?.isActive ? 1 : 0;
    const [result] = await pool.query("UPDATE suppliers SET is_active=? WHERE id=?", [active, supplierId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Supplier not found." });
    res.json({ ok: true, isActive: active === 1 });
  }),
);

// Suppliers linked to one inventory item, with each supplier's own code and price.
app.get(
  "/api/items/:id/suppliers",
  ah(async (req, res) => {
    const itemId = normalizeItemId(req.params.id);
    const [rows] = await pool.query(
      `SELECT si.*, s.name AS supplier_name, s.supplier_code, s.is_active,
              i.name AS item_name, i.category AS item_category, i.barcode AS item_barcode,
              i.part_number AS item_part_number, i.quantity AS item_quantity, i.unit_of_measure AS item_unit
       FROM supplier_items si
       JOIN suppliers s ON s.id = si.supplier_id
       JOIN inventory i ON i.id = si.item_id
       WHERE si.item_id=? ORDER BY s.name`,
      [itemId],
    );
    res.json(rows.map((row) => ({ ...toSupplierItem(row), supplierName: row.supplier_name, supplierCode: row.supplier_code, supplierActive: Number(row.is_active) === 1 })));
  }),
);

const cleanSupplierItem = (body) => ({
  supplierItemCode: cleanText(body.supplierItemCode, 64).toUpperCase(),
  purchasePrice:
    body.purchasePrice === "" || body.purchasePrice === null || body.purchasePrice === undefined
      ? null
      : Number(body.purchasePrice),
  notes: cleanText(body.notes, 255) || null,
});

app.post(
  "/api/suppliers/:id/items",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const supplierId = toPositiveInt(req.params.id);
    const itemId = normalizeItemId(req.body?.itemId);
    const data = cleanSupplierItem(req.body || {});
    if (!supplierId || !itemId) return res.status(400).json({ error: "Choose a supplier and an item." });
    if (!data.supplierItemCode) return res.status(400).json({ error: "Enter the supplier's item code." });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[supplier]] = await connection.query("SELECT id FROM suppliers WHERE id=?", [supplierId]);
      if (!supplier) {
        await connection.rollback();
        return res.status(404).json({ error: "Supplier not found." });
      }
      const [[item]] = await connection.query("SELECT id FROM inventory WHERE id=? FOR UPDATE", [itemId]);
      if (!item) {
        await connection.rollback();
        return res.status(404).json({ error: "Item not found." });
      }
      // A supplier item code belongs to one supplier only: no other supplier can use it.
      const [[sameCode]] = await connection.query(
        "SELECT id FROM supplier_items WHERE supplier_item_code=?",
        [data.supplierItemCode],
      );
      if (sameCode) {
        await connection.rollback();
        return res.status(409).json({ error: `The item code ${data.supplierItemCode} is already used by another supplier.` });
      }
      // One item has one supplier.
      const [[sameItem]] = await connection.query(
        "SELECT id FROM supplier_items WHERE item_id=?",
        [itemId],
      );
      if (sameItem) {
        await connection.rollback();
        return res.status(409).json({ error: "This item already has a supplier. One item can have only one supplier; remove its current link first." });
      }
      const [result] = await connection.query(
        "INSERT INTO supplier_items (supplier_id, item_id, supplier_item_code) VALUES (?, ?, ?)",
        [supplierId, itemId, data.supplierItemCode],
      );
      // The supplier's code becomes the Item ID, unless another item already has that ID.
      const renamed = await renameItemId(connection, itemId, normalizeItemId(data.supplierItemCode));
      await connection.commit();
      res.status(201).json({
        id: result.insertId,
        itemId: renamed.id,
        renamed: renamed.renamed,
        note: renamed.reason || null,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.put(
  "/api/supplier-items/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const linkId = toPositiveInt(req.params.id);
    const data = cleanSupplierItem(req.body || {});
    if (!linkId) return res.status(400).json({ error: "Invalid link." });
    if (!data.supplierItemCode) return res.status(400).json({ error: "Enter the supplier's item code." });
    if (data.purchasePrice !== null && (!Number.isFinite(data.purchasePrice) || data.purchasePrice < 0)) {
      return res.status(400).json({ error: "Purchase price must be zero or more." });
    }
    const [[link]] = await pool.query("SELECT supplier_id FROM supplier_items WHERE id=?", [linkId]);
    if (!link) return res.status(404).json({ error: "Link not found." });
    const [[sameCode]] = await pool.query(
      "SELECT id FROM supplier_items WHERE supplier_item_code=? AND id<>?",
      [data.supplierItemCode, linkId],
    );
    if (sameCode) {
      return res.status(409).json({ error: `The item code ${data.supplierItemCode} is already used by another supplier.` });
    }
    await pool.query(
      "UPDATE supplier_items SET supplier_item_code=?, purchase_price=?, notes=? WHERE id=?",
      [data.supplierItemCode, data.purchasePrice, data.notes, linkId],
    );
    res.json({ ok: true });
  }),
);

// Removes the link only. The inventory item and its stock card are not touched.
app.delete(
  "/api/supplier-items/:id",
  ah(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const linkId = toPositiveInt(req.params.id);
    if (!linkId) return res.status(400).json({ error: "Invalid link." });
    const [result] = await pool.query("DELETE FROM supplier_items WHERE id=?", [linkId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Link not found." });
    res.status(204).end();
  }),
);

// Short letters from the supplier name, used at the start of its item codes: "VISCO" gives "VIS".
function supplierCodePrefix(name) {
  const letters = String(name || "").toUpperCase().replace(/[^A-Z]/g, "");
  return letters.slice(0, 3) || "SUP";
}

// The next free code for a supplier: VIS0001, then VIS0002, and so on, after the highest one used.
app.get(
  "/api/suppliers/:id/next-code",
  ah(async (req, res) => {
    const supplierId = toPositiveInt(req.params.id);
    if (!supplierId) return res.status(400).json({ error: "Invalid supplier." });
    const [[supplier]] = await pool.query("SELECT name FROM suppliers WHERE id=?", [supplierId]);
    if (!supplier) return res.status(404).json({ error: "Supplier not found." });
    const prefix = supplierCodePrefix(supplier.name);
    // Numbering continues across all suppliers, so a code is never handed out twice.
    const [rows] = await pool.query(
      "SELECT supplier_item_code FROM supplier_items WHERE supplier_item_code LIKE ?",
      [`${prefix}%`],
    );
    const pattern = new RegExp(`^${prefix}(\\d+)$`);
    let highest = 0;
    for (const row of rows) {
      const match = pattern.exec(row.supplier_item_code);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    res.json({ code: `${prefix}${String(highest + 1).padStart(4, "0")}` });
  }),
);

// Moves an item to a new Item ID, with every record that refers to it, in the caller's transaction.
// Returns renamed: false, with a reason, when the new ID is already used by another item.
async function renameItemId(connection, oldId, newId) {
  if (newId === oldId) return { id: oldId, renamed: false };
  const [[taken]] = await connection.query("SELECT id FROM inventory WHERE id=?", [newId]);
  if (taken) {
    return { id: oldId, renamed: false, reason: `Item ID ${newId} is already used by another item, so the Item ID was not changed.` };
  }
  // The item ID is a key that other tables refer to; SET FOREIGN_KEY_CHECKS lets them move together.
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    await connection.query("UPDATE inventory SET id=?, version = version + 1 WHERE id=?", [newId, oldId]);
    await connection.query("UPDATE movements SET item_id=? WHERE item_id=?", [newId, oldId]);
    await connection.query("UPDATE inventory_audit SET item_id=? WHERE item_id=?", [newId, oldId]);
    await connection.query("UPDATE stock_ledger SET item_id=? WHERE item_id=?", [newId, oldId]);
    await connection.query("UPDATE supplier_items SET item_id=? WHERE item_id=?", [newId, oldId]);
    await connection.query("UPDATE sales SET item_id=? WHERE item_id=?", [newId, oldId]);
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  return { id: newId, renamed: true };
}

// Makes one of the item's supplier codes its Skyrun Item ID (admin, from the stock card).
app.post(
  "/api/items/:id/use-supplier-code",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const oldId = normalizeItemId(req.params.id);
    const newId = normalizeItemId(req.body?.newId);
    if (!newId) return res.status(400).json({ error: "Choose the supplier code to use as the Item ID." });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[item]] = await connection.query("SELECT id FROM inventory WHERE id=? FOR UPDATE", [oldId]);
      if (!item) {
        await connection.rollback();
        return res.status(404).json({ error: "Item not found." });
      }
      const [[link]] = await connection.query(
        "SELECT id FROM supplier_items WHERE item_id=? AND supplier_item_code=?",
        [oldId, newId],
      );
      if (!link) {
        await connection.rollback();
        return res.status(400).json({ error: "That code is not one of this item's supplier codes. Link the supplier first." });
      }
      const result = await renameItemId(connection, oldId, newId);
      if (!result.renamed) {
        await connection.rollback();
        return res.status(409).json({ error: result.reason || "The Item ID was not changed." });
      }
      await connection.commit();
      res.json({ id: result.id });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

// The suppliers linked to each inventory item, for the Inventory list.
app.get(
  "/api/supplier-links/counts",
  ah(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT si.item_id, s.name, si.supplier_item_code
       FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id
       ORDER BY s.name`,
    );
    const byItem = {};
    for (const row of rows) {
      const entry = byItem[row.item_id] || (byItem[row.item_id] = { count: 0, suppliers: [] });
      entry.count += 1;
      entry.suppliers.push({ name: row.name, code: row.supplier_item_code });
    }
    res.json(byItem);
  }),
);

/* ----------------------- Sales and profit (stock-out with price) ----------------------- */

// Each sale stores the cost and selling price as they were at the time, so later price
// changes never alter a past sale.
async function createSalesTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sales (
    id VARCHAR(100) PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL,
    movement_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(32) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    total_cost DECIMAL(14,2) NOT NULL,
    total_sales DECIMAL(14,2) NOT NULL,
    gross_profit DECIMAL(14,2) NOT NULL,
    customer VARCHAR(150) NULL,
    reference VARCHAR(64) NOT NULL,
    txn_date DATE NOT NULL,
    txn_time DATETIME NOT NULL,
    recorded_by VARCHAR(64) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_sales_batch (batch_id),
    KEY idx_sales_date (txn_date),
    KEY idx_sales_item (item_id),
    KEY idx_sales_reference (reference),
    KEY idx_sales_movement (movement_id)
  ) ${tableOptions}`);
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const localDateString = (date) => localDateTimeString(date).slice(0, 10);

/* ------------------------ Stock-out sales (invoice only) ------------------------ */

// A sale is walk-in: only the invoice number and the lines are recorded. Each line keeps its cost and selling price.
app.post(
  "/api/sales",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor) return res.status(401).json({ error: "Sign in to record a sale." });

    const body = req.body || {};
    const batchId = cleanText(body.batchId, 64);
    const reference = cleanText(body.reference, 64);
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (!batchId) return res.status(400).json({ error: "Missing sale batch ID." });
    if (!reference) return res.status(400).json({ error: "Enter the invoice number." });
    if (rawLines.length === 0 || rawLines.length > 100) {
      return res.status(400).json({ error: "Add between 1 and 100 items to the sale." });
    }
    const lines = rawLines.map((line) => ({
      itemId: normalizeItemId(line?.itemId),
      quantity: Number(line?.quantity),
      unitPrice: Number(line?.unitPrice),
    }));
    for (const line of lines) {
      if (!line.itemId) return res.status(400).json({ error: "Every line needs an item." });
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        return res.status(400).json({ error: "Quantity must be a positive whole number." });
      }
      if (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0) {
        return res.status(400).json({ error: "Enter a selling price above zero for every item." });
      }
    }

    const outcome = await withInventoryLock(async (connection) => {
      await connection.beginTransaction();
      try {
        // The same sale sent twice (for example after a timeout) is recorded once.
        const [[already]] = await connection.query("SELECT id FROM sales WHERE batch_id=? LIMIT 1", [batchId]);
        if (already) {
          await connection.rollback();
          return { status: 200, duplicate: true };
        }
        const now = new Date();
        const saved = [];
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const [[item]] = await connection.query(
            "SELECT id, name, part_number, price, discount, quantity FROM inventory WHERE id=? FOR UPDATE",
            [line.itemId],
          );
          if (!item) {
            await connection.rollback();
            return { status: 404, error: `Item ${line.itemId} was not found.` };
          }
          if (line.quantity > Number(item.quantity)) {
            await connection.rollback();
            return { status: 400, error: `Only ${item.quantity} unit(s) of ${item.name} are on hand.` };
          }
          // Cost is the purchase price less the supplier discount, the same figure the stock sheet shows.
          const unitCost = round2(Number(item.price) * (1 - Math.min(100, Math.max(0, Number(item.discount) || 0)) / 100));
          const totalSales = round2(line.quantity * line.unitPrice);
          const totalCost = round2(line.quantity * unitCost);
          const grossProfit = round2(totalSales - totalCost);
          const movementId = `MOV-${crypto.randomUUID()}`;

          await connection.query(
            "UPDATE inventory SET quantity = quantity - ?, version = version + 1 WHERE id=?",
            [line.quantity, line.itemId],
          );
          await connection.query(
            "INSERT INTO movements (id, item_id, type, qty, movement_date, reference, created_by) VALUES (?, ?, 'OUT', ?, ?, ?, ?)",
            [movementId, line.itemId, line.quantity, localDateString(now), reference, actor.username],
          );
          await recordStockLedger(connection, {
            sourceId: movementId,
            itemId: line.itemId,
            type: "STOCK_OUT",
            reference,
            description: "Sale",
            qtyOut: line.quantity,
            balanceAfter: await currentItemQuantity(connection, line.itemId),
            recordedBy: actor.username,
            time: now,
          });
          await connection.query(
            `INSERT INTO sales (id, batch_id, movement_id, item_id, item_name, part_number, quantity, unit_cost, unit_price,
               total_cost, total_sales, gross_profit, customer, reference, txn_date, txn_time, recorded_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'COMPLETED')`,
            [
              `${batchId}-${index + 1}`, batchId, movementId, line.itemId, item.name, item.part_number || null,
              line.quantity, unitCost, round2(line.unitPrice), totalCost, totalSales, grossProfit,
              reference, localDateString(now), localDateTimeString(now), actor.username,
            ],
          );
          saved.push({ itemId: line.itemId, quantity: line.quantity, totalSales, totalCost, grossProfit });
        }
        await connection.commit();
        return { status: 201, lines: saved };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });

    if (outcome.status === 200 && outcome.duplicate) return res.status(200).json({ duplicate: true });
    if (outcome.status !== 201) return res.status(outcome.status).json({ error: outcome.error });
    res.status(201).json({ id: batchId, lines: outcome.lines });
  }),
);

// Admin reports. Staff can record sales but cannot read the totals.
const SALES_DATE = (value) => (isIsoDate(value) ? value : "");

function salesRangeWhere(query) {
  const from = SALES_DATE(query.from);
  const to = SALES_DATE(query.to);
  const clauses = ["status = 'COMPLETED'"];
  const params = [];
  if (from) {
    clauses.push("txn_date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("txn_date <= ?");
    params.push(to);
  }
  return { where: clauses.join(" AND "), params };
}

app.get(
  "/api/sales/summary",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const now = new Date();
    const today = localDateString(now);
    const yesterday = localDateString(new Date(now.getTime() - 86400000));
    const monthStart = `${today.slice(0, 7)}-01`;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const floor = [yesterday, yearStart].sort()[0];

    const periods = {
      today: ["txn_date = ?", [today]],
      yesterday: ["txn_date = ?", [yesterday]],
      month: ["txn_date >= ?", [monthStart]],
      year: ["txn_date >= ?", [yearStart]],
    };
    const columns = [];
    const params = [];
    for (const [key, [condition, values]] of Object.entries(periods)) {
      columns.push(
        `COALESCE(SUM(CASE WHEN ${condition} THEN total_sales END), 0) AS ${key}_sales`,
        `COALESCE(SUM(CASE WHEN ${condition} THEN gross_profit END), 0) AS ${key}_profit`,
        `COALESCE(SUM(CASE WHEN ${condition} THEN total_cost END), 0) AS ${key}_cogs`,
        `COALESCE(SUM(CASE WHEN ${condition} THEN quantity END), 0) AS ${key}_qty`,
      );
      params.push(...values, ...values, ...values, ...values);
    }
    const [[totals]] = await pool.query(
      `SELECT ${columns.join(", ")} FROM sales WHERE status = 'COMPLETED' AND txn_date >= ?`,
      [...params, floor],
    );
    // Stock-outs recorded before sales tracking have no selling price. They are counted, not guessed.
    const [[unrecorded]] = await pool.query(
      `SELECT COUNT(*) AS count FROM movements m
       WHERE m.type = 'OUT' AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.movement_id = m.id)`,
    );

    const period = (key) => {
      const sales = Number(totals[`${key}_sales`]) || 0;
      const profit = Number(totals[`${key}_profit`]) || 0;
      return {
        sales: round2(sales),
        cogs: round2(totals[`${key}_cogs`]),
        profit: round2(profit),
        units: Number(totals[`${key}_qty`]) || 0,
        margin: sales > 0 ? round2((profit / sales) * 100) : 0,
      };
    };
    res.json({
      today: period("today"),
      yesterday: period("yesterday"),
      month: period("month"),
      year: period("year"),
      unrecordedStockOuts: Number(unrecorded.count) || 0,
    });
  }),
);

app.get(
  "/api/sales/series",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const granularity = ["day", "month", "year"].includes(req.query.granularity) ? req.query.granularity : "day";
    const format = { day: "%Y-%m-%d", month: "%Y-%m", year: "%Y" }[granularity];
    const { where, params } = salesRangeWhere(req.query);
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(txn_date, ?) AS period, SUM(total_sales) AS sales, SUM(total_cost) AS cogs,
              SUM(gross_profit) AS profit, SUM(quantity) AS units
       FROM sales WHERE ${where}
       GROUP BY period ORDER BY period LIMIT 400`,
      [format, ...params],
    );
    res.json(
      rows.map((row) => ({
        period: row.period,
        sales: round2(row.sales),
        cogs: round2(row.cogs),
        profit: round2(row.profit),
        units: Number(row.units) || 0,
      })),
    );
  }),
);

app.get(
  "/api/sales/top-items",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const { where, params } = salesRangeWhere(req.query);
    const [rows] = await pool.query(
      `SELECT item_id, MAX(item_name) AS item_name, SUM(quantity) AS units, SUM(total_sales) AS sales,
              SUM(gross_profit) AS profit
       FROM sales WHERE ${where}
       GROUP BY item_id ORDER BY units DESC, sales DESC LIMIT 10`,
      params,
    );
    res.json(
      rows.map((row) => ({
        itemId: row.item_id,
        itemName: row.item_name,
        units: Number(row.units) || 0,
        sales: round2(row.sales),
        profit: round2(row.profit),
      })),
    );
  }),
);

const saleRow = (row) => ({
  id: row.id,
  date: row.txn_date_str,
  time: row.txn_time_str,
  reference: row.reference,
  customer: row.customer || "",
  itemId: row.item_id,
  itemName: row.item_name,
  quantity: Number(row.quantity) || 0,
  unitCost: round2(row.unit_cost),
  unitPrice: round2(row.unit_price),
  totalCost: round2(row.total_cost),
  totalSales: round2(row.total_sales),
  grossProfit: round2(row.gross_profit),
  recordedBy: row.recorded_by || "",
});

app.get(
  "/api/sales",
  ah(async (req, res) => {
    if (!(await requireSignedIn(req, res))) return;
    const { where, params } = salesRangeWhere(req.query);
    const clauses = [where];
    const extra = [...params];
    const item = typeof req.query.item === "string" ? req.query.item.trim().slice(0, 64) : "";
    const user = typeof req.query.user === "string" ? req.query.user.trim().slice(0, 64) : "";
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64) : "";
    if (item) {
      clauses.push("(item_id = ? OR item_name LIKE ?)");
      extra.push(normalizeItemId(item), `%${item}%`);
    }
    if (user) {
      clauses.push("recorded_by = ?");
      extra.push(user);
    }
    if (search) {
      clauses.push("(reference LIKE ? OR customer LIKE ? OR item_name LIKE ? OR item_id = ?)");
      extra.push(`%${search}%`, `%${search}%`, `%${search}%`, search);
    }
    const [rows] = await pool.query(
      `SELECT id, DATE_FORMAT(txn_date, '%Y-%m-%d') AS txn_date_str, DATE_FORMAT(txn_time, '%Y-%m-%d %H:%i:%s') AS txn_time_str,
              reference, customer, item_id, item_name, quantity, unit_cost, unit_price, total_cost, total_sales,
              gross_profit, recorded_by
       FROM sales WHERE ${clauses.join(" AND ")}
       ORDER BY txn_time DESC, id DESC LIMIT 500`,
      extra,
    );
    res.json(rows.map(saleRow));
  }),
);

/* ----------------------------- Movements ---------------------------- */

// Stock in, grouped by invoice number, newest first.
app.get(
  "/api/stock-in/invoices",
  ah(async (req, res) => {
    if (!(await getAuthenticatedUser(req))) return res.status(401).json({ error: "Sign in to view stock in." });
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64) : "";
    const params = [];
    let filter = "";
    const from = isIsoDate(req.query.from) ? req.query.from : "";
    const to = isIsoDate(req.query.to) ? req.query.to : "";
    if (from) { filter += " AND m.movement_date >= ?"; params.push(from); }
    if (to) { filter += " AND m.movement_date <= ?"; params.push(to); }
    if (q) {
      filter += " AND (m.reference LIKE ? OR i.name LIKE ? OR m.item_id = ? OR s.name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, normalizeItemId(q), `%${q}%`);
    }
    const item = typeof req.query.item === "string" ? req.query.item.trim().slice(0, 64) : "";
    if (item) {
      filter += " AND (i.name LIKE ? OR m.item_id = ?)";
      params.push(`%${item}%`, normalizeItemId(item));
    }
    const user = typeof req.query.user === "string" ? req.query.user.trim().slice(0, 64) : "";
    if (user) {
      filter += " AND m.created_by = ?";
      params.push(user);
    }
    const supplier = toPositiveInt(req.query.supplier);
    if (supplier) {
      filter += " AND m.supplier_id = ?";
      params.push(supplier);
    }
    const [rows] = await pool.query(
      `SELECT COALESCE(m.reference, '') AS reference, MAX(s.name) AS supplier_name, MAX(m.supplier_id) AS supplier_id,
              DATE_FORMAT(MIN(m.movement_date), '%Y-%m-%d') AS date_str,
              DATE_FORMAT(MAX(m.created_at), '%Y-%m-%d %H:%i') AS last_str,
              COUNT(*) AS line_count, COALESCE(SUM(m.qty), 0) AS total_qty, MIN(m.created_by) AS recorded_by
       FROM movements m
       JOIN inventory i ON i.id = m.item_id
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.type = 'IN'${filter}
       GROUP BY COALESCE(m.reference, '')
       ORDER BY MAX(m.created_at) DESC
       LIMIT 200`,
      params,
    );
    res.json(
      rows.map((r) => ({
        reference: r.reference,
        supplier: r.supplier_name || "",
        supplierId: r.supplier_id ?? null,
        date: r.date_str,
        lastRecorded: r.last_str,
        lineCount: Number(r.line_count) || 0,
        totalQty: Number(r.total_qty) || 0,
        recordedBy: r.recorded_by || "",
      })),
    );
  }),
);

// One invoice with its lines (items). An empty reference means stock in recorded before invoice numbers.
app.get(
  "/api/stock-in/invoice",
  ah(async (req, res) => {
    if (!(await getAuthenticatedUser(req))) return res.status(401).json({ error: "Sign in to view stock in." });
    const reference = cleanText(req.query.ref, 64);
    const [rows] = await pool.query(
      `SELECT m.id, m.item_id, i.name AS item_name, i.part_number, i.unit_of_measure, m.qty,
              DATE_FORMAT(m.movement_date, '%Y-%m-%d') AS date_str, DATE_FORMAT(m.created_at, '%H:%i') AS time_str,
              m.created_by, m.supplier_id, s.name AS supplier_name
       FROM movements m
       JOIN inventory i ON i.id = m.item_id
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.type = 'IN' AND COALESCE(m.reference, '') = ?
       ORDER BY m.created_at, m.id`,
      [reference],
    );
    res.json({
      reference,
      supplier: rows[0]?.supplier_name || "",
      supplierId: rows[0]?.supplier_id ?? null,
      date: rows[0]?.date_str || "",
      lines: rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        itemName: r.item_name,
        partNumber: r.part_number || "",
        unit: r.unit_of_measure || "PCS",
        qty: Number(r.qty) || 0,
        time: r.time_str,
        recordedBy: r.created_by || "",
      })),
    });
  }),
);

// Changes the stock-in line quantity by the difference. Shared by a direct admin edit and an approved request.
async function setStockInLineQty(connection, lineId, newQty, actorName) {
  const [[line]] = await connection.query(
    "SELECT id, item_id, qty, reference FROM movements WHERE id=? AND type='IN' FOR UPDATE",
    [lineId],
  );
  if (!line) return { status: 404, error: "Stock-in line not found." };
  const oldQty = Number(line.qty);
  const diff = newQty - oldQty;
  if (diff === 0) return { status: 200, qty: oldQty };
  const [[inv]] = await connection.query("SELECT quantity FROM inventory WHERE id=? FOR UPDATE", [line.item_id]);
  if (!inv) return { status: 404, error: "Item not found." };
  if (Number(inv.quantity) + diff < 0) {
    return { status: 400, error: "This change would make the stock on hand negative." };
  }
  await connection.query("UPDATE inventory SET quantity = quantity + ?, version = version + 1 WHERE id=?", [diff, line.item_id]);
  await connection.query("UPDATE movements SET qty=? WHERE id=?", [newQty, line.id]);
  await recordStockLedger(connection, {
    sourceId: `EDIT-${line.id}-${crypto.randomUUID()}`,
    itemId: line.item_id,
    type: "INVENTORY_CORRECTION",
    reference: line.reference || line.id,
    description: `Stock-in line changed from ${oldQty} to ${newQty}`,
    qtyIn: diff > 0 ? diff : 0,
    qtyOut: diff < 0 ? -diff : 0,
    balanceAfter: Number(inv.quantity) + diff,
    recordedBy: actorName,
  });
  return { status: 200, qty: newQty };
}

// Removes a stock-in line and takes its stock back out. The stock card keeps the removal.
async function removeStockInLine(connection, lineId, actorName) {
  const [[line]] = await connection.query(
    "SELECT id, item_id, qty, reference FROM movements WHERE id=? AND type='IN' FOR UPDATE",
    [lineId],
  );
  if (!line) return { status: 404, error: "Stock-in line not found." };
  const qty = Number(line.qty);
  const [[inv]] = await connection.query("SELECT quantity FROM inventory WHERE id=? FOR UPDATE", [line.item_id]);
  if (!inv) return { status: 404, error: "Item not found." };
  if (Number(inv.quantity) - qty < 0) {
    return { status: 400, error: "Removing this line would make the stock on hand negative." };
  }
  await connection.query("UPDATE inventory SET quantity = quantity - ?, version = version + 1 WHERE id=?", [qty, line.item_id]);
  await connection.query("DELETE FROM movements WHERE id=?", [line.id]);
  await recordStockLedger(connection, {
    sourceId: `DELSI-${line.id}`,
    itemId: line.item_id,
    type: "INVENTORY_CORRECTION",
    reference: line.reference || line.id,
    description: `Stock-in line of ${qty} removed`,
    qtyOut: qty,
    balanceAfter: Number(inv.quantity) - qty,
    recordedBy: actorName,
  });
  return { status: 200, qty };
}

async function recordChangeRequest(connection, entry) {
  await connection.query(
    `INSERT INTO change_requests (id, request_type, target_id, invoice, item_id, item_name, old_value, new_value, reason,
       requested_by, status, decided_by, decided_at, decision_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `CR-${crypto.randomUUID()}`, entry.type, entry.targetId, entry.invoice || "", entry.itemId, entry.itemName,
      entry.oldValue ?? null, entry.newValue ?? null, entry.reason || null, entry.requestedBy, entry.status,
      entry.decidedBy || null, entry.status === "PENDING" ? null : localDateTimeString(new Date()),
      entry.note || null,
    ],
  );
}

// A staff member's quantity change waits for an admin. An admin's change is made straight away.
app.patch(
  "/api/stock-in/lines/:id",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const lineId = cleanText(req.params.id, 64);
    const newQty = Number(req.body?.qty);
    if (!Number.isInteger(newQty) || newQty < 1) {
      return res.status(400).json({ error: "Quantity must be a positive whole number." });
    }
    if (!isAdmin(actor)) {
      const [[line]] = await pool.query(
        `SELECT m.id, m.item_id, m.qty, m.reference, i.name AS item_name
         FROM movements m JOIN inventory i ON i.id = m.item_id WHERE m.id=? AND m.type='IN'`,
        [lineId],
      );
      if (!line) return res.status(404).json({ error: "Stock-in line not found." });
      if (Number(line.qty) === newQty) return res.json({ id: lineId, qty: newQty, requested: false });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await recordChangeRequest(connection, {
          type: "STOCK_IN_EDIT", targetId: line.id, invoice: line.reference || "", itemId: line.item_id,
          itemName: line.item_name, oldValue: Number(line.qty), newValue: newQty, requestedBy: actor.username,
          status: "PENDING",
        });
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      return res.status(202).json({ id: lineId, requested: true });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await setStockInLineQty(connection, lineId, newQty, actor.username);
      if (result.status !== 200) {
        await connection.rollback();
        return res.status(result.status).json({ error: result.error });
      }
      await connection.commit();
      res.json({ id: lineId, qty: result.qty, requested: false });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

// Deleting a stock-in line is for admins only.
app.delete(
  "/api/stock-in/lines/:id",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const lineId = cleanText(req.params.id, 64);
    if (!isAdmin(actor)) return sendForApproval(res, actor, "STOCK_IN_DELETE", lineId, cleanText(req.body?.reason, 255));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[line]] = await connection.query(
        "SELECT id, item_id, qty, reference FROM movements WHERE id=? AND type='IN'", [lineId],
      );
      const [[item]] = line
        ? await connection.query("SELECT name FROM inventory WHERE id=?", [line.item_id])
        : [[null]];
      const result = await removeStockInLine(connection, lineId, actor.username);
      if (result.status !== 200) {
        await connection.rollback();
        return res.status(result.status).json({ error: result.error });
      }
      await recordChangeRequest(connection, {
        type: "STOCK_IN_DELETE", targetId: line.id, invoice: line.reference || "", itemId: line.item_id,
        itemName: item?.name || line.item_id, oldValue: Number(line.qty), newValue: 0,
        requestedBy: actor.username, decidedBy: actor.username, status: "APPROVED",
      });
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

// Deletes a whole invoice (all its stock-in lines). Admins only.
app.delete(
  "/api/stock-in/invoice",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const reference = cleanText(req.query.ref, 64);
    if (!isAdmin(actor)) return sendForApproval(res, actor, "INVOICE_DELETE", reference, cleanText(req.body?.reason, 255));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lines] = await connection.query(
        `SELECT m.id, m.item_id, m.qty, m.reference, i.name AS item_name
         FROM movements m JOIN inventory i ON i.id = m.item_id
         WHERE m.type='IN' AND COALESCE(m.reference, '') = ? FOR UPDATE`,
        [reference],
      );
      if (lines.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "No stock-in lines on this invoice." });
      }
      for (const line of lines) {
        const result = await removeStockInLine(connection, line.id, actor.username);
        if (result.status !== 200) {
          await connection.rollback();
          return res.status(result.status).json({ error: result.error });
        }
        await recordChangeRequest(connection, {
          type: "INVOICE_DELETE", targetId: line.id, invoice: reference, itemId: line.item_id,
          itemName: line.item_name, oldValue: Number(line.qty), newValue: 0,
          requestedBy: actor.username, decidedBy: actor.username, status: "APPROVED",
        });
      }
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

// Requests: the list is the audit trail; approving and rejecting is for admins.
app.get(
  "/api/change-requests",
  ah(async (req, res) => {
    const actor = await requireSignedIn(req, res);
    if (!actor) return;
    const status = ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status) ? req.query.status : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64) : "";
    const clauses = ["1 = 1"];
    const params = [];
    if (actor.role !== "admin") {
      clauses.push("requested_by = ?");
      params.push(actor.username);
    }
    if (status) { clauses.push("status = ?"); params.push(status); }
    if (q) {
      clauses.push("(invoice LIKE ? OR item_name LIKE ? OR item_id = ? OR requested_by LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, normalizeItemId(q), `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT id, request_type, invoice, item_id, item_name, old_value, new_value, reason, requested_by,
              DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i') AS requested_str, status, decided_by,
              DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i') AS decided_str, decision_note
       FROM change_requests WHERE ${clauses.join(" AND ")}
       ORDER BY requested_at DESC LIMIT 300`,
      params,
    );
    res.json(rows.map((r) => ({
      id: r.id, type: r.request_type, invoice: r.invoice, itemId: r.item_id, itemName: r.item_name,
      oldValue: r.old_value === null ? null : Number(r.old_value),
      newValue: r.new_value === null ? null : Number(r.new_value),
      reason: r.reason || "", requestedBy: r.requested_by,
      requestedAt: r.requested_str, status: r.status, decidedBy: r.decided_by || "", decidedAt: r.decided_str || "",
      note: r.decision_note || "",
    })));
  }),
);

app.post(
  "/api/change-requests/:id/approve",
  ah(async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const id = cleanText(req.params.id, 64);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[request]] = await connection.query("SELECT * FROM change_requests WHERE id=? FOR UPDATE", [id]);
      if (!request) {
        await connection.rollback();
        return res.status(404).json({ error: "Request not found." });
      }
      if (request.status !== "PENDING") {
        await connection.rollback();
        return res.status(409).json({ error: "This request was already decided." });
      }
      let result;
      switch (request.request_type) {
        case "STOCK_IN_EDIT":
          result = await setStockInLineQty(connection, request.target_id, Number(request.new_value), actor.username);
          break;
        case "STOCK_IN_DELETE":
          result = await removeStockInLine(connection, request.target_id, actor.username);
          break;
        case "INVOICE_DELETE": {
          const [lines] = await connection.query(
            "SELECT m.id FROM movements m WHERE m.type='IN' AND COALESCE(m.reference, '') = ? FOR UPDATE",
            [request.target_id],
          );
          result = { status: 200 };
          for (const line of lines) {
            const removed = await removeStockInLine(connection, line.id, actor.username);
            if (removed.status !== 200) {
              result = removed;
              break;
            }
          }
          break;
        }
        case "MOVEMENT_DELETE":
          result = await applyMovementDelete(connection, request.target_id, actor.username);
          break;
        case "MOVEMENT_UNDO":
          result = await applyMovementUndo(connection, request.target_id, Number(request.new_value), actor.username);
          break;
        case "ITEM_DELETE":
          result = await applyItemDelete(connection, request.target_id, actor.username);
          break;
        default:
          result = { status: 400, error: "This request type cannot be approved here." };
      }
      if (![200, 204].includes(result.status)) {
        await connection.rollback();
        return res.status(result.status).json({ error: result.error });
      }
      await connection.query(
        "UPDATE change_requests SET status='APPROVED', decided_by=?, decided_at=NOW() WHERE id=?",
        [actor.username, id],
      );
      await connection.commit();
      res.json({ id, status: "APPROVED" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

app.post(
  "/api/change-requests/:id/reject",
  ah(async (req, res) => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const id = cleanText(req.params.id, 64);
    const note = cleanText(req.body?.note, 255);
    if (!note) return res.status(400).json({ error: "Enter the reason for rejecting this request." });
    const [result] = await pool.query(
      "UPDATE change_requests SET status='REJECTED', decided_by=?, decided_at=NOW(), decision_note=? WHERE id=? AND status='PENDING'",
      [actor.username, note, id],
    );
    if (result.affectedRows === 0) return res.status(409).json({ error: "This request is not pending." });
    res.json({ id, status: "REJECTED" });
  }),
);

// The signed-in user's role, used by the screens to show or hide actions.
app.get(
  "/api/me",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor) return res.status(401).json({ error: "Sign in." });
    res.json({ username: actor.username, role: actor.role });
  }),
);

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
    // Stock in needs the supplier's invoice number. The supplier is optional.
    const reference = cleanText(movement.reference, 64) || null;
    if (movement.type === "IN" && !reference) {
      return res.status(400).json({ error: "Enter the invoice number for stock in." });
    }
    const supplierId = movement.supplierId ? toPositiveInt(movement.supplierId) : null;
    if (movement.supplierId && !supplierId) {
      return res.status(400).json({ error: "Invalid supplier." });
    }
    if (supplierId) {
      const [[supplier]] = await pool.query("SELECT id FROM suppliers WHERE id=?", [supplierId]);
      if (!supplier) return res.status(400).json({ error: "Supplier not found." });
    }

    const actor = await getAuthenticatedUser(req);
    const actorName = actor?.username || movement.createdBy || null;
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
      // The same movement sent twice (for example after a timeout) is recorded once.
      const [[alreadyRecorded]] = await connection.query("SELECT * FROM movements WHERE id=?", [id]);
      if (alreadyRecorded) {
        await connection.rollback();
        return res.status(200).json(toMovement(alreadyRecorded));
      }

      if (movement.type === "OUT" && qty > item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          error: `Insufficient stock. Only ${item.quantity} unit(s) available.`,
        });
      }

      const delta = movement.type === "IN" ? qty : -qty;
      await connection.query(
        "INSERT INTO movements (id, item_id, type, qty, movement_date, reference, supplier_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, itemId, movement.type, qty, date, reference, supplierId, actorName],
      );
      await connection.query(
        "UPDATE inventory SET quantity = GREATEST(0, quantity + ?), version = version + 1 WHERE id=?",
        [delta, itemId],
      );
      await recordStockLedger(connection, {
        sourceId: id,
        itemId,
        type: movement.type === "IN" ? "STOCK_IN" : "STOCK_OUT",
        reference: reference || id,
        supplierId,
        qtyIn: movement.type === "IN" ? qty : 0,
        qtyOut: movement.type === "OUT" ? qty : 0,
        balanceAfter: await currentItemQuantity(connection, itemId),
        recordedBy: actorName,
      });
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

// Admins make every change directly. Staff use the everyday features; their edits, undos and deletes wait for an admin.
const isAdmin = (actor) => Boolean(actor) && actor.role === "admin";

async function requireSignedIn(req, res) {
  const actor = await getAuthenticatedUser(req);
  if (!actor) {
    res.status(401).json({ error: "Sign in first." });
    return null;
  }
  return actor;
}

// Creates a pending request for a change a staff member cannot make directly.
// The details shown on the request are read from the record it is about.
async function sendForApproval(res, actor, type, targetId, reason, newValue = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let info = { itemId: "", itemName: "", invoice: "", oldValue: null, newValue: null };
    if (type.startsWith("MOVEMENT_")) {
      const [[m]] = await connection.query(
        "SELECT m.id, m.item_id, m.qty, m.reference, i.name AS item_name FROM movements m JOIN inventory i ON i.id = m.item_id WHERE m.id=?",
        [targetId],
      );
      if (!m) {
        await connection.rollback();
        return res.status(404).json({ error: "Movement not found." });
      }
      info = { itemId: m.item_id, itemName: m.item_name, invoice: m.reference || "", oldValue: Number(m.qty), newValue };
    } else if (type === "ITEM_DELETE") {
      const [[item]] = await connection.query("SELECT id, name, quantity FROM inventory WHERE id=?", [targetId]);
      if (!item) {
        await connection.rollback();
        return res.status(404).json({ error: "Item not found." });
      }
      info = { itemId: item.id, itemName: item.name, invoice: "", oldValue: Number(item.quantity), newValue: 0 };
    } else if (type === "INVOICE_DELETE") {
      const [lines] = await connection.query(
        "SELECT m.item_id, m.qty, i.name AS item_name FROM movements m JOIN inventory i ON i.id = m.item_id WHERE m.type='IN' AND COALESCE(m.reference,'') = ?",
        [targetId],
      );
      if (lines.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "No stock-in lines on this invoice." });
      }
      info = {
        itemId: lines.length === 1 ? lines[0].item_id : `${lines.length} items`,
        itemName: lines.length === 1 ? lines[0].item_name : `Invoice ${targetId || "(no invoice)"}`,
        invoice: targetId,
        oldValue: lines.reduce((sum, l) => sum + Number(l.qty), 0),
        newValue: 0,
      };
    } else {
      const [[m]] = await connection.query(
        "SELECT m.id, m.item_id, m.qty, m.reference, i.name AS item_name FROM movements m JOIN inventory i ON i.id = m.item_id WHERE m.id=? AND m.type='IN'",
        [targetId],
      );
      if (!m) {
        await connection.rollback();
        return res.status(404).json({ error: "Stock-in line not found." });
      }
      info = { itemId: m.item_id, itemName: m.item_name, invoice: m.reference || "", oldValue: Number(m.qty), newValue: 0 };
    }
    await recordChangeRequest(connection, {
      type, targetId, invoice: info.invoice, itemId: info.itemId, itemName: info.itemName,
      oldValue: info.oldValue, newValue: info.newValue, reason, requestedBy: actor.username, status: "PENDING",
    });
    await connection.commit();
    res.status(202).json({ requested: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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

// Saves a picture as soon as it is chosen, and returns its web address for the item form.
app.post(
  "/api/uploads",
  ah(async (req, res) => {
    const actor = await getAuthenticatedUser(req);
    if (!actor || actor.role !== "admin") {
      return res.status(actor ? 403 : 401).json({ error: "Administrator access is required." });
    }
    try {
      const url = await storeItemImage(req.body?.image, req.body?.imageFileName);
      if (!url) return res.status(400).json({ error: "No picture was received." });
      res.json({ url });
    } catch (error) {
      res.status(400).json({ error: error.message || "The picture could not be saved." });
    }
  }),
);

app.use("/api/uploads", express.static(uploadsDirectory));
app.use(express.static(path.join(__dirname, "dist")));
// Regex works on Express 4 and 5, and unknown /api routes get a JSON 404 instead of index.html.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  // Malformed requests (for example invalid JSON) are client errors, not server errors.
  if (error?.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: "The request could not be read." });
  }
  if (error?.httpStatus) {
    return res.status(error.httpStatus).json({ error: error.message });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res
      .status(409)
      .json({ error: "That was just saved by someone else. Refresh the list and try again." });
  }
  // Lock timeouts and deadlocks are temporary: ask the client to retry instead of failing.
  if (error?.code === "ER_LOCK_WAIT_TIMEOUT" || error?.code === "ER_LOCK_DEADLOCK") {
    return res
      .status(503)
      .json({ error: "The system is busy with another change. Please try again." });
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
