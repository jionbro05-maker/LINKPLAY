import crypto from 'crypto';
import net from 'net';

export function generateId(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function isPrivateOrLocalIp(host: string): boolean {
  const cleanHost = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    cleanHost === 'localhost' ||
    cleanHost === '0.0.0.0' ||
    cleanHost === '::1' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(cleanHost);
  if (ipVersion === 4) {
    const octets = cleanHost.split('.').map(Number);
    if (octets.length !== 4) return true;
    const [a, b] = octets;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (ipVersion === 6) {
    if (
      cleanHost === '::1' ||
      cleanHost === '::' ||
      cleanHost.startsWith('fc') ||
      cleanHost.startsWith('fd') ||
      cleanHost.startsWith('fe80') ||
      cleanHost.startsWith('::ffff:127.') ||
      cleanHost.startsWith('::ffff:10.') ||
      cleanHost.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
  }

  return false;
}

export function validateExternalPlayerUrl(rawUrl: string): { valid: boolean; reason?: string; normalized?: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'External player URL is required.' };
  }
  if (trimmed.length > 2048) {
    return { valid: false, reason: 'URL exceeds maximum length of 2048 characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Please enter a valid URL starting with https://.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Only https:// (or http://) video URLs are permitted.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Credentials inside URLs are not allowed.' };
  }

  if (!parsed.hostname || isPrivateOrLocalIp(parsed.hostname)) {
    return { valid: false, reason: 'Private network or localhost URLs are blocked for security.' };
  }

  if (!parsed.hostname.includes('.') && net.isIP(parsed.hostname) === 0) {
    return { valid: false, reason: 'URL must use a valid public domain name.' };
  }

  return { valid: true, normalized: parsed.toString() };
}

export function parseUserAgent(ua: string): {
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Smart TV';
  browser: string;
} {
  const s = (ua || '').toLowerCase();

  let deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Smart TV' = 'Desktop';
  if (/smart-tv|smarttv|googletv|appletv|hbbtv|netcast|viera|tizen|webos|roku|bravia|aftb|aftm|afts/.test(s)) {
    deviceType = 'Smart TV';
  } else if (/ipad|tablet|playbook|silk|(android(?!.*mobi))/.test(s)) {
    deviceType = 'Tablet';
  } else if (/iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|iemobile/.test(s)) {
    deviceType = 'Mobile';
  }

  let browser = 'Other';
  if (/edg\//.test(s)) browser = 'Edge';
  else if (/opr\/|opera/.test(s)) browser = 'Opera';
  else if (/samsungbrowser/.test(s)) browser = 'Samsung Internet';
  else if (/firefox|fxios/.test(s)) browser = 'Firefox';
  else if (/chrome|crios/.test(s) && !/edg\//.test(s)) browser = 'Chrome';
  else if (/safari/.test(s) && !/chrome|crios/.test(s)) browser = 'Safari';

  return { deviceType, browser };
}
