import Hls from 'hls.js';
import {
  AlertTriangle,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Shield,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectStreamKind, formatDuration } from '../lib/format';
import { QualitySource } from '../types';

interface VideoPlayerProps {
  videoId: string;
  title: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  qualitySources?: QualitySource[];
  skipIntroSeconds?: number;
  watermarkEnabled?: boolean;
  watermarkText?: string;
  watermarkImageUrl?: string;
  screenShieldEnabled?: boolean;
  onWatchDuration?: (seconds: number) => void;
  onAnalyticsEvent?: (eventType: 'play' | 'pause' | 'error' | 'share', metadata?: string) => void;
}

interface QualityOption {
  id: string;
  label: string;
  levelIndex?: number;
  url?: string;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatHeightToLabel(height: number): string {
  if (height >= 2160) return '2160p (4K)';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  return `${height}p`;
}

function buildEmbedUrlWithSkip(rawUrl: string, skipSeconds: number): {
  url: string;
  supportsAutoStart: boolean;
} {
  if (!skipSeconds || skipSeconds <= 0) {
    return { url: rawUrl, supportsAutoStart: false };
  }
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host.includes('youtube.com') ||
      host.includes('youtube-nocookie.com') ||
      host.includes('youtu.be')
    ) {
      parsed.searchParams.set('start', String(Math.floor(skipSeconds)));
      return { url: parsed.toString(), supportsAutoStart: true };
    }
    if (host.includes('dailymotion.com')) {
      parsed.searchParams.set('start', String(Math.floor(skipSeconds)));
      return { url: parsed.toString(), supportsAutoStart: true };
    }
    if (host.includes('vimeo.com')) {
      parsed.hash = `t=${Math.floor(skipSeconds)}s`;
      return { url: parsed.toString(), supportsAutoStart: true };
    }
  } catch {
    // keep raw url
  }
  return { url: rawUrl, supportsAutoStart: false };
}

