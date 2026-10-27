import { promisify } from "node:util";
import {
  createHmac,
  randomBytes,
  scrypt as callbackScrypt,
  timingSafeEqual
} from "node:crypto";

const scrypt = promisify(callbackScrypt);
const passwordKeyLength = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, passwordKeyLength);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!/^[\da-f]{32}$/i.test(saltHex) || !/^[\da-f]{128}$/i.test(keyHex)) return false;
  const expectedKey = Buffer.from(keyHex, "hex");
  const actualKey = await scrypt(password, Buffer.from(saltHex, "hex"), passwordKeyLength);
  return timingSafeEqual(expectedKey, actualKey);
}

export function createSessionToken(secret) {
  const token = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", secret).update(token).digest("base64url");
  return { token, cookieValue: `${token}.${signature}` };
}

export function getVerifiedSessionToken(cookieValue, secret) {
  if (typeof cookieValue !== "string") return null;
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) return null;

  const token = cookieValue.slice(0, separator);
  const suppliedSignature = Buffer.from(cookieValue.slice(separator + 1));
  const expectedSignature = Buffer.from(
    createHmac("sha256", secret).update(token).digest("base64url")
  );
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }
  return token;
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        return [[name, decodeURIComponent(value)]];
      } catch {
        return [];
      }
    })
  );
}
