import { useEffect, useRef, useState } from 'react';

const SESSION_KEY = 'lp_browser_session_id';

export function getBrowserSessionId(): string {
  try {
    let existing = sessionStorage.getItem(SESSION_KEY);
    if (!existing) {
      const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      existing = `sess_${rand}`;
      sessionStorage.setItem(SESSION_KEY, existing);
    }
    return existing;
  } catch {
    return `sess_${Date.now().toString(36)}`;
  }
}

export function useLivePresence(videoId: string | null) {
  const [totalActive, setTotalActive] = useState<number>(0);
  const [videoCounts, setVideoCounts] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const currentVideoRef = useRef<string | null>(videoId);

  useEffect(() => {
    currentVideoRef.current = videoId;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'heartbeat',
          sessionId: getBrowserSessionId(),
          videoId: videoId || 'home',
        })
      );
    }
  }, [videoId]);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    const sessionId = getBrowserSessionId();

    const sendHttpHeartbeat = async () => {
      try {
        const res = await fetch('/api/public/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            videoId: currentVideoRef.current || 'home',
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { totalActive?: number; byVideo?: Record<string, number> };
          if (typeof data.totalActive === 'number') setTotalActive(data.totalActive);
          if (data.byVideo) setVideoCounts(data.byVideo);
        }
      } catch {
        // Ignore transient network errors
      }
    };

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'heartbeat',
            sessionId,
            videoId: currentVideoRef.current || 'home',
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            totalActive?: number;
            byVideo?: Record<string, number>;
          };
          if (msg.type === 'presence:counts') {
            if (typeof msg.totalActive === 'number') setTotalActive(msg.totalActive);
            if (msg.byVideo) setVideoCounts(msg.byVideo);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 4000);
        }
      };

      ws.onerror = () => {
        sendHttpHeartbeat();
      };
    };

    connect();
    heartbeatTimer = window.setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'heartbeat',
            sessionId,
            videoId: currentVideoRef.current || 'home',
          })
        );
      } else {
        sendHttpHeartbeat();
      }
    }, 20_000);

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { totalActive, videoCounts };
}
