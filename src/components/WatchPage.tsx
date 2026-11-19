import { ArrowLeft, Check, Copy, EyeOff, Send, Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { apiUrl, parseJsonResponse } from '../lib/api';
import { formatDateShort, getTelegramHref, getWatchUrl } from '../lib/format';
import { getBrowserSessionId } from '../lib/session';
import { PublicConfig, RelatedVideoItem, VideoItem } from '../types';
import { ShareModal } from './ShareModal';
import { ThumbnailImage } from './ThumbnailImage';
import { VideoPlayer } from './VideoPlayer';

interface WatchPageProps {
  videoId: string;
  onNavigate: (path: string) => void;
  videoCounts: Record<string, number>;
  config: PublicConfig;
}

export function WatchPage({ videoId, onNavigate, videoCounts, config }: WatchPageProps) {
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [related, setRelated] = useState<RelatedVideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<{ message: string; disabled?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorState(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    fetch(apiUrl(`/api/public/videos/${encodeURIComponent(videoId)}`))
      .then(async (res) => {
        const body = await parseJsonResponse<{
          video?: VideoItem;
          related?: RelatedVideoItem[];
          error?: string;
          disabled?: boolean;
        }>(res, 'Video not found');
        if (!res.ok || !body.video) {
          throw {
            message: body.error || 'Video not found',
            disabled: Boolean(body.disabled),
          };
        }
        return body as { video: VideoItem; related: RelatedVideoItem[] };
      })
      .then((data) => {
        if (active) {
          setVideo(data.video);
          setRelated(data.related || []);
        }
      })
      .catch((err) => {
        if (active) {
          setErrorState({
            message: err?.message || 'Unable to load this stream',
            disabled: Boolean(err?.disabled),
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [videoId]);

  const recordWatchDuration = useCallback(
    (seconds: number) => {
      fetch(apiUrl('/api/public/views'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          sessionId: getBrowserSessionId(),
          watchedDuration: seconds,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { views?: number } | null) => {
          if (data && typeof data.views === 'number') {
            setVideo((prev) => (prev ? { ...prev, views: data.views! } : prev));
          }
        })
        .catch(() => {});
    },
    [videoId]
  );

  useEffect(() => {
    if (video) {
      recordWatchDuration(0);
    }
  }, [video?.id, recordWatchDuration]);

  const logEvent = useCallback(
    (eventType: 'play' | 'pause' | 'error' | 'share', metadata?: string) => {
      fetch(apiUrl('/api/public/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, eventType, metadata }),
      }).catch(() => {});
    },
    [videoId]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getWatchUrl(videoId));
      setCopied(true);
      logEvent('share', 'copy_link');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const liveViewers = videoCounts[videoId] ?? video?.activeViewers ?? 0;

  if (loading) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8">
        <div className="skeleton-shimmer aspect-video w-full rounded-xl" />
        <div className="mt-6 space-y-3">
          <div className="skeleton-shimmer h-8 w-2/3 rounded-lg" />
          <div className="skeleton-shimmer h-4 w-1/3 rounded" />
          <div className="skeleton-shimmer h-20 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (errorState || !video) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#15171E] text-[#9CA3B2]">
          <EyeOff className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-white glow-hero-title">
          {errorState?.disabled ? 'Link Disabled' : 'Stream Unavailable'}
        </h1>
        <p className="mt-2 text-sm text-[#9CA3B2]">
          {errorState?.message || 'This LINKPLAYHD watch URL could not be found or has been removed.'}
        </p>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#E50914] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#F6121D] cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#9CA3B2] transition-colors hover:text-white cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          All Streams
        </button>
        <span className="font-mono-tabular text-xs text-[#9CA3B2]">ID: {video.id}</span>
      </div>

      {/* Main Theater Player */}
      <VideoPlayer
        videoId={video.id}
        title={video.title}
        sourceUrl={video.sourceUrl}
        thumbnailUrl={video.thumbnailUrl}
        qualitySources={video.qualitySources}
        skipIntroSeconds={video.skipIntroSeconds ?? config.defaultSkipIntro ?? 37}
        watermarkEnabled={config.watermarkEnabled}
        watermarkText={config.watermarkText}
        watermarkImageUrl={config.watermarkImageUrl}
        screenShieldEnabled={config.screenShieldEnabled}
        onWatchDuration={recordWatchDuration}
        onAnalyticsEvent={logEvent}
      />

      {/* Video Metadata & Actions */}
      <div className="mt-6 flex flex-col gap-6 border-b border-white/[0.08] pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-2.5">
          <h1 className="font-display text-2xl font-bold text-white glow-hero-title [text-wrap:balance] sm:text-3xl">
            {video.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#9CA3B2]">
            <span className="font-medium text-[#F5F7FA]">{video.category}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{video.views} views</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums text-[#E50914] font-medium">
              {liveViewers} live session{liveViewers === 1 ? '' : 's'} watching
            </span>
            <span aria-hidden="true">·</span>
            <span>Published {formatDateShort(video.createdAt)}</span>
          </div>

          {video.description && (
            <p className="pt-2 text-sm leading-relaxed text-[#C7CDD9]">{video.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-[#15171E] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#1E212B] cursor-pointer"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Link Copied' : 'Copy Watch Link'}
          </button>

          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-[#E50914] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#F6121D] cursor-pointer"
          >
            <Share2 className="h-4 w-4" />
            Share &amp; QR
          </button>
        </div>
      </div>

      {/* Telegram Community Credit Strip */}
      <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#15171E] p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-sm font-semibold text-white">
            Official LINKPLAYHD Telegram Channels
          </h2>
          <p className="mt-1 text-xs text-[#9CA3B2]">
            Join {config.telegramChannel} for updates or reach {config.telegramContact} for support.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={getTelegramHref(config.telegramChannel)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1D202A] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#272B38]"
          >
            <Send className="h-3.5 w-3.5 text-[#E50914]" />
            {config.telegramChannel}
          </a>
          <a
            href={getTelegramHref(config.telegramContact)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-xs font-medium text-[#C7CDD9] transition-colors hover:text-white"
          >
            Contact {config.telegramContact}
          </a>
        </div>
      </div>

      {/* Related Videos */}
      {config.relatedVideosEnabled && related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-lg font-semibold text-white">More on LINKPLAYHD</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(`/watch/${item.id}`)}
                className="group flex flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#15171E] text-left transition-transform duration-200 hover:-translate-y-0.5 hover:border-white/20 cursor-pointer"
              >
                <div className="aspect-video w-full overflow-hidden bg-[#0B0C10]">
                  <ThumbnailImage
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                </div>
                <div className="p-4">
                  <div className="line-clamp-1 font-display text-sm font-semibold text-white group-hover:text-[#E50914]">
                    {item.title}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[#9CA3B2]">
                    <span>{item.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{item.views} views</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {shareOpen && (
        <ShareModal
          videoId={video.id}
          title={video.title}
          onClose={() => setShareOpen(false)}
          onShared={() => logEvent('share', 'modal')}
        />
      )}
    </motion.div>
  );
}
