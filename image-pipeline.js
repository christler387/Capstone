// Product pictures: every picture is checked by its content, converted to WebP at a limited size,
// stripped of metadata, and saved under uploads/products/. Pictures from web addresses are downloaded
// by the server with checks that block internal addresses, so the server cannot be used to reach its own network.
import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

export const PRODUCT_IMAGE_MAX_SIDE = 1200;
export const PRODUCT_THUMB_SIDE = 320;
export const PRODUCT_IMAGE_QUALITY = 80;
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_INPUT_PIXELS = 40_000_000;
// SVG is deliberately not accepted: it can carry scripts.
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);
const PUBLIC_URL_PREFIX = "/api/uploads/";
const PRODUCTS_FOLDER = "products";

// The server's error handler shows the message for errors with httpStatus.
const httpError = (status, message) => Object.assign(new Error(message), { httpStatus: status });

// ---------- Conversion ----------

// Sharp is loaded on first use. If it is missing or broken, only pictures fail; the server keeps running.
let sharpPromise = null;
function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((module) => module.default)
      .catch((error) => {
        sharpPromise = null;
        throw error;
      });
  }
  return sharpPromise;
}

// Checks the picture by its content, then makes the full-size and thumbnail WebP files.
export async function convertPicture(input) {
  let sharp;
  try {
    sharp = await loadSharp();
  } catch {
    throw httpError(503, "Picture processing is not available on the server right now.");
  }

  let format;
  try {
    const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata();
    format = metadata.format;
  } catch {
    throw httpError(400, "That file is not a supported picture.");
  }
  if (!ALLOWED_FORMATS.has(format)) {
    throw httpError(400, "Only JPG, PNG, WebP, GIF and AVIF pictures are supported.");
  }

  try {
    const large = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate() // applies the camera orientation; the rotate also drops the metadata
      .resize({
        width: PRODUCT_IMAGE_MAX_SIDE,
        height: PRODUCT_IMAGE_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: PRODUCT_IMAGE_QUALITY })
      .toBuffer();
    const thumb = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize({
        width: PRODUCT_THUMB_SIDE,
        height: PRODUCT_THUMB_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: PRODUCT_IMAGE_QUALITY })
      .toBuffer();
    return { large, thumb };
  } catch {
    throw httpError(422, "The picture could not be compressed. Try another file.");
  }
}

// Converts and saves a picture. Returns the public path, e.g. /api/uploads/products/product-<id>.webp
export async function storeProductImage(uploadsDirectory, input) {
  const { large, thumb } = await convertPicture(input);
  const id = crypto.randomUUID();
  const folder = path.join(uploadsDirectory, PRODUCTS_FOLDER);
  const largeName = `product-${id}.webp`;
  const thumbName = `product-${id}-t.webp`;
  await fs.mkdir(folder, { recursive: true });
  try {
    await fs.writeFile(path.join(folder, largeName), large, { flag: "wx" });
    await fs.writeFile(path.join(folder, thumbName), thumb, { flag: "wx" });
  } catch {
    await removeFiles(folder, [largeName, thumbName]);
    throw httpError(500, "The picture could not be saved. Please try again.");
  }
  return `${PUBLIC_URL_PREFIX}${PRODUCTS_FOLDER}/${largeName}`;
}

async function removeFiles(folder, names) {
  await Promise.all(names.map((name) => fs.unlink(path.join(folder, name)).catch(() => {})));
}

// ---------- Removing replaced pictures ----------

// True when the stored value is a picture this server saved (so it may be deleted).
export function isLocalPicture(value) {
  return typeof value === "string" && value.startsWith(PUBLIC_URL_PREFIX);
}

// Deletes a locally saved picture and its thumbnail. Pictures from other sites are never touched.
export async function deleteLocalPicture(uploadsDirectory, storedPath) {
  if (!isLocalPicture(storedPath)) return;
  const root = path.resolve(uploadsDirectory);
  let relative;
  try {
    relative = decodeURIComponent(storedPath.slice(PUBLIC_URL_PREFIX.length));
  } catch {
    return;
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) return;
  const names = [path.basename(target)];
  if (/^product-[^/]+\.webp$/.test(names[0])) {
    names.push(names[0].replace(/\.webp$/, "-t.webp"));
  }
  await Promise.all(
    names.map((name) =>
      fs.unlink(path.join(path.dirname(target), name)).catch((error) => {
        // A picture that is already gone is fine; any other problem is logged for the administrator.
        if (error.code !== "ENOENT") console.warn(`Could not remove old product picture ${name}: ${error.code}`);
      }),
    ),
  );
}

