const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  return RAW_API_BASE ? `${RAW_API_BASE}${path}` : path;
}

export function resolveMediaUrl(src?: string): string {
  if (!src) return '';
  if (src.startsWith('/media/') && RAW_API_BASE) {
    return `${RAW_API_BASE}${src}`;
  }
  return src;
}

export function wsUrl(): string {
  if (RAW_API_BASE) {
    try {
      const parsed = new URL(RAW_API_BASE);
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${parsed.host}/ws`;
    } catch {
      // fallback to window host
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export async function parseJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    if (contentType.includes('text/html') || res.status === 404 || res.status === 405) {
      throw new Error(
        'Backend API server is not running at this URL (received webpage HTML instead of JSON). Deploy this project as a Node.js web service (npm run build && npm start) or set VITE_API_BASE_URL.'
      );
    }
    throw new Error(`${fallbackMessage} (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}
