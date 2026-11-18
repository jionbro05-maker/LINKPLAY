import 'dotenv/config';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  cleanupExpiredSessions,
  createUniqueVideoId,
  db,
  getSettingsMap,
  THUMBNAILS_UPLOAD_DIR,
  TMP_UPLOAD_DIR,
  VIDEOS_UPLOAD_DIR,
} from './src/server/db.ts';
import {
  generateId,
  hashPassword,
  parseUserAgent,
  sha256,
  validateExternalPlayerUrl,
  verifyPassword,
} from './src/server/security.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'lp_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 1000 * 60 * 15; // 15 minutes

interface AdminRecord {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
  last_login: number | null;
}

interface AuthedRequest extends Request {
  admin?: { id: number; username: string };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

function getAdminByRawToken(rawToken: string | undefined): { id: number; username: string } | null {
  if (!rawToken) return null;

  const tokenHash = sha256(rawToken);
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT a.id, a.username, s.expires_at
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as { id: number; username: string; expires_at: number } | undefined;

  if (!row) return null;
  if (row.expires_at < now) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { id: row.id, username: row.username };
}

function extractTokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE];
}

function getAdminFromRequest(req: Request): { id: number; username: string } | null {
  return getAdminByRawToken(extractTokenFromRequest(req));
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.admin = admin;
  next();
}

function getLiveSnapshot() {
  cleanupExpiredSessions(65_000);
  const sessions = db
    .prepare(
      `SELECT l.session_id, l.video_id, l.device_type, l.browser, l.last_heartbeat, l.created_at,
              v.title as video_title
       FROM live_sessions l
       LEFT JOIN videos v ON v.id = l.video_id
       ORDER BY l.last_heartbeat DESC`
    )
    .all() as {
      session_id: string;
      video_id: string | null;
      device_type: string;
      browser: string;
      last_heartbeat: number;
      created_at: number;
      video_title: string | null;
    }[];

  const byVideoMap = new Map<string, { videoId: string; title: string; count: number }>();
  let watchingCount = 0;
  for (const s of sessions) {
    if (s.video_id && s.video_id !== 'home' && s.video_id !== 'admin') {
      watchingCount += 1;
      const existing = byVideoMap.get(s.video_id);
      if (existing) {
        existing.count += 1;
      } else {
        byVideoMap.set(s.video_id, {
          videoId: s.video_id,
          title: s.video_title || s.video_id,
          count: 1,
        });
      }
    }
  }

  return {
    totalActiveSessions: sessions.length,
    watchingSessions: watchingCount,
    sessions,
    byVideo: Array.from(byVideoMap.values()).sort((a, b) => b.count - a.count),
    timestamp: Date.now(),
  };
}

function getSafeVideoMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mkv':
      return 'video/x-matroska';
    case '.ogg':
    case '.ogv':
      return 'video/ogg';
    default:
      return 'application/octet-stream';
  }
}

function getSafeImageMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function safeJsonParseQuality(raw: string): { label: string; url: string }[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { label: string; url: string } =>
        Boolean(item && typeof item.label === 'string' && typeof item.url === 'string')
    );
  } catch {
    return [];
  }
}

