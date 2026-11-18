import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  Play,
  QrCode,
  Search,
  Share2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateShort, getWatchUrl } from '../lib/format';
import { PublicConfig, VideoItem } from '../types';
import { ShareModal } from './ShareModal';
import { ThumbnailImage } from './ThumbnailImage';

interface HomePageProps {
  onNavigate: (path: string) => void;
  videoCounts: Record<string, number>;
  totalActive: number;
  config: PublicConfig;
}

export function HomePage({ onNavigate, videoCounts, totalActive }: HomePageProps) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [shareTarget, setShareTarget] = useState<VideoItem | null>(null);
  const [infoTarget, setInfoTarget] = useState<VideoItem | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch('/api/public/videos')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load catalog');
        return res.json();
      })
      .then((data: { videos: VideoItem[] }) => {
        if (active) {
          setVideos(data.videos || []);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Unable to load streams');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const v of videos) {
      if (v.category) set.add(v.category);
    }
    return Array.from(set);
  }, [videos]);

  const spotlightPool = useMemo(() => {
    if (videos.length === 0) return [];
    const featuredFirst = [...videos].sort((a, b) => Number(b.featured) - Number(a.featured));
    return featuredFirst.slice(0, 4);
  }, [videos]);

  const heroVideo = spotlightPool[heroIndex % Math.max(1, spotlightPool.length)] || null;

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return videos.filter((v) => {
      if (selectedCategory !== 'All' && v.category !== selectedCategory) return false;
      if (q) {
        const hay = `${v.title} ${v.description} ${v.category} ${v.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [videos, selectedCategory, searchQuery]);

  const netflixRows = useMemo(() => {
    if (selectedCategory !== 'All' || searchQuery.trim() || videos.length === 0) return [];
    const rows: Array<{ id: string; title: string; items: VideoItem[] }> = [];

    rows.push({
      id: 'trending',
      title: 'Trending on LINKPLAYHD',
      items: [...videos].sort((a, b) => b.views - a.views || b.createdAt - a.createdAt),
    });

    const catMap = new Map<string, VideoItem[]>();
    for (const v of videos) {
      const list = catMap.get(v.category) || [];
      list.push(v);
      catMap.set(v.category, list);
    }
    for (const [catName, items] of catMap.entries()) {
      rows.push({
        id: `cat-${catName}`,
        title: `${catName} Showcase`,
        items,
      });
    }

    return rows;
  }, [videos, selectedCategory, searchQuery]);

  const getLiveCount = (v: VideoItem) => videoCounts[v.id] ?? v.activeViewers ?? 0;

  return (
    <div className="min-h-[calc(100vh-140px)] bg-[#0B0C10] pb-16">
      {/* FULL-BLEED NETFLIX HERO BILLBOARD */}
      <section className="relative overflow-hidden bg-[#0B0C10]">
        {/* Ambient Cinema Crimson Aura */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/4 z-0 h-[420px] w-[520px] rounded-full bg-[#E50914]/14 blur-[140px]"
        />

        {loading ? (
          <div className="relative flex min-h-[540px] items-end px-4 pb-24 pt-28 sm:px-8 lg:min-h-[76vh]">
            <div className="mx-auto w-full max-w-[1440px] space-y-4">
              <div className="skeleton-shimmer h-4 w-44 rounded" />
              <div className="skeleton-shimmer h-14 w-2/3 max-w-xl rounded-lg" />
              <div className="skeleton-shimmer h-16 w-full max-w-lg rounded-lg" />
              <div className="flex gap-3 pt-2">
                <div className="skeleton-shimmer h-12 w-36 rounded-md" />
                <div className="skeleton-shimmer h-12 w-36 rounded-md" />
              </div>
            </div>
          </div>
        ) : heroVideo ? (
          <div className="relative min-h-[540px] lg:min-h-[78vh]">
            {/* Crossfading Cinema Backdrop */}
            <AnimatePresence mode="sync">
              <motion.div
                key={heroVideo.id}
                initial={{ opacity: 0.2, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0"
              >
                <ThumbnailImage
                  src={heroVideo.thumbnailUrl}
                  alt={heroVideo.title}
                  className="h-full w-full object-cover object-center"
                />
              </motion.div>
            </AnimatePresence>

            {/* Netflix-grade Multi-Stop Vignette Scrims */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#0B0C10] via-[#0B0C10]/75 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/35 to-[#0B0C10]/60" />

            <div className="relative z-10 mx-auto flex min-h-[540px] max-w-[1440px] flex-col justify-end px-4 pb-24 pt-28 sm:px-8 lg:min-h-[78vh] lg:pb-28">
              <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                <motion.div
                  key={`meta-${heroVideo.id}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="max-w-2xl space-y-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#C7CDD9]">
                    <span className="glow-accent-text font-bold uppercase tracking-wider text-[#E50914]">
                      Featured Premiere
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{heroVideo.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>HD Stream</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{heroVideo.views} views</span>
                    {totalActive > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1.5 tabular-nums text-white">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {totalActive} watching online
                        </span>
                      </>
                    )}
                  </div>

                  <h1 className="glow-hero-title font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-white [text-wrap:balance] sm:text-5xl lg:text-6xl">
                    {heroVideo.title}
                  </h1>

                  <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-[#D7DCE6] sm:text-base">
                    {heroVideo.description ||
                      'Stream instantly in high definition across mobile, desktop, and Smart TV browsers with shareable LINKPLAYHD links.'}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => onNavigate(`/watch/${heroVideo.id}`)}
                      className="inline-flex items-center gap-2.5 rounded-md bg-white px-7 py-3 text-sm font-bold text-[#0B0C10] shadow-lg transition-all duration-150 hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                    >
                      <Play className="h-5 w-5 fill-current" />
                      Play
                    </button>

                    <button
                      type="button"
                      onClick={() => setInfoTarget(heroVideo)}
                      className="inline-flex items-center gap-2 rounded-md bg-[#2A2E38]/85 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:bg-[#363B47] cursor-pointer"
                    >
                      <Info className="h-4 w-4" />
                      More Info
                    </button>

                    <button
                      type="button"
                      onClick={() => setShareTarget(heroVideo)}
                      aria-label="Share featured stream"
                      className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-[#0B0C10]/65 px-4 py-3 text-sm font-medium text-white backdrop-blur-md transition-colors hover:border-[#E50914] hover:text-[#FF4D58] cursor-pointer"
                    >
                      <Share2 className="h-4 w-4" />
                      Share
                    </button>
                  </div>
                </motion.div>

                {/* Billboard Spotlight Switcher */}
                {spotlightPool.length > 1 && (
                  <div className="flex items-center gap-3 self-start lg:self-end">
                    <div className="flex items-center gap-1.5">
                      {spotlightPool.map((item, idx) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-label={`Spotlight ${item.title}`}
                          onClick={() => setHeroIndex(idx)}
                          className={`h-1 rounded-full transition-all cursor-pointer ${
                            idx === heroIndex % spotlightPool.length
                              ? 'w-8 bg-[#E50914] shadow-[0_0_12px_rgba(229,9,20,0.6)]'
                              : 'w-4 bg-white/30 hover:bg-white/60'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Previous spotlight"
                        onClick={() =>
                          setHeroIndex((i) => (i - 1 + spotlightPool.length) % spotlightPool.length)
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#0B0C10]/70 text-white transition-colors hover:border-white/50 cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Next spotlight"
                        onClick={() => setHeroIndex((i) => (i + 1) % spotlightPool.length)}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#0B0C10]/70 text-white transition-colors hover:border-white/50 cursor-pointer"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden px-4 pb-20 pt-32 text-center sm:px-8 lg:min-h-[72vh]">
            <img
              src="/src/assets/images/hero_cinema_backdrop_1794848274895.jpg"
              alt="LINKPLAYHD Cinema"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/70 to-[#0B0C10]/85" />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 max-w-2xl"
            >
              <div className="glow-accent-text text-xs font-bold uppercase tracking-[0.2em] text-[#E50914]">
                LINKPLAYHD Private Cinema
              </div>
              <h1 className="glow-hero-title mt-3 font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Stream Without Clutter
              </h1>
              <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-[#C7CDD9] sm:text-base">
                Your streaming catalog is clean and ready. Open the Admin Studio to upload an MP4 video or publish a direct stream link with automatic promo skipping and your custom watermark.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('/admin')}
                className="mt-7 inline-flex items-center justify-center gap-2 rounded-md bg-[#E50914] px-7 py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(229,9,20,0.45)] transition-all hover:bg-[#F6121D] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                Open Admin Studio
              </button>
            </motion.div>
          </div>
        )}
      </section>

      {/* OVERLAPPING FIRST NETFLIX RAIL + CATALOG */}
      <section id="catalog-section" className="relative z-20 mx-auto -mt-12 max-w-[1440px] px-4 sm:px-8">
        {/* Error State */}
        {error && (
          <div className="mb-8 rounded-xl border border-red-500/25 bg-red-500/10 p-6 text-center">
            <p className="text-sm font-medium text-red-200">{error}</p>
          </div>
        )}

        {/* Loading Skeleton Rails */}
        {loading && (
          <div className="space-y-8">
            <div>
              <div className="skeleton-shimmer mb-4 h-5 w-48 rounded" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="skeleton-shimmer aspect-video w-full rounded-md" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Overlapping Trending Rail */}
        {!loading && !error && netflixRows.length > 0 && (
          <NetflixCarouselRow
            title={netflixRows[0].title}
            items={netflixRows[0].items}
            getLiveCount={getLiveCount}
            onWatch={(v) => onNavigate(`/watch/${v.id}`)}
            onShare={(v) => setShareTarget(v)}
            onInfo={(v) => setInfoTarget(v)}
          />
        )}

        {/* Category Filter & Search Toolbar */}
        {!loading && videos.length > 0 && (
          <div className="mt-10 flex flex-col gap-4 border-y border-white/[0.07] py-4 md:flex-row md:items-center md:justify-between">
            <div className="stream-scroll flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#E50914] text-white shadow-[0_0_16px_rgba(229,9,20,0.35)]'
                      : 'bg-[#15171E] text-[#9CA3B2] hover:bg-[#1D202A] hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3B2]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search titles, genres, or ID..."
                aria-label="Search catalog"
                className="w-full rounded-md border border-white/10 bg-[#15171E] py-2 pl-9 pr-3 text-xs text-white placeholder-[#9CA3B2]/70 focus:border-[#E50914] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Secondary Category Netflix Rails */}
        {!loading && !error && netflixRows.length > 1 && (
          <div className="mt-10 space-y-10">
            {netflixRows.slice(1).map((row) => (
              <NetflixCarouselRow
                key={row.id}
                title={row.title}
                items={row.items}
                getLiveCount={getLiveCount}
                onWatch={(v) => onNavigate(`/watch/${v.id}`)}
                onShare={(v) => setShareTarget(v)}
                onInfo={(v) => setInfoTarget(v)}
              />
            ))}
          </div>
        )}

        {/* Filtered / Search Grid */}
        {!loading && !error && (selectedCategory !== 'All' || searchQuery.trim()) && (
          <div className="mt-8">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold text-white">
                {searchQuery.trim() ? `Search results for "${searchQuery.trim()}"` : `${selectedCategory} Library`}
              </h2>
              <span className="font-mono-tabular text-xs text-[#9CA3B2]">
                {filteredVideos.length} title{filteredVideos.length === 1 ? '' : 's'}
              </span>
            </div>

            {filteredVideos.length === 0 ? (
              <div className="rounded-xl border border-white/[0.07] bg-[#15171E] p-12 text-center">
                <p className="text-sm font-medium text-white">No streams match your filter</p>
                <p className="mt-1 text-xs text-[#9CA3B2]">
                  Clear your search query or select All to browse every stream.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('All');
                    setSearchQuery('');
                  }}
                  className="mt-4 rounded-md bg-[#E50914] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {filteredVideos.map((video, idx) => (
                  <NetflixCard
                    key={video.id}
                    video={video}
                    index={idx}
                    liveCount={getLiveCount(video)}
                    onWatch={() => onNavigate(`/watch/${video.id}`)}
                    onShare={() => setShareTarget(video)}
                    onInfo={() => setInfoTarget(video)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Netflix "More Info" Title Preview Modal */}
      <AnimatePresence>
        {infoTarget && (
          <TitleInfoModal
            video={infoTarget}
            liveCount={getLiveCount(infoTarget)}
            onClose={() => setInfoTarget(null)}
            onPlay={() => {
              const target = infoTarget;
              setInfoTarget(null);
              onNavigate(`/watch/${target.id}`);
            }}
            onOpenShare={() => {
              const target = infoTarget;
              setInfoTarget(null);
              setShareTarget(target);
            }}
          />
        )}
      </AnimatePresence>

      {shareTarget && (
        <ShareModal
          videoId={shareTarget.id}
          title={shareTarget.title}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}

function NetflixCarouselRow({
  title,
  items,
  getLiveCount,
  onWatch,
  onShare,
  onInfo,
}: {
  title: string;
  items: VideoItem[];
  getLiveCount: (v: VideoItem) => number;
  onWatch: (v: VideoItem) => void;
  onShare: (v: VideoItem) => void;
  onInfo: (v: VideoItem) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  const scrollRail = (direction: 'left' | 'right') => {
    const el = railRef.current;
    if (!el) return;
    const distance = Math.max(320, el.clientWidth * 0.78);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  return (
    <div className="group/row relative">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold tracking-tight text-white sm:text-xl">
          {title}
        </h2>
        <span className="font-mono-tabular text-xs text-[#9CA3B2]">
          {items.length} stream{items.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label={`Scroll ${title} left`}
          onClick={() => scrollRail('left')}
          className="absolute bottom-2 left-0 top-0 z-30 hidden w-11 items-center justify-center rounded-l-md bg-black/65 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/85 group-hover/row:md:flex group-hover/row:opacity-100 cursor-pointer"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div
          ref={railRef}
          className="stream-scroll flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 pt-1"
        >
          {items.map((video, idx) => (
            <div key={video.id} className="w-[265px] shrink-0 snap-start sm:w-[300px] lg:w-[325px]">
              <NetflixCard
                video={video}
                index={idx}
                liveCount={getLiveCount(video)}
                onWatch={() => onWatch(video)}
                onShare={() => onShare(video)}
                onInfo={() => onInfo(video)}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-label={`Scroll ${title} right`}
          onClick={() => scrollRail('right')}
          className="absolute bottom-2 right-0 top-0 z-30 hidden w-11 items-center justify-center rounded-r-md bg-black/65 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/85 group-hover/row:md:flex group-hover/row:opacity-100 cursor-pointer"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

function NetflixCard({
  video,
  index,
  liveCount,
  onWatch,
  onShare,
  onInfo,
}: {
  video: VideoItem;
  index: number;
  liveCount: number;
  onWatch: () => void;
  onShare: () => void;
  onInfo: () => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.05, 0.3), ease: [0.16, 1, 0.3, 1] }}
      className="group/card relative overflow-hidden rounded-md border border-white/[0.08] bg-[#15171E] transition-all duration-200 hover:z-20 hover:scale-[1.03] hover:border-[#E50914]/50 hover:shadow-[0_14px_36px_rgba(0,0,0,0.65)]"
    >
      {/* 16:9 Cinema Frame */}
      <div className="relative aspect-video w-full overflow-hidden bg-[#0F1117]">
        <button
          type="button"
          onClick={onWatch}
          aria-label={`Play ${video.title}`}
          className="block h-full w-full cursor-pointer text-left"
        >
          <ThumbnailImage
            src={video.thumbnailUrl}
            alt={video.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-black/25 to-transparent" />
        </button>

        {/* Bottom Title & Quick Controls Overlay (Netflix-style) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
          <h3 className="line-clamp-1 font-display text-sm font-semibold text-white drop-shadow">
            {video.title}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#C7CDD9]">
            <span>{video.category}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{video.views} views</span>
            {liveCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums font-medium text-[#E50914]">{liveCount} watching</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hover Action Strip */}
      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-[#15171E] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onWatch}
            aria-label={`Play ${video.title}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#0B0C10] transition-transform hover:scale-105 cursor-pointer"
          >
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
          </button>
          <button
            type="button"
            onClick={onShare}
            aria-label={`Share ${video.title}`}
            title="Share & QR Code"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#1D202A] text-white transition-colors hover:border-[#E50914] hover:text-[#FF4D58] cursor-pointer"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onInfo}
          aria-label={`More info about ${video.title}`}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-[#C7CDD9] transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <Info className="h-3.5 w-3.5" />
          Details
        </button>
      </div>
    </motion.article>
  );
}

function TitleInfoModal({
  video,
  liveCount,
  onClose,
  onPlay,
  onOpenShare,
}: {
  video: VideoItem;
  liveCount: number;
  onClose: () => void;
  onPlay: () => void;
  onOpenShare: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getWatchUrl(video.id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-white/15 bg-[#15171E] shadow-2xl"
      >
        <div className="relative aspect-video w-full bg-[#0B0C10]">
          <ThumbnailImage
            src={video.thumbnailUrl}
            alt={video.title}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#15171E] via-[#15171E]/30 to-transparent" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#0B0C10]/80 text-white backdrop-blur-sm hover:bg-[#0B0C10] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute inset-x-0 bottom-0 p-6">
            <h2 className="glow-hero-title font-display text-2xl font-bold text-white sm:text-3xl">
              {video.title}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onPlay}
                className="inline-flex items-center gap-2 rounded-md bg-[#E50914] px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(229,9,20,0.35)] transition-colors hover:bg-[#F6121D] cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                Play Stream
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-[#0B0C10]/70 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur-sm hover:bg-[#1D202A] cursor-pointer"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Link Copied' : 'Copy Watch Link'}
              </button>
              <button
                type="button"
                onClick={onOpenShare}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-[#0B0C10]/70 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur-sm hover:bg-[#1D202A] cursor-pointer"
              >
                <QrCode className="h-4 w-4 text-[#E50914]" />
                QR Code
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3 px-6 pb-6 pt-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#9CA3B2]">
            <span className="font-semibold text-[#E50914]">{video.category}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{video.views} views</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums text-white">{liveCount} watching now</span>
            <span aria-hidden="true">·</span>
            <span>Published {formatDateShort(video.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">ID: {video.id}</span>
          </div>

          <p className="text-sm leading-relaxed text-[#D7DCE6]">
            {video.description ||
              'Stream in high definition on desktop, mobile, and Smart TV browsers using this permanent LINKPLAYHD watch link.'}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
