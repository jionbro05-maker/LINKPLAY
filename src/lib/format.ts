export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDateShort(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export function getTelegramHref(handle: string): string {
  const clean = (handle || '').replace(/^@/, '').trim();
  return clean ? `https://t.me/${clean}` : 'https://t.me/NETWORKBOYOU';
}

export function getWatchUrl(videoId: string): string {
  return `${window.location.origin}/watch/${videoId}`;
}

export function detectStreamKind(url: string): 'hls' | 'native' | 'embed' {
  const raw = (url || '').trim();
  const lower = raw.toLowerCase();
  const clean = raw.split('?')[0].split('#')[0].toLowerCase();
  if (
    clean.endsWith('.m3u8') ||
    lower.includes('.m3u8') ||
    lower.includes('format=m3u8') ||
    lower.includes('type=hls')
  ) {
    return 'hls';
  }
  if (
    clean.startsWith('/media/videos/') ||
    clean.endsWith('.mp4') ||
    clean.endsWith('.webm') ||
    clean.endsWith('.mov') ||
    clean.endsWith('.m4v') ||
    clean.endsWith('.mkv') ||
    clean.endsWith('.ogg') ||
    clean.endsWith('.ogv') ||
    /\.(mp4|webm|mov|m4v|mkv)(\?|&|#|$)/i.test(lower) ||
    lower.includes('mime=video%2f') ||
    lower.includes('mime=video/')
  ) {
    return 'native';
  }
  return 'embed';
}