function getStorageUsedBytes(): number {
  let total = 0;
  for (const dir of [VIDEOS_UPLOAD_DIR, THUMBNAILS_UPLOAD_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) total += stat.size;
      } catch {
        // ignore vanished temp file
      }
    }
  }
  return total;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Raw body parser for chunked uploads & thumbnail uploads before JSON parser
  app.use(
    '/api/admin/upload/chunk',
    express.raw({ type: 'application/octet-stream', limit: '25mb' })
  );
  app.use(
    '/api/admin/upload/thumbnail',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '10mb' })
  );
  app.use(express.json({ limit: '2mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const adminSockets = new Set<WebSocket>();
  const publicSocketSessions = new Map<WebSocket, string>();

  function broadcastLiveUpdate() {
    const snapshot = getLiveSnapshot();
    const payload = JSON.stringify({ type: 'live:update', data: snapshot });
    for (const client of adminSockets) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }

    // Also broadcast per-video active count to public viewers watching a video
    const countsByVideo: Record<string, number> = {};
    for (const item of snapshot.byVideo) {
      countsByVideo[item.videoId] = item.count;
    }
    const publicPayload = JSON.stringify({
      type: 'presence:counts',
      totalActive: snapshot.totalActiveSessions,
      byVideo: countsByVideo,
    });
    for (const [client] of publicSocketSessions.entries()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(publicPayload);
      }
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (reqUrl.pathname !== '/ws') {
      return; // Let Vite or other handlers handle non-/ws upgrades if any
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const userAgent = String(req.headers['user-agent'] || '');
    const parsedUA = parseUserAgent(userAgent);
    let currentSessionId: string | null = null;
    let isAdminClient = false;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          sessionId?: string;
          videoId?: string | null;
          token?: string;
        };

        if (msg.type === 'admin_subscribe') {
          const cookies = parseCookies(req.headers.cookie);
          const admin = getAdminByRawToken(msg.token || cookies[SESSION_COOKIE]);
          if (!admin) {
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            return;
          }
          isAdminClient = true;
          adminSockets.add(ws);
          ws.send(JSON.stringify({ type: 'live:update', data: getLiveSnapshot() }));
          return;
        }

        if (msg.type === 'heartbeat' && typeof msg.sessionId === 'string' && msg.sessionId.trim()) {
          const sid = msg.sessionId.trim().slice(0, 80);
          const videoId =
            typeof msg.videoId === 'string' && msg.videoId.trim()
              ? msg.videoId.trim().slice(0, 64)
              : 'home';
          const now = Date.now();

          currentSessionId = sid;
          publicSocketSessions.set(ws, sid);

          db.prepare(
            `INSERT INTO live_sessions (session_id, video_id, device_type, browser, user_agent, last_heartbeat, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
               video_id = excluded.video_id,
               device_type = excluded.device_type,
               browser = excluded.browser,
               user_agent = excluded.user_agent,
               last_heartbeat = excluded.last_heartbeat`
          ).run(sid, videoId, parsedUA.deviceType, parsedUA.browser, userAgent.slice(0, 300), now, now);

          broadcastLiveUpdate();
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      if (isAdminClient) {
        adminSockets.delete(ws);
      }
      publicSocketSessions.delete(ws);
      if (currentSessionId) {
        // Check if another active WebSocket still holds this exact sessionId (e.g. quick reload)
        let stillConnected = false;
        for (const sid of publicSocketSessions.values()) {
          if (sid === currentSessionId) {
            stillConnected = true;
            break;
          }
        }
        if (!stillConnected) {
          db.prepare('DELETE FROM live_sessions WHERE session_id = ?').run(currentSessionId);
          broadcastLiveUpdate();
        }
      }
    });
  });

  // Periodic sweep for stale sessions (>65s without heartbeat)
  const sweepInterval = setInterval(() => {
    const removed = cleanupExpiredSessions(65_000);
    if (removed > 0) {
      broadcastLiveUpdate();
    }
  }, 15_000);
  sweepInterval.unref();

  // ========================
  // PUBLIC ENDPOINTS
  // ========================

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'LINKPLAYHD' });
  });

  app.get('/api/public/config', (_req, res) => {
    const settings = getSettingsMap();
    res.json({
      brand: 'LINKPLAYHD',
      telegramChannel: settings.telegram_channel || '@NETWORKBOYOU',
      telegramContact: settings.telegram_contact || '@SAMVIIR',
      relatedVideosEnabled: settings.related_videos_enabled !== 'false',
      siteTagline: settings.site_tagline || 'Ultra-HD Streaming & Protected Watch Links',
      watermarkEnabled: settings.watermark_enabled !== 'false',
      watermarkText: settings.watermark_text || 'LINKPLAYHD · @SAMVIIR',
      watermarkImageUrl: settings.watermark_image_url || '',
      defaultSkipIntro: Math.max(0, Number(settings.default_skip_intro ?? 37) || 0),
      screenShieldEnabled: settings.screen_shield_enabled !== 'false',
    });
  });

  // Fallback HTTP heartbeat if WebSocket is unavailable in restricted networks
  app.post('/api/public/heartbeat', (req, res) => {
    const { sessionId, videoId } = req.body || {};
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    const sid = sessionId.trim().slice(0, 80);
    const vid = typeof videoId === 'string' && videoId.trim() ? videoId.trim().slice(0, 64) : 'home';
    const ua = String(req.headers['user-agent'] || '');
    const parsedUA = parseUserAgent(ua);
    const now = Date.now();

    db.prepare(
      `INSERT INTO live_sessions (session_id, video_id, device_type, browser, user_agent, last_heartbeat, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         video_id = excluded.video_id,
         device_type = excluded.device_type,
         browser = excluded.browser,
         user_agent = excluded.user_agent,
         last_heartbeat = excluded.last_heartbeat`
    ).run(sid, vid, parsedUA.deviceType, parsedUA.browser, ua.slice(0, 300), now, now);

    broadcastLiveUpdate();
    const snapshot = getLiveSnapshot();
    const countsByVideo: Record<string, number> = {};
    for (const item of snapshot.byVideo) countsByVideo[item.videoId] = item.count;
    res.json({ ok: true, totalActive: snapshot.totalActiveSessions, byVideo: countsByVideo });
  });

  app.get('/api/public/videos', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    cleanupExpiredSessions(65_000);

    const rows = db
      .prepare(
        `SELECT v.id, v.title, v.description, v.thumbnail_url, v.source_type, v.source_url,
                v.quality_sources, v.skip_intro_seconds, v.category, v.featured, v.created_at,
                (SELECT COUNT(*) FROM video_views vv WHERE vv.video_id = v.id) as views,
                (SELECT COUNT(*) FROM live_sessions ls WHERE ls.video_id = v.id) as active_viewers
         FROM videos v
         WHERE v.status = 'published'
         ORDER BY v.featured DESC, v.created_at DESC`
      )
      .all() as Array<{
        id: string;
        title: string;
        description: string;
        thumbnail_url: string;
        source_type: string;
        source_url: string;
        quality_sources: string;
        skip_intro_seconds: number;
        category: string;
        featured: number;
        created_at: number;
        views: number;
        active_viewers: number;
      }>;

    const filtered = rows
      .filter((row) => {
        if (category && category !== 'All' && row.category.toLowerCase() !== category.toLowerCase()) {
          return false;
        }
        if (q) {
          const hay = `${row.title} ${row.description} ${row.category} ${row.id}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        thumbnailUrl: row.thumbnail_url,
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        qualitySources: safeJsonParseQuality(row.quality_sources),
        skipIntroSeconds: Number(row.skip_intro_seconds) || 0,
        category: row.category,
        featured: Boolean(row.featured),
        createdAt: row.created_at,
        views: row.views,
        activeViewers: row.active_viewers,
      }));

    res.json({ videos: filtered });
  });

  app.get('/api/public/videos/:id', (req, res) => {
    const id = req.params.id;
    cleanupExpiredSessions(65_000);

    const row = db
      .prepare(
        `SELECT id, title, description, thumbnail_url, source_type, source_url,
                quality_sources, skip_intro_seconds, category, status, featured, created_at
         FROM videos WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          title: string;
          description: string;
          thumbnail_url: string;
          source_type: string;
          source_url: string;
          quality_sources: string;
          skip_intro_seconds: number;
          category: string;
          status: string;
          featured: number;
          created_at: number;
        }
      | undefined;

    if (!row || row.status === 'draft') {
      return res.status(404).json({ error: 'Video link not found' });
    }

    if (row.status === 'disabled') {
      return res.status(403).json({
        error: 'This watch link has been temporarily disabled by the administrator.',
        disabled: true,
      });
    }

    const viewStats = db
      .prepare('SELECT COUNT(*) as views FROM video_views WHERE video_id = ?')
      .get(id) as { views: number };
    const liveStats = db
      .prepare('SELECT COUNT(*) as active_viewers FROM live_sessions WHERE video_id = ?')
      .get(id) as { active_viewers: number };

    const settings = getSettingsMap();
    const relatedEnabled = settings.related_videos_enabled !== 'false';

    let related: Array<{
      id: string;
      title: string;
      thumbnailUrl: string;
      category: string;
      views: number;
      createdAt: number;
    }> = [];

    if (relatedEnabled) {
      const relRows = db
        .prepare(
          `SELECT v.id, v.title, v.thumbnail_url, v.category, v.created_at,
                  (SELECT COUNT(*) FROM video_views vv WHERE vv.video_id = v.id) as views
           FROM videos v
           WHERE v.status = 'published' AND v.id != ?
           ORDER BY CASE WHEN v.category = ? THEN 0 ELSE 1 END, v.created_at DESC
           LIMIT 6`
        )
        .all(id, row.category) as Array<{
          id: string;
          title: string;
          thumbnail_url: string;
          category: string;
          created_at: number;
          views: number;
        }>;

      related = relRows.map((r) => ({
        id: r.id,
        title: r.title,
        thumbnailUrl: r.thumbnail_url,
        category: r.category,
        views: r.views,
        createdAt: r.created_at,
      }));
    }

    res.json({
      video: {
        id: row.id,
        title: row.title,
        description: row.description,
        thumbnailUrl: row.thumbnail_url,
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        qualitySources: safeJsonParseQuality(row.quality_sources),
        skipIntroSeconds: Number(row.skip_intro_seconds) || 0,
        category: row.category,
        featured: Boolean(row.featured),
        createdAt: row.created_at,
        views: viewStats.views,
        activeViewers: liveStats.active_viewers,
      },
      related,
    });
  });

  app.post('/api/public/views', (req, res) => {
    const { videoId, sessionId, watchedDuration } = req.body || {};
    if (typeof videoId !== 'string' || typeof sessionId !== 'string' || !videoId.trim() || !sessionId.trim()) {
      return res.status(400).json({ error: 'videoId and sessionId are required' });
    }

    const video = db.prepare('SELECT id, status FROM videos WHERE id = ?').get(videoId) as
      | { id: string; status: string }
      | undefined;
    if (!video || video.status !== 'published') {
      return res.status(404).json({ error: 'Video not available' });
    }

    const duration = Math.max(0, Math.min(86400, Math.floor(Number(watchedDuration) || 0)));
    const now = Date.now();

    const existing = db
      .prepare('SELECT id, watched_duration FROM video_views WHERE video_id = ? AND session_id = ?')
      .get(videoId, sessionId) as { id: number; watched_duration: number } | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO video_views (video_id, session_id, watched_duration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(videoId, sessionId, duration, now, now);

      db.prepare(
        'INSERT INTO analytics (video_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)'
      ).run(videoId, 'view', '', now);
    } else if (duration > existing.watched_duration) {
      db.prepare('UPDATE video_views SET watched_duration = ?, updated_at = ? WHERE id = ?').run(
        duration,
        now,
        existing.id
      );
    }

    const countRow = db
      .prepare('SELECT COUNT(*) as views FROM video_views WHERE video_id = ?')
      .get(videoId) as { views: number };

    res.json({ ok: true, views: countRow.views });
  });

  app.post('/api/public/events', (req, res) => {
    const { videoId, eventType, metadata } = req.body || {};
    const allowedEvents = new Set(['play', 'pause', 'error', 'share']);
    if (typeof eventType !== 'string' || !allowedEvents.has(eventType)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }
    if (typeof videoId !== 'string' || !videoId.trim()) {
      return res.status(400).json({ error: 'videoId required' });
    }

    const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    db.prepare(
      'INSERT INTO analytics (video_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)'
    ).run(videoId, eventType, String(metadata || '').slice(0, 300), Date.now());

    res.json({ ok: true });
  });

  // Media streaming with HTTP Range support for MP4/WebM/MOV
  app.get('/media/videos/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(VIDEOS_UPLOAD_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const ext = path.extname(safeName);
    const mimeType = getSafeVideoMime(ext);
    const range = req.headers.range;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(fullPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(fullPath).pipe(res);
    }
  });

  app.get('/media/thumbnails/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(THUMBNAILS_UPLOAD_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    const mime = getSafeImageMime(path.extname(safeName));
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(fullPath).pipe(res);
  });

  // ========================
  // ADMIN AUTH ROUTES
  // ========================

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const cleanUser = typeof username === 'string' ? username.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!cleanUser || !cleanPass) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const attemptKey = `${req.ip || 'unknown'}:${cleanUser.toUpperCase()}`;
    const now = Date.now();
    const attemptRow = db
      .prepare('SELECT attempts, locked_until FROM login_attempts WHERE attempt_key = ?')
      .get(attemptKey) as { attempts: number; locked_until: number } | undefined;

    if (attemptRow && attemptRow.locked_until > now) {
      const waitMinutes = Math.ceil((attemptRow.locked_until - now) / 60_000);
      return res.status(429).json({
        error: `Too many failed login attempts. Try again in ${waitMinutes} minute(s).`,
      });
    }

    const admin = db
      .prepare('SELECT * FROM admins WHERE UPPER(username) = UPPER(?)')
      .get(cleanUser) as AdminRecord | undefined;

    if (!admin || !verifyPassword(cleanPass, admin.password_hash)) {
      const nextAttempts = (attemptRow && attemptRow.locked_until <= now ? attemptRow.attempts : 0) + 1;
      const lockedUntil = nextAttempts >= MAX_LOGIN_ATTEMPTS ? now + LOCKOUT_DURATION_MS : 0;
      db.prepare(
        `INSERT INTO login_attempts (attempt_key, attempts, locked_until, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(attempt_key) DO UPDATE SET
           attempts = excluded.attempts,
           locked_until = excluded.locked_until,
           updated_at = excluded.updated_at`
      ).run(attemptKey, lockedUntil ? 0 : nextAttempts, lockedUntil, now);

      if (lockedUntil) {
        return res.status(429).json({
          error: 'Too many failed login attempts. Account login temporarily locked for 15 minutes.',
        });
      }

      const remaining = MAX_LOGIN_ATTEMPTS - nextAttempts;
      return res.status(401).json({
        error: `Invalid username or password. ${remaining} attempt(s) remaining.`,
      });
    }

    // Clear failed attempts and create secure session
    db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(attemptKey);
    db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(now, admin.id);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    db.prepare(
      'INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(tokenHash, admin.id, now + SESSION_TTL_MS, now);

    // Purge expired sessions opportunistically
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(SESSION_COOKIE, rawToken, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    res.json({
      admin: { id: admin.id, username: admin.username },
      token: rawToken,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const rawToken = extractTokenFromRequest(req);
    if (rawToken) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(rawToken));
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const admin = getAdminFromRequest(req);
    if (!admin) {
      return res.status(401).json({ authenticated: false });
    }
    res.json({ authenticated: true, admin });
  });

  // ========================
  // PROTECTED ADMIN ROUTES
  // ========================

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    cleanupExpiredSessions(65_000);

    const videoTotals = db
      .prepare(
        `SELECT COUNT(*) as totalVideos,
                SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as publishedVideos
         FROM videos`
      )
      .get() as { totalVideos: number; publishedVideos: number | null };

    const viewTotals = db.prepare('SELECT COUNT(*) as totalViews FROM video_views').get() as {
      totalViews: number;
    };

    const liveTotals = db.prepare('SELECT COUNT(*) as activeLiveUsers FROM live_sessions').get() as {
      activeLiveUsers: number;
    };

    const recentRows = db
      .prepare(
        `SELECT v.id, v.title, v.thumbnail_url, v.source_type, v.category, v.status, v.created_at,
                (SELECT COUNT(*) FROM video_views vv WHERE vv.video_id = v.id) as views,
                (SELECT COUNT(*) FROM live_sessions ls WHERE ls.video_id = v.id) as active_viewers
         FROM videos v
         ORDER BY v.created_at DESC
         LIMIT 6`
      )
      .all() as Array<{
        id: string;
        title: string;
        thumbnail_url: string;
        source_type: string;
        category: string;
        status: string;
        created_at: number;
        views: number;
        active_viewers: number;
      }>;

    res.json({
      stats: {
        totalVideos: videoTotals.totalVideos || 0,
        totalViews: viewTotals.totalViews || 0,
        activeLiveUsers: liveTotals.activeLiveUsers || 0,
        totalGeneratedLinks: videoTotals.publishedVideos || 0,
        storageUsedBytes: getStorageUsedBytes(),
      },
      recentVideos: recentRows.map((r) => ({
        id: r.id,
        title: r.title,
        thumbnailUrl: r.thumbnail_url,
        sourceType: r.source_type,
        category: r.category,
        status: r.status,
        createdAt: r.created_at,
        views: r.views,
        activeViewers: r.active_viewers,
      })),
    });
  });

  app.get('/api/admin/videos', requireAdmin, (req, res) => {
    cleanupExpiredSessions(65_000);
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const rows = db
      .prepare(
        `SELECT v.*,
                (SELECT COUNT(*) FROM video_views vv WHERE vv.video_id = v.id) as views,
                (SELECT COUNT(*) FROM live_sessions ls WHERE ls.video_id = v.id) as active_viewers
         FROM videos v
         ORDER BY v.created_at DESC`
      )
      .all() as Array<{
        id: string;
        title: string;
        description: string;
        thumbnail_url: string;
        source_type: string;
        source_url: string;
        storage_path: string;
        quality_sources: string;
        skip_intro_seconds: number;
        file_size_bytes: number;
        category: string;
        status: string;
        featured: number;
        created_at: number;
        updated_at: number;
        views: number;
        active_viewers: number;
      }>;

    const filtered = rows
      .filter((r) => {
        if (category && category !== 'All' && r.category.toLowerCase() !== category.toLowerCase()) return false;
        if (status && status !== 'all' && r.status !== status) return false;
        if (q) {
          const hay = `${r.title} ${r.id} ${r.category} ${r.description}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        thumbnailUrl: r.thumbnail_url,
        sourceType: r.source_type,
        sourceUrl: r.source_url,
        storagePath: r.storage_path,
        qualitySources: safeJsonParseQuality(r.quality_sources),
        skipIntroSeconds: Number(r.skip_intro_seconds) || 0,
        fileSizeBytes: r.file_size_bytes,
        category: r.category,
        status: r.status,
        featured: Boolean(r.featured),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        views: r.views,
        activeViewers: r.active_viewers,
      }));

    res.json({ videos: filtered });
  });

  app.post('/api/admin/videos', requireAdmin, (req, res) => {
    const {
      title,
      description = '',
      thumbnailUrl = '',
      sourceType,
      sourceUrl = '',
      storagePath = '',
      fileSizeBytes = 0,
      qualitySources = [],
      skipIntroSeconds,
      category = 'Movies',
      status = 'published',
      featured = false,
    } = req.body || {};

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    if (!cleanTitle || cleanTitle.length > 200) {
      return res.status(400).json({ error: 'Video title is required (max 200 characters).' });
    }

    if (sourceType !== 'upload' && sourceType !== 'external') {
      return res.status(400).json({ error: 'Invalid sourceType. Must be upload or external.' });
    }

    const validStatus = status === 'draft' || status === 'disabled' ? status : 'published';
    const cleanCategory = typeof category === 'string' && category.trim() ? category.trim().slice(0, 40) : 'Movies';
    const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 4000) : '';
    const settings = getSettingsMap();
    const defaultSkip = Math.max(0, Number(settings.default_skip_intro ?? 37) || 37);
    const cleanSkipIntro =
      skipIntroSeconds !== undefined && skipIntroSeconds !== null && skipIntroSeconds !== ''
        ? Math.max(0, Math.min(600, Math.floor(Number(skipIntroSeconds) || 0)))
        : defaultSkip;

    let finalSourceUrl = '';
    let finalStoragePath = '';

    if (sourceType === 'external') {
      const check = validateExternalPlayerUrl(String(sourceUrl));
      if (!check.valid || !check.normalized) {
        return res.status(400).json({ error: check.reason || 'Invalid external player URL.' });
      }
      finalSourceUrl = check.normalized;
    } else {
      const safeFile = path.basename(String(storagePath || ''));
      const fullMedia = path.join(VIDEOS_UPLOAD_DIR, safeFile);
      if (!safeFile || !fs.existsSync(fullMedia)) {
        return res.status(400).json({ error: 'Uploaded media file could not be verified on server.' });
      }
      finalStoragePath = safeFile;
      finalSourceUrl = `/media/videos/${safeFile}`;
    }

    let finalThumb = typeof thumbnailUrl === 'string' ? thumbnailUrl.trim() : '';
    if (finalThumb && !finalThumb.startsWith('/media/') && !finalThumb.startsWith('/src/assets/')) {
      const thumbCheck = validateExternalPlayerUrl(finalThumb);
      if (!thumbCheck.valid) {
        return res.status(400).json({ error: `Invalid thumbnail URL: ${thumbCheck.reason}` });
      }
      finalThumb = thumbCheck.normalized || '';
    }

    const sanitizedQualities: { label: string; url: string }[] = [];
    if (Array.isArray(qualitySources)) {
      for (const item of qualitySources) {
        if (!item || typeof item.label !== 'string' || typeof item.url !== 'string') continue;
        const label = item.label.trim().slice(0, 20);
        const urlStr = item.url.trim();
        if (!label || !urlStr) continue;
        if (urlStr.startsWith('/media/')) {
          sanitizedQualities.push({ label, url: urlStr });
        } else {
          const v = validateExternalPlayerUrl(urlStr);
          if (!v.valid || !v.normalized) {
            return res.status(400).json({ error: `Invalid quality URL (${label}): ${v.reason}` });
          }
          sanitizedQualities.push({ label, url: v.normalized });
        }
      }
    }

    const id = createUniqueVideoId();
    const now = Date.now();

    if (featured) {
      db.prepare('UPDATE videos SET featured = 0').run();
    }

    db.prepare(
      `INSERT INTO videos (
        id, title, description, thumbnail_url, source_type, source_url, storage_path,
        quality_sources, skip_intro_seconds, file_size_bytes, category, status, featured, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      cleanTitle,
      cleanDesc,
      finalThumb,
      sourceType,
      finalSourceUrl,
      finalStoragePath,
      JSON.stringify(sanitizedQualities),
      cleanSkipIntro,
      Math.max(0, Number(fileSizeBytes) || 0),
      cleanCategory,
      validStatus,
      featured ? 1 : 0,
      now,
      now
    );

    res.status(201).json({
      video: {
        id,
        title: cleanTitle,
        description: cleanDesc,
        thumbnailUrl: finalThumb,
        sourceType,
        sourceUrl: finalSourceUrl,
        qualitySources: sanitizedQualities,
        skipIntroSeconds: cleanSkipIntro,
        category: cleanCategory,
        status: validStatus,
        featured: Boolean(featured),
        createdAt: now,
      },
    });
  });

  app.patch('/api/admin/videos/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as
      | {
          id: string;
          title: string;
          description: string;
          thumbnail_url: string;
          source_type: string;
          source_url: string;
          quality_sources: string;
          skip_intro_seconds: number;
          category: string;
          status: string;
          featured: number;
        }
      | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const body = req.body || {};
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : existing.title;
    const description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : existing.description;
    const category =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim().slice(0, 40)
        : existing.category;
    const status =
      body.status === 'published' || body.status === 'draft' || body.status === 'disabled'
        ? body.status
        : existing.status;
    const skipIntroSeconds =
      body.skipIntroSeconds !== undefined && body.skipIntroSeconds !== null
        ? Math.max(0, Math.min(600, Math.floor(Number(body.skipIntroSeconds) || 0)))
        : Number(existing.skip_intro_seconds) || 0;

    let thumbnailUrl =
      typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : existing.thumbnail_url;
    if (thumbnailUrl && !thumbnailUrl.startsWith('/media/') && !thumbnailUrl.startsWith('/src/assets/')) {
      const thumbCheck = validateExternalPlayerUrl(thumbnailUrl);
      if (!thumbCheck.valid) {
        return res.status(400).json({ error: `Invalid thumbnail URL: ${thumbCheck.reason}` });
      }
      thumbnailUrl = thumbCheck.normalized || '';
    }

    let sourceUrl = existing.source_url;
    if (existing.source_type === 'external' && typeof body.sourceUrl === 'string' && body.sourceUrl.trim()) {
      const check = validateExternalPlayerUrl(body.sourceUrl);
      if (!check.valid || !check.normalized) {
        return res.status(400).json({ error: check.reason || 'Invalid external player URL' });
      }
      sourceUrl = check.normalized;
    }

    let qualitySourcesStr = existing.quality_sources;
    if (Array.isArray(body.qualitySources)) {
      const sanitized: { label: string; url: string }[] = [];
      for (const item of body.qualitySources) {
        if (!item || typeof item.label !== 'string' || typeof item.url !== 'string') continue;
        const label = item.label.trim().slice(0, 20);
        const urlStr = item.url.trim();
        if (!label || !urlStr) continue;
        if (urlStr.startsWith('/media/')) {
          sanitized.push({ label, url: urlStr });
        } else {
          const check = validateExternalPlayerUrl(urlStr);
          if (!check.valid || !check.normalized) {
            return res.status(400).json({ error: `Invalid quality URL (${label}): ${check.reason}` });
          }
          sanitized.push({ label, url: check.normalized });
        }
      }
      qualitySourcesStr = JSON.stringify(sanitized);
    }

    const featured = typeof body.featured === 'boolean' ? (body.featured ? 1 : 0) : existing.featured;
    if (featured === 1) {
      db.prepare('UPDATE videos SET featured = 0 WHERE id != ?').run(id);
    }

    db.prepare(
      `UPDATE videos
       SET title = ?, description = ?, thumbnail_url = ?, source_url = ?, quality_sources = ?,
           skip_intro_seconds = ?, category = ?, status = ?, featured = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      title,
      description,
      thumbnailUrl,
      sourceUrl,
      qualitySourcesStr,
      skipIntroSeconds,
      category,
      status,
      featured,
      Date.now(),
      id
    );

    res.json({ ok: true });
  });

  app.delete('/api/admin/videos/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    const row = db
      .prepare('SELECT id, storage_path, thumbnail_url FROM videos WHERE id = ?')
      .get(id) as { id: string; storage_path: string; thumbnail_url: string } | undefined;

    if (!row) {
      return res.status(404).json({ error: 'Video not found' });
    }

    db.prepare('DELETE FROM videos WHERE id = ?').run(id);

    if (row.storage_path) {
      const file = path.join(VIDEOS_UPLOAD_DIR, path.basename(row.storage_path));
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
      }
    }

    if (row.thumbnail_url && row.thumbnail_url.startsWith('/media/thumbnails/')) {
      const thumbFile = path.join(THUMBNAILS_UPLOAD_DIR, path.basename(row.thumbnail_url));
      if (fs.existsSync(thumbFile)) {
        try {
          fs.unlinkSync(thumbFile);
        } catch {
          // ignore
        }
      }
    }

    res.json({ ok: true });
  });

  // Resumable chunked media upload endpoints
  app.post('/api/admin/upload/init', requireAdmin, (req, res) => {
    const { filename, totalSize, totalChunks } = req.body || {};
    const safeExt = path.extname(String(filename || 'video.mp4')).toLowerCase();
    const allowedExts = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.ogg', '.ogv']);
    if (!allowedExts.has(safeExt)) {
      return res.status(400).json({
        error: 'Unsupported video format. Supported formats: MP4, WebM, MOV, MKV, M4V, OGG.',
      });
    }

    const uploadId = generateId(16);
    const chunkDir = path.join(TMP_UPLOAD_DIR, uploadId);
    fs.mkdirSync(chunkDir, { recursive: true });
    fs.writeFileSync(
      path.join(chunkDir, 'meta.json'),
      JSON.stringify({
        ext: safeExt,
        totalSize: Number(totalSize) || 0,
        totalChunks: Number(totalChunks) || 1,
        createdAt: Date.now(),
      })
    );

    res.json({ uploadId });
  });

  app.put('/api/admin/upload/chunk', requireAdmin, (req, res) => {
    const uploadId = String(req.headers['x-upload-id'] || '').replace(/[^A-Za-z0-9]/g, '');
    const chunkIndex = parseInt(String(req.headers['x-chunk-index'] || ''), 10);

    if (!uploadId || Number.isNaN(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ error: 'Invalid upload chunk headers' });
    }

    const chunkDir = path.join(TMP_UPLOAD_DIR, uploadId);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      return res.status(400).json({ error: 'Binary chunk payload required' });
    }

    const chunkPath = path.join(chunkDir, `chunk_${String(chunkIndex).padStart(6, '0')}`);
    fs.writeFileSync(chunkPath, body);
    res.json({ ok: true, chunkIndex, bytes: body.length });
  });

  app.post('/api/admin/upload/complete', requireAdmin, async (req, res) => {
    const uploadId = String((req.body && req.body.uploadId) || '').replace(/[^A-Za-z0-9]/g, '');
    const chunkDir = path.join(TMP_UPLOAD_DIR, uploadId);
    const metaPath = path.join(chunkDir, 'meta.json');

    if (!uploadId || !fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      ext: string;
      totalChunks: number;
    };

    const finalFilename = `${generateId(12)}${meta.ext}`;
    const finalPath = path.join(VIDEOS_UPLOAD_DIR, finalFilename);

    try {
      const writeStream = fs.createWriteStream(finalPath);
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(6, '0')}`);
        if (!fs.existsSync(chunkPath)) {
          writeStream.destroy();
          if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
          return res.status(400).json({ error: `Missing chunk ${i}. Resume upload and retry.` });
        }
        const buf = fs.readFileSync(chunkPath);
        await new Promise<void>((resolve, reject) => {
          writeStream.write(buf, (err) => (err ? reject(err) : resolve()));
        });
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      const stat = fs.statSync(finalPath);
      fs.rmSync(chunkDir, { recursive: true, force: true });

      res.json({
        storagePath: finalFilename,
        streamUrl: `/media/videos/${finalFilename}`,
        fileSizeBytes: stat.size,
      });
    } catch (err) {
      console.error('Upload assembly failed:', err);
      res.status(500).json({ error: 'Failed to finalize uploaded media file.' });
    }
  });

  app.post('/api/admin/upload/thumbnail', requireAdmin, (req, res) => {
    const rawExt = path.extname(String(req.headers['x-filename'] || 'thumb.jpg')).toLowerCase();
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const ext = allowed.has(rawExt) ? rawExt : '.jpg';

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Image binary payload required' });
    }

    const filename = `${generateId(12)}${ext}`;
    const dest = path.join(THUMBNAILS_UPLOAD_DIR, filename);
    fs.writeFileSync(dest, req.body);

    res.json({ thumbnailUrl: `/media/thumbnails/${filename}` });
  });

  app.get('/api/admin/live-sessions', requireAdmin, (_req, res) => {
    res.json(getLiveSnapshot());
  });

  app.get('/api/admin/analytics', requireAdmin, (req, res) => {
    const range = typeof req.query.range === 'string' ? req.query.range : '7d';
    const now = Date.now();
    let since = 0;
    let bucketDays = 7;

    if (range === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      since = startOfDay.getTime();
      bucketDays = 1;
    } else if (range === '7d') {
      since = now - 7 * 24 * 60 * 60 * 1000;
      bucketDays = 7;
    } else if (range === '30d') {
      since = now - 30 * 24 * 60 * 60 * 1000;
      bucketDays = 30;
    } else {
      since = 0;
      bucketDays = 14;
    }

    const summary = db
      .prepare(
        `SELECT COUNT(*) as totalViews,
                COALESCE(AVG(watched_duration), 0) as avgWatchDuration
         FROM video_views
         WHERE created_at >= ?`
      )
      .get(since) as { totalViews: number; avgWatchDuration: number };

    const allTimeSummary = db
      .prepare('SELECT COUNT(*) as totalAllTimeViews FROM video_views')
      .get() as { totalAllTimeViews: number };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyRow = db
      .prepare('SELECT COUNT(*) as count FROM video_views WHERE created_at >= ?')
      .get(todayStart.getTime()) as { count: number };

    const weekRow = db
      .prepare('SELECT COUNT(*) as count FROM video_views WHERE created_at >= ?')
      .get(now - 7 * 24 * 60 * 60 * 1000) as { count: number };

    const monthRow = db
      .prepare('SELECT COUNT(*) as count FROM video_views WHERE created_at >= ?')
      .get(now - 30 * 24 * 60 * 60 * 1000) as { count: number };

    const errorRow = db
      .prepare("SELECT COUNT(*) as count FROM analytics WHERE event_type = 'error' AND created_at >= ?")
      .get(since) as { count: number };

    const shareRow = db
      .prepare("SELECT COUNT(*) as count FROM analytics WHERE event_type = 'share' AND created_at >= ?")
      .get(since) as { count: number };

    const mostWatched = db
      .prepare(
        `SELECT v.id, v.title, v.category, v.thumbnail_url,
                COUNT(vv.id) as views,
                COALESCE(AVG(vv.watched_duration), 0) as avgDuration
         FROM videos v
         LEFT JOIN video_views vv ON vv.video_id = v.id AND vv.created_at >= ?
         GROUP BY v.id
         ORDER BY views DESC, v.created_at DESC
         LIMIT 8`
      )
      .all(since) as Array<{
        id: string;
        title: string;
        category: string;
        thumbnail_url: string;
        views: number;
        avgDuration: number;
      }>;

    // Build real date buckets for the chart
    const rawViewTimestamps = db
      .prepare('SELECT created_at FROM video_views WHERE created_at >= ?')
      .all(since) as { created_at: number }[];

    const bucketsMap = new Map<string, number>();
    for (let i = bucketDays - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      bucketsMap.set(key, 0);
    }

    for (const row of rawViewTimestamps) {
      const key = new Date(row.created_at).toISOString().slice(0, 10);
      if (bucketsMap.has(key)) {
        bucketsMap.set(key, (bucketsMap.get(key) || 0) + 1);
      } else if (range === 'all') {
        bucketsMap.set(key, (bucketsMap.get(key) || 0) + 1);
      }
    }

    const dailySeries = Array.from(bucketsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, views]) => ({ date, views }));

    cleanupExpiredSessions(65_000);
    const activeNow = (db.prepare('SELECT COUNT(*) as c FROM live_sessions').get() as { c: number }).c;

    res.json({
      range,
      metrics: {
        filteredViews: summary.totalViews,
        allTimeViews: allTimeSummary.totalAllTimeViews,
        dailyViews: dailyRow.count,
        weeklyViews: weekRow.count,
        monthlyViews: monthRow.count,
        activeViewers: activeNow,
        avgWatchDurationSec: Math.round(summary.avgWatchDuration || 0),
        playbackErrors: errorRow.count,
        shares: shareRow.count,
      },
      dailySeries,
      mostWatched: mostWatched.map((m) => ({
        id: m.id,
        title: m.title,
        category: m.category,
        thumbnailUrl: m.thumbnail_url,
        views: m.views,
        avgDurationSec: Math.round(m.avgDuration || 0),
      })),
    });
  });

  app.get('/api/admin/settings', requireAdmin, (_req, res) => {
    const map = getSettingsMap();
    res.json({
      telegramChannel: map.telegram_channel || '@NETWORKBOYOU',
      telegramContact: map.telegram_contact || '@SAMVIIR',
      relatedVideosEnabled: map.related_videos_enabled !== 'false',
      siteTagline: map.site_tagline || '',
      watermarkEnabled: map.watermark_enabled !== 'false',
      watermarkText: map.watermark_text || 'LINKPLAYHD · @SAMVIIR',
      watermarkImageUrl: map.watermark_image_url || '',
      defaultSkipIntro: Math.max(0, Number(map.default_skip_intro ?? 37) || 0),
      screenShieldEnabled: map.screen_shield_enabled !== 'false',
    });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const {
      telegramChannel,
      telegramContact,
      relatedVideosEnabled,
      siteTagline,
      watermarkEnabled,
      watermarkText,
      watermarkImageUrl,
      defaultSkipIntro,
      screenShieldEnabled,
    } = req.body || {};
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );

    if (typeof telegramChannel === 'string' && telegramChannel.trim()) {
      upsert.run('telegram_channel', telegramChannel.trim().slice(0, 64));
    }
    if (typeof telegramContact === 'string' && telegramContact.trim()) {
      upsert.run('telegram_contact', telegramContact.trim().slice(0, 64));
    }
    if (typeof relatedVideosEnabled === 'boolean') {
      upsert.run('related_videos_enabled', relatedVideosEnabled ? 'true' : 'false');
    }
    if (typeof siteTagline === 'string') {
      upsert.run('site_tagline', siteTagline.trim().slice(0, 140));
    }
    if (typeof watermarkEnabled === 'boolean') {
      upsert.run('watermark_enabled', watermarkEnabled ? 'true' : 'false');
    }
    if (typeof watermarkText === 'string') {
      upsert.run('watermark_text', watermarkText.trim().slice(0, 80));
    }
    if (typeof watermarkImageUrl === 'string') {
      const cleanWm = watermarkImageUrl.trim();
      if (!cleanWm || cleanWm.startsWith('/media/') || cleanWm.startsWith('/src/assets/')) {
        upsert.run('watermark_image_url', cleanWm);
      } else {
        const check = validateExternalPlayerUrl(cleanWm);
        if (!check.valid) {
          return res.status(400).json({ error: `Invalid watermark image URL: ${check.reason}` });
        }
        upsert.run('watermark_image_url', check.normalized || '');
      }
    }
    if (defaultSkipIntro !== undefined) {
      upsert.run(
        'default_skip_intro',
        String(Math.max(0, Math.min(600, Math.floor(Number(defaultSkipIntro) || 0))))
      );
    }
    if (typeof screenShieldEnabled === 'boolean') {
      upsert.run('screen_shield_enabled', screenShieldEnabled ? 'true' : 'false');
    }

    res.json({ ok: true });
  });

  app.post('/api/admin/change-password', requireAdmin, (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const admin = db
      .prepare('SELECT id, password_hash FROM admins WHERE id = ?')
      .get(req.admin!.id) as { id: number; password_hash: string } | undefined;

    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(
      hashPassword(newPassword),
      admin.id
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/export', requireAdmin, (_req, res) => {
    const videos = db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all();
    const settings = getSettingsMap();
    res.setHeader('Content-Disposition', 'attachment; filename="linkplayhd-backup.json"');
    res.json({ exportedAt: new Date().toISOString(), settings, videos });
  });

  // ========================
  // VITE / STATIC SERVING
  // ========================

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
        return next();
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LINKPLAYHD server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LINKPLAYHD server:', err);
  process.exit(1);
});