export function VideoPlayer({
  videoId,
  title,
  sourceUrl,
  thumbnailUrl,
  qualitySources = [],
  skipIntroSeconds = 37,
  watermarkEnabled = true,
  watermarkText = 'LINKPLAYHD · @SAMVIIR',
  watermarkImageUrl = '',
  screenShieldEnabled = true,
  onWatchDuration,
  onAnalyticsEvent,
}: VideoPlayerProps) {
  const streamKind = useMemo(() => detectStreamKind(sourceUrl), [sourceUrl]);

  // Embed state
  const [embedStarted, setEmbedStarted] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const embedSecondsRef = useRef(0);

  // Native / HLS player state
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' }>({ time: 0, side: 'left' });

  const [activeMediaUrl, setActiveMediaUrl] = useState(sourceUrl);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activeMenu, setActiveMenu] = useState<'none' | 'quality' | 'speed'>('none');
  const [hoverTime, setHoverTime] = useState<{ x: number; time: number } | null>(null);
  const [skipBadge, setSkipBadge] = useState<{ dir: 'back' | 'forward'; key: number } | null>(null);
  const [centerFlash, setCenterFlash] = useState<{ state: 'play' | 'pause'; key: number } | null>(null);
  const [introSkippedToast, setIntroSkippedToast] = useState(false);
  const [shieldPaused, setShieldPaused] = useState(false);
  const [watermarkCorner, setWatermarkCorner] = useState<0 | 1 | 2 | 3>(0);

  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string>('auto');
  const [retryNonce, setRetryNonce] = useState(0);

  const totalWatchedRef = useRef(0);
  const lastReportedRef = useRef(0);
  const resumeRestoredRef = useRef(false);
  const introSkippedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const showIntroToast = useCallback(() => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setIntroSkippedToast(true);
    toastTimerRef.current = window.setTimeout(() => setIntroSkippedToast(false), 3200);
  }, []);

  const applyInitialIntroSkip = useCallback(
    (
      v: HTMLVideoElement,
      _sourceEvent: 'metadata' | 'loadeddata' | 'canplay' | 'play' | 'playing' | 'timeupdate'
    ) => {
      if (introSkippedRef.current) return;
      if (skipIntroSeconds <= 0) {
        introSkippedRef.current = true;
        return;
      }

      const dur = v.duration;
      if (Number.isFinite(dur) && dur > 0 && dur <= skipIntroSeconds + 1) {
        introSkippedRef.current = true;
        return;
      }

      if (!resumeRestoredRef.current) {
        try {
          const saved = Number(localStorage.getItem(`lp_resume_${videoId}`) || '0');
          if (
            Number.isFinite(saved) &&
            saved > skipIntroSeconds &&
            (!Number.isFinite(dur) || dur === 0 || saved < dur * 0.95)
          ) {
            resumeRestoredRef.current = true;
            if (Math.abs(v.currentTime - saved) > 1.5 && v.readyState >= 1) {
              v.currentTime = saved;
              setCurrentTime(saved);
            }
            if (v.currentTime >= skipIntroSeconds - 1) {
              introSkippedRef.current = true;
            }
            return;
          }
        } catch {
          // ignore
        }
        resumeRestoredRef.current = true;
      }

      if (v.currentTime >= skipIntroSeconds - 1.5) {
        introSkippedRef.current = true;
        return;
      }

      if (v.readyState >= 1) {
        try {
          v.currentTime = skipIntroSeconds;
          setCurrentTime(skipIntroSeconds);
        } catch {
          // Retry on subsequent playback events
        }
      }
    },
    [skipIntroSeconds, videoId]
  );

  // Subtle periodic watermark corner drift so screen recordings cannot cleanly crop it
  useEffect(() => {
    if (!watermarkEnabled) return;
    const timer = window.setInterval(() => {
      setWatermarkCorner((c) => ((c + 1) % 4) as 0 | 1 | 2 | 3);
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [watermarkEnabled]);

  // Reset when video changes
  useEffect(() => {
    setActiveMediaUrl(sourceUrl);
    setEmbedStarted(false);
    setEmbedLoaded(false);
    setErrorMsg(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setIsPlaying(false);
    setIsBuffering(true);
    setSelectedQualityId('auto');
    setActiveMenu('none');
    setIntroSkippedToast(false);
    setShieldPaused(false);
    totalWatchedRef.current = 0;
    lastReportedRef.current = 0;
    embedSecondsRef.current = 0;
    resumeRestoredRef.current = false;
    introSkippedRef.current = false;
  }, [videoId, sourceUrl]);

  // Screen Shield: pause & blur if tab hidden / capture deterrence
  useEffect(() => {
    if (!screenShieldEnabled) return;
    const handleVisibility = () => {
      if (document.hidden && videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
        setShieldPaused(true);
      }
    };
    const handleProtectedKeys = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        ['s', 'u'].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
      }
      if (e.key === 'PrintScreen') {
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        setShieldPaused(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('keydown', handleProtectedKeys);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('keydown', handleProtectedKeys);
    };
  }, [screenShieldEnabled]);

  // Track embed watch session duration cleanly
  useEffect(() => {
    if (streamKind !== 'embed') return;
    onWatchDuration?.(1);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        embedSecondsRef.current += 10;
        onWatchDuration?.(embedSecondsRef.current);
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [streamKind, videoId, onWatchDuration]);

  // Initialize HLS or Native HTML5 stream
  useEffect(() => {
    if (streamKind === 'embed') return;
    const video = videoRef.current;
    if (!video) return;

    setIsBuffering(true);
    setErrorMsg(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const activeKind = detectStreamKind(activeMediaUrl);

    if (activeKind === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          startPosition: skipIntroSeconds > 0 ? skipIntroSeconds : -1,
        });
        hlsRef.current = hls;
        hls.loadSource(activeMediaUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          setIsBuffering(false);
          const uniqueHeights = new Map<number, number>();
          data.levels.forEach((lvl, idx) => {
            if (lvl.height && !uniqueHeights.has(lvl.height)) {
              uniqueHeights.set(lvl.height, idx);
            }
          });
          const sortedLevels = Array.from(uniqueHeights.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([height, levelIndex]) => ({
              id: `lvl_${levelIndex}`,
              label: formatHeightToLabel(height),
              levelIndex,
            }));

          if (sortedLevels.length > 0) {
            setQualityOptions([{ id: 'auto', label: 'Auto', levelIndex: -1 }, ...sortedLevels]);
          } else {
            setQualityOptions([{ id: 'auto', label: 'Auto', levelIndex: -1 }]);
          }
          setSelectedQualityId('auto');
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setIsBuffering(false);
            const msg = 'Unable to load adaptive HLS stream. Check source availability or retry.';
            setErrorMsg(msg);
            onAnalyticsEvent?.('error', data.details || 'hls_fatal');
          }
        });

        return () => {
          hls.destroy();
          hlsRef.current = null;
        };
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = activeMediaUrl;
        setQualityOptions([{ id: 'auto', label: 'Auto (Native HLS)' }]);
      } else {
        setIsBuffering(false);
        setErrorMsg('HLS streaming is not supported in this browser.');
        onAnalyticsEvent?.('error', 'hls_unsupported');
      }
    } else {
      video.src = activeMediaUrl;
      if (qualitySources.length > 0) {
        const opts: QualityOption[] = [
          { id: 'auto', label: 'Default Source', url: sourceUrl },
          ...qualitySources.map((q, i) => ({
            id: `q_${i}_${q.label}`,
            label: q.label,
            url: q.url,
          })),
        ];
        setQualityOptions(opts);
      } else {
        setQualityOptions([{ id: 'source', label: 'Source Quality' }]);
        setSelectedQualityId('source');
      }
    }
  }, [activeMediaUrl, streamKind, qualitySources, sourceUrl, retryNonce, skipIntroSeconds, onAnalyticsEvent]);

  const scheduleControlsHide = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    if (isPlaying && activeMenu === 'none') {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2800);
    }
  }, [isPlaying, activeMenu]);

  useEffect(() => {
    scheduleControlsHide();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [isPlaying, activeMenu, scheduleControlsHide]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || errorMsg) return;
    setShieldPaused(false);
    if (video.paused) {
      applyInitialIntroSkip(video, 'play');
      video
        .play()
        .then(() => {
          applyInitialIntroSkip(video, 'playing');
        })
        .catch(() => {});
      setCenterFlash({ state: 'play', key: Date.now() });
      onAnalyticsEvent?.('play');
    } else {
      video.pause();
      setCenterFlash({ state: 'pause', key: Date.now() });
      onAnalyticsEvent?.('pause');
    }
    scheduleControlsHide();
  }, [applyInitialIntroSkip, errorMsg, onAnalyticsEvent, scheduleControlsHide]);

  const seekBy = useCallback(
    (deltaSec: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      const target = Math.max(0, Math.min(video.duration, video.currentTime + deltaSec));
      video.currentTime = target;
      setCurrentTime(target);
      setSkipBadge({ dir: deltaSec < 0 ? 'back' : 'forward', key: Date.now() });
      scheduleControlsHide();
    },
    [scheduleControlsHide]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      const vid = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      vid?.webkitEnterFullscreen?.();
    }
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (streamKind === 'embed') return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          seekBy(10);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'arrowup':
          e.preventDefault();
          if (videoRef.current) {
            const v = Math.min(1, videoRef.current.volume + 0.1);
            videoRef.current.volume = v;
            videoRef.current.muted = false;
            setVolume(v);
            setIsMuted(false);
          }
          break;
        case 'arrowdown':
          e.preventDefault();
          if (videoRef.current) {
            const v = Math.max(0, videoRef.current.volume - 0.1);
            videoRef.current.volume = v;
            setVolume(v);
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [streamKind, togglePlay, seekBy, toggleMute, toggleFullscreen]);

  const handleQualitySelect = (opt: QualityOption) => {
    setSelectedQualityId(opt.id);
    setActiveMenu('none');

    if (hlsRef.current && typeof opt.levelIndex === 'number') {
      hlsRef.current.currentLevel = opt.levelIndex;
      return;
    }

    if (opt.url && opt.url !== activeMediaUrl && videoRef.current) {
      const resumeAt = videoRef.current.currentTime;
      const wasPlaying = !videoRef.current.paused;
      setActiveMediaUrl(opt.url);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = resumeAt;
          if (wasPlaying) videoRef.current.play().catch(() => {});
        }
      }, 150);
    }
  };

  const handleSpeedSelect = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setActiveMenu('none');
  };

  const handleSurfaceClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const now = Date.now();
    const side: 'left' | 'right' = relX < 0.5 ? 'left' : 'right';

    if (now - lastTapRef.current.time < 280 && lastTapRef.current.side === side) {
      seekBy(side === 'left' ? -10 : 10);
      lastTapRef.current.time = 0;
      return;
    }

    lastTapRef.current = { time: now, side };
    togglePlay();
  };

  const watermarkCornerClass =
    watermarkCorner === 0
      ? 'top-4 right-4'
      : watermarkCorner === 1
      ? 'bottom-16 right-4'
      : watermarkCorner === 2
      ? 'bottom-16 left-4'
      : 'top-4 left-4';

  const WatermarkOverlay = watermarkEnabled ? (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-30 flex items-center gap-2 rounded-md bg-black/45 px-2.5 py-1.5 backdrop-blur-sm border border-white/10 transition-all duration-700 select-none ${watermarkCornerClass}`}
    >
      {watermarkImageUrl && (
        <img
          src={watermarkImageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-6 w-6 rounded object-cover"
        />
      )}
      <span className="font-display text-[11px] font-bold tracking-wide text-white/90 glow-wordmark">
        {watermarkText || 'LINKPLAYHD'}
      </span>
    </div>
  ) : null;

  // ========================
  // EXTERNAL EMBED RENDERER
  // ========================
  if (streamKind === 'embed') {
    const { url: embedSrc, supportsAutoStart } = buildEmbedUrlWithSkip(sourceUrl, skipIntroSeconds);
    return (
      <div className="w-full">
        <div
          ref={containerRef}
          onContextMenu={(e) => e.preventDefault()}
          className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-[#0B0C10] shadow-2xl select-none"
        >
          {WatermarkOverlay}

          {!embedStarted ? (
            <button
              type="button"
              onClick={() => {
                setEmbedStarted(true);
                onAnalyticsEvent?.('play', 'embed_start');
              }}
              className="group relative flex h-full w-full items-center justify-center bg-[#0B0C10] cursor-pointer"
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={title}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover opacity-55 transition-transform duration-500 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="h-full w-full bg-[radial-gradient(circle_at_center,rgba(229,9,20,0.22),#0B0C10_70%)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/35 to-[#0B0C10]/50" />
              <div className="relative z-10 flex flex-col items-center gap-3 px-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E50914] text-white shadow-[0_0_32px_rgba(229,9,20,0.65)] transition-transform duration-200 group-hover:scale-110">
                  <Play className="ml-1 h-7 w-7 fill-current" />
                </div>
                <span className="font-display text-sm font-bold tracking-wide text-white glow-wordmark">
                  Watch on LINKPLAYHD
                </span>
              </div>
            </button>
          ) : (
            <>
              {!embedLoaded && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0B0C10]">
                  <div className="h-11 w-11 animate-spin rounded-full border-2 border-[#E50914]/25 border-t-[#E50914]" />
                  <p className="mt-4 text-xs font-medium text-[#9CA3B2]">
                    Loading stream theater...
                  </p>
                </div>
              )}

              <iframe
                src={embedSrc}
                title={title}
                onLoad={() => setEmbedLoaded(true)}
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                className="h-full w-full border-0"
              />
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#15171E] px-4 py-2.5 text-xs text-[#9CA3B2]">
          <span>
            {supportsAutoStart
              ? `LINKPLAYHD Theater · Started past ${skipIntroSeconds}s intro`
              : 'LINKPLAYHD Branded Theater Mode'}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 font-medium text-white transition-colors hover:text-[#E50914] cursor-pointer"
            >
              {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
              Branded Fullscreen
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========================
  // CUSTOM PRO HTML5/HLS PLAYER
  // ========================
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const activeQualityLabel =
    qualityOptions.find((q) => q.id === selectedQualityId)?.label || 'Source Quality';

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={scheduleControlsHide}
      onTouchStart={scheduleControlsHide}
      className="group relative aspect-video w-full select-none overflow-hidden rounded-xl border border-white/10 bg-[#07080B] shadow-2xl"
    >
      {WatermarkOverlay}

      <video
        ref={videoRef}
        poster={thumbnailUrl || undefined}
        playsInline
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture={false}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleSurfaceClick}
        onLoadStart={() => setIsBuffering(true)}
        onWaiting={() => setIsBuffering(true)}
        onLoadedData={(e) => {
          applyInitialIntroSkip(e.currentTarget, 'loadeddata');
        }}
        onCanPlay={(e) => {
          setIsBuffering(false);
          applyInitialIntroSkip(e.currentTarget, 'canplay');
        }}
        onPlay={(e) => {
          applyInitialIntroSkip(e.currentTarget, 'play');
        }}
        onPlaying={(e) => {
          setIsPlaying(true);
          setIsBuffering(false);
          setShieldPaused(false);
          applyInitialIntroSkip(e.currentTarget, 'playing');
        }}
        onPause={() => setIsPlaying(false)}
        onDurationChange={(e) => {
          const dur = e.currentTarget.duration || 0;
          if (Number.isFinite(dur) && dur > 0) {
            setDuration(dur);
          }
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          const dur = v.duration || 0;
          if (Number.isFinite(dur) && dur > 0) {
            setDuration(dur);
          }
          setIsBuffering(false);
          applyInitialIntroSkip(v, 'metadata');
        }}
        onSeeked={(e) => {
          const v = e.currentTarget;
          setCurrentTime(v.currentTime);
          if (!introSkippedRef.current && skipIntroSeconds > 0 && v.currentTime >= skipIntroSeconds - 1.5) {
            introSkippedRef.current = true;
            showIntroToast();
          }
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (
            !introSkippedRef.current &&
            skipIntroSeconds > 0 &&
            v.currentTime < skipIntroSeconds - 1.5
          ) {
            applyInitialIntroSkip(v, 'timeupdate');
            return;
          }
          if (!introSkippedRef.current && skipIntroSeconds > 0 && v.currentTime >= skipIntroSeconds - 1.5) {
            introSkippedRef.current = true;
            showIntroToast();
          }
          setCurrentTime(v.currentTime);
          if (v.buffered.length > 0) {
            setBufferedEnd(v.buffered.end(v.buffered.length - 1));
          }
          if (!v.paused) {
            totalWatchedRef.current = Math.max(totalWatchedRef.current, Math.floor(v.currentTime));
            try {
              localStorage.setItem(`lp_resume_${videoId}`, String(Math.floor(v.currentTime)));
            } catch {
              // ignore
            }
            if (Math.abs(totalWatchedRef.current - lastReportedRef.current) >= 10) {
              lastReportedRef.current = totalWatchedRef.current;
              onWatchDuration?.(totalWatchedRef.current);
            }
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          setControlsVisible(true);
          onWatchDuration?.(Math.floor(duration || totalWatchedRef.current));
          try {
            localStorage.removeItem(`lp_resume_${videoId}`);
          } catch {
            // ignore
          }
        }}
        onError={() => {
          setIsBuffering(false);
          setIsPlaying(false);
          setErrorMsg('Playback failed. The media format may be unsupported or the source URL is unreachable.');
          onAnalyticsEvent?.('error', 'html5_video_error');
        }}
        className={`h-full w-full cursor-pointer object-contain transition-[filter] duration-200 [-webkit-touch-callout:none] ${
          shieldPaused ? 'blur-lg' : ''
        }`}
      />

      {/* Manual Skip Intro Action Chip (visible if currentTime < skipIntroSeconds) */}
      {skipIntroSeconds > 0 &&
        currentTime < skipIntroSeconds - 1 &&
        (!Number.isFinite(duration) || duration === 0 || duration > skipIntroSeconds + 1) &&
        !errorMsg &&
        !shieldPaused && (
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.currentTime = skipIntroSeconds;
              setCurrentTime(skipIntroSeconds);
              introSkippedRef.current = true;
              showIntroToast();
              if (v.paused) v.play().catch(() => {});
            }}
            className="absolute bottom-20 right-4 z-30 inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-[#0B0C10]/85 px-3.5 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md transition-all hover:border-[#E50914] hover:bg-[#E50914] cursor-pointer"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip Intro ({skipIntroSeconds}s)
          </button>
        )}

      {/* Auto-Skip Intro Toast */}
      <AnimatePresence>
        {introSkippedToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none absolute left-4 top-4 z-30 rounded-md border border-[#E50914]/40 bg-black/80 px-3 py-1.5 font-mono-tabular text-xs font-medium text-white backdrop-blur-md"
          >
            Skipped {skipIntroSeconds}s promo intro
          </motion.div>
        )}
      </AnimatePresence>

      {/* Screen Shield Blur Guard */}
      {shieldPaused && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 p-6 text-center backdrop-blur-md">
          <Shield className="h-9 w-9 text-[#E50914]" />
          <p className="mt-3 font-display text-sm font-semibold text-white">
            Protected Playback Paused
          </p>
          <p className="mt-1 text-xs text-[#9CA3B2]">
            Playback paused while window focus left this stream.
          </p>
          <button
            type="button"
            onClick={togglePlay}
            className="mt-4 rounded-md bg-[#E50914] px-5 py-2 text-xs font-semibold text-white hover:bg-[#F6121D] cursor-pointer"
          >
            Resume Watching
          </button>
        </div>
      )}

      {/* Buffering Spinner */}
      {isBuffering && !errorMsg && !shieldPaused && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-[#E50914]" />
        </div>
      )}

      {/* Center Play Prompt */}
      {!isPlaying && !isBuffering && !errorMsg && !shieldPaused && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#E50914] text-white shadow-xl transition-transform duration-150 hover:scale-105 hover:bg-[#F6121D] cursor-pointer"
        >
          <Play className="ml-1 h-7 w-7 fill-current" />
        </button>
      )}

      {/* Animated Center Play/Pause Ripple */}
      <AnimatePresence>
        {centerFlash && (
          <motion.div
            key={centerFlash.key}
            initial={{ opacity: 0.9, scale: 0.75 }}
            animate={{ opacity: 0, scale: 1.35 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => setCenterFlash(null)}
            className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white"
          >
            {centerFlash.state === 'play' ? (
              <Play className="ml-0.5 h-7 w-7 fill-current" />
            ) : (
              <Pause className="h-7 w-7 fill-current" />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Animated -10s / +10s Skip Indicator */}
      <AnimatePresence>
        {skipBadge && (
          <motion.div
            key={skipBadge.key}
            initial={{ opacity: 0, scale: 0.85, x: skipBadge.dir === 'back' ? 12 : -12 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.25 }}
            onAnimationComplete={() => {
              window.setTimeout(() => setSkipBadge(null), 350);
            }}
            className={`pointer-events-none absolute top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-black/75 px-5 py-3 text-white backdrop-blur-sm ${
              skipBadge.dir === 'back' ? 'left-[16%]' : 'right-[16%]'
            }`}
          >
            {skipBadge.dir === 'back' ? (
              <RotateCcw className="h-6 w-6" />
            ) : (
              <RotateCw className="h-6 w-6" />
            )}
            <span className="font-mono-tabular text-xs font-semibold">
              {skipBadge.dir === 'back' ? '-10s' : '+10s'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Overlay */}
      {errorMsg && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B0C10]/95 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <p className="mt-3 max-w-md text-sm font-medium text-white">{errorMsg}</p>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setRetryNonce((n) => n + 1);
            }}
            className="mt-4 rounded-md bg-[#E50914] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#F6121D] cursor-pointer"
          >
            Retry Playback
          </button>
        </div>
      )}

      {/* Bottom Controls Overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-3 pt-10 transition-opacity duration-200 sm:px-5 sm:pb-4 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* Timeline Progress Bar */}
        <div
          className="group/bar relative mb-3 flex h-5 cursor-pointer items-center"
          onMouseMove={(e) => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            setHoverTime({ x: e.clientX - rect.left, time: ratio * duration });
          }}
          onMouseLeave={() => setHoverTime(null)}
          onClick={(e) => {
            if (!videoRef.current || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            videoRef.current.currentTime = ratio * duration;
            setCurrentTime(ratio * duration);
          }}
        >
          {hoverTime && (
            <div
              style={{ left: `${hoverTime.x}px` }}
              className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-[#15171E] px-2 py-0.5 font-mono-tabular text-[11px] text-white shadow"
            >
              {formatDuration(hoverTime.time)}
            </div>
          )}
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/bar:h-2">
            <div
              style={{ width: `${bufferedPct}%` }}
              className="absolute inset-y-0 left-0 bg-white/30"
            />
            <div
              style={{ width: `${progressPct}%` }}
              className="absolute inset-y-0 left-0 bg-[#E50914]"
            />
          </div>
        </div>

        {/* Control Buttons Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 cursor-pointer"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              aria-label="Rewind 10 seconds"
              title="Back 10s (J / Left Arrow)"
              className="flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-white transition-colors hover:bg-white/10 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="font-mono-tabular hidden sm:inline">10s</span>
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              aria-label="Forward 10 seconds"
              title="Forward 10s (L / Right Arrow)"
              className="flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-white transition-colors hover:bg-white/10 cursor-pointer"
            >
              <RotateCw className="h-4 w-4" />
              <span className="font-mono-tabular hidden sm:inline">10s</span>
            </button>

            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4 text-[#9CA3B2]" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                aria-label="Volume"
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  setIsMuted(val === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = val;
                    videoRef.current.muted = val === 0;
                  }
                }}
                className="h-1 w-20 cursor-pointer accent-[#E50914]"
              />
            </div>

            <div className="ml-1 font-mono-tabular text-xs text-white/90">
              {formatDuration(currentTime)} <span className="text-white/40">/</span>{' '}
              <span className="text-white/70">{formatDuration(duration)}</span>
            </div>
          </div>

          <div className="relative flex items-center gap-1 sm:gap-2">
            {/* Playback Speed */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu((m) => (m === 'speed' ? 'none' : 'speed'))}
                className="flex h-10 items-center rounded-lg px-2.5 font-mono-tabular text-xs font-medium text-white transition-colors hover:bg-white/10 cursor-pointer"
              >
                {playbackRate}x
              </button>
              {activeMenu === 'speed' && (
                <div className="absolute bottom-12 right-0 z-30 min-w-[110px] rounded-lg border border-white/10 bg-[#15171E] p-1 shadow-xl">
                  {SPEED_OPTIONS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handleSpeedSelect(rate)}
                      className={`block w-full rounded-md px-3 py-1.5 text-left font-mono-tabular text-xs transition-colors cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-[#E50914] text-white'
                          : 'text-[#F5F7FA] hover:bg-white/10'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quality Management */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu((m) => (m === 'quality' ? 'none' : 'quality'))}
                className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/10 cursor-pointer"
              >
                <Settings2 className="h-4 w-4 text-[#E50914]" />
                <span className="hidden sm:inline whitespace-nowrap">{activeQualityLabel}</span>
              </button>
              {activeMenu === 'quality' && (
                <div className="absolute bottom-12 right-0 z-30 min-w-[155px] rounded-lg border border-white/10 bg-[#15171E] p-1 shadow-xl">
                  <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#9CA3B2]">
                    Stream Quality
                  </div>
                  {qualityOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleQualitySelect(opt)}
                      className={`block w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                        selectedQualityId === opt.id
                          ? 'bg-[#E50914] font-semibold text-white'
                          : 'text-[#F5F7FA] hover:bg-white/10'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <button
                type="button"
                onClick={togglePiP}
                aria-label="Picture in Picture"
                className="hidden sm:flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 cursor-pointer"
              >
                <PictureInPicture2 className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 cursor-pointer"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