// ---------- Web addresses ----------

// Parses a web address and checks its shape: http or https, default ports, no login details.
export function parseWebAddress(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw httpError(400, "Enter a complete picture address.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw httpError(400, "The picture address is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw httpError(400, "The picture address must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw httpError(400, "Picture addresses cannot contain a login.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw httpError(400, "Picture addresses must use the standard web ports.");
  }
  if (!url.hostname) {
    throw httpError(400, "The picture address is not valid.");
  }
  return url;
}

const BLOCKED_HOSTNAMES = /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|\.corp$)/i;

// True only for addresses on the public internet. Private, loopback, link-local, multicast,
// reserved and documentation ranges are refused, as are IPv4-mapped forms of them.
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 88) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51) return false;
    if (a === 203 && b === 0) return false;
    if (a >= 224) return false;
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    // Only global unicast addresses (2000::/3) are allowed, excluding the documentation range.
    const firstGroup = lower.split(":")[0];
    if (!/^[23][0-9a-f]{0,3}$/.test(firstGroup)) return false;
    if (lower.startsWith("2001:db8")) return false;
    return true;
  }
  return false;
}

// Looks up the host and returns one public address to connect to. The connection uses this exact address,
// so the name cannot be changed to point somewhere else between the check and the download.
async function resolvePublicAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw httpError(400, "That picture address is not allowed.");
    return { address: host, family: net.isIP(host) };
  }
  if (BLOCKED_HOSTNAMES.test(host)) throw httpError(400, "That picture address is not allowed.");

  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw httpError(502, "The picture server could not be found.");
  }
  if (records.length === 0) throw httpError(502, "The picture server could not be found.");
  if (!records.every((record) => isPublicAddress(record.address))) {
    throw httpError(400, "That picture address is not allowed.");
  }
  const preferred = records.find((record) => record.family === 4) || records[0];
  return { address: preferred.address, family: preferred.family };
}

// One request to one address. Redirects are returned to the caller, which checks them again.
function requestPicture(url, { address, family }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "image/*",
          "Accept-Encoding": "identity",
          "User-Agent": "AutoSupply-Image-Import/1.0",
        },
        lookup: (_host, _options, callback) => callback(null, address, family),
      },
      (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          resolve({ redirect: response.headers.location });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(httpError(502, `The picture server answered with status ${status}.`));
          return;
        }
        const declared = Number(response.headers["content-length"]);
        if (declared > DOWNLOAD_MAX_BYTES) {
          response.resume();
          reject(httpError(413, "That picture is too large. Use one under 8 MB."));
          return;
        }
        const chunks = [];
        let total = 0;
        response.on("data", (chunk) => {
          total += chunk.length;
          if (total > DOWNLOAD_MAX_BYTES) {
            request.destroy();
            reject(httpError(413, "That picture is too large. Use one under 8 MB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ body: Buffer.concat(chunks) }));
        response.on("error", () => reject(httpError(502, "The picture could not be downloaded.")));
      },
    );
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy();
      reject(httpError(504, "The picture took too long to download."));
    });
    request.on("error", (error) => {
      reject(error.httpStatus ? error : httpError(502, "The picture could not be downloaded."));
    });
    request.end();
  });
}

// Downloads a picture from a web address, following at most a few redirects, each checked the same way.
export async function downloadPicture(value) {
  let url = parseWebAddress(value);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await resolvePublicAddress(url.hostname);
    const result = await requestPicture(url, target);
    if (!result.redirect) return result.body;
    let next;
    try {
      next = new URL(result.redirect, url);
    } catch {
      throw httpError(502, "The picture server sent a broken redirect.");
    }
    url = parseWebAddress(next.href);
  }
  throw httpError(400, "The picture address redirects too many times.");
}

// Downloads a picture from a web address and saves its WebP copy on this server.
export async function importPictureFromAddress(uploadsDirectory, value) {
  const body = await downloadPicture(value);
  return storeProductImage(uploadsDirectory, body);
}
