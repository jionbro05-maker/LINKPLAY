export interface QualitySource {
  label: string;
  url: string;
}

export interface VideoItem {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  sourceType: 'upload' | 'external';
  sourceUrl: string;
  storagePath?: string;
  qualitySources: QualitySource[];
  skipIntroSeconds: number;
  fileSizeBytes?: number;
  category: string;
  status: 'published' | 'draft' | 'disabled';
  featured: boolean;
  createdAt: number;
  updatedAt?: number;
  views: number;
  activeViewers: number;
}

export interface RelatedVideoItem {
  id: string;
  title: string;
  thumbnailUrl: string;
  category: string;
  views: number;
  createdAt: number;
}

export interface PublicConfig {
  brand: string;
  telegramChannel: string;
  telegramContact: string;
  relatedVideosEnabled: boolean;
  siteTagline: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkImageUrl: string;
  defaultSkipIntro: number;
  screenShieldEnabled: boolean;
}

export interface LiveSessionEntry {
  session_id: string;
  video_id: string | null;
  device_type: string;
  browser: string;
  last_heartbeat: number;
  created_at: number;
  video_title: string | null;
}

export interface LiveSnapshot {
  totalActiveSessions: number;
  watchingSessions: number;
  sessions: LiveSessionEntry[];
  byVideo: { videoId: string; title: string; count: number }[];
  timestamp: number;
}

export interface AdminOverview {
  stats: {
    totalVideos: number;
    totalViews: number;
    activeLiveUsers: number;
    totalGeneratedLinks: number;
    storageUsedBytes: number;
  };
  recentVideos: Array<{
    id: string;
    title: string;
    thumbnailUrl: string;
    sourceType: 'upload' | 'external';
    category: string;
    status: string;
    createdAt: number;
    views: number;
    activeViewers: number;
  }>;
}

export interface AnalyticsResponse {
  range: string;
  metrics: {
    filteredViews: number;
    allTimeViews: number;
    dailyViews: number;
    weeklyViews: number;
    monthlyViews: number;
    activeViewers: number;
    avgWatchDurationSec: number;
    playbackErrors: number;
    shares: number;
  };
  dailySeries: Array<{ date: string; views: number }>;
  mostWatched: Array<{
    id: string;
    title: string;
    category: string;
    thumbnailUrl: string;
    views: number;
    avgDurationSec: number;
  }>;
}
