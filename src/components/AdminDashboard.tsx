import {
  Activity,
  BarChart3,
  Check,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  HardDrive,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Pause,
  Play,
  PlusCircle,
  QrCode,
  Search,
  Settings,
  Shield,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch, getAdminToken } from '../lib/adminAuth';
import { wsUrl } from '../lib/api';
import {
  detectStreamKind,
  formatBytes,
  formatDateShort,
  formatDuration,
  formatRelativeTime,
  getWatchUrl,
} from '../lib/format';
import {
  AdminOverview,
  AnalyticsResponse,
  LiveSnapshot,
  QualitySource,
  VideoItem,
} from '../types';
import { ShareModal } from './ShareModal';
import { ThumbnailImage } from './ThumbnailImage';

type AdminTab = 'dashboard' | 'add' | 'manage' | 'live' | 'analytics' | 'settings';

interface AdminDashboardProps {
  adminUsername: string;
  onLogout: () => void;
  onNavigate: (path: string) => void;
  onConfigUpdated: () => void;
}

const CATEGORIES = ['Action', 'Movies', 'Series', 'Sci-Fi', 'Documentary', 'Anime', 'Music', 'Clips'];
const QUALITY_LABELS = ['2160p (4K)', '1080p', '720p', '480p', '360p'];
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for resumable upload

export function AdminDashboard({
  adminUsername,
  onLogout,
  onNavigate,
  onConfigUpdated,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Overview state
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  // Manage videos state
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState('all');

  // Share / Edit / Delete modals
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingVideo, setEditingVideo] = useState<VideoItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<VideoItem | null>(null);

  // Real-time WebSocket Live Users state
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot>({
    totalActiveSessions: 0,
    watchingSessions: 0,
    sessions: [],
    byVideo: [],
    timestamp: Date.now(),
  });
  const [wsConnected, setWsConnected] = useState(false);

  // Analytics state
  const [analyticsRange, setAnalyticsRange] = useState<'today' | '7d' | '30d' | 'all'>('7d');
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Settings state
  const [settingsForm, setSettingsForm] = useState({
    telegramChannel: '@NETWORKBOYOU',
    telegramContact: '@SAMVIIR',
    relatedVideosEnabled: true,
    siteTagline: '',
    watermarkEnabled: true,
    watermarkText: 'LINKPLAYHD · @SAMVIIR',
    watermarkImageUrl: '',
    defaultSkipIntro: 37,
    screenShieldEnabled: true,
  });
  const [watermarkUploading, setWatermarkUploading] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwNotice, setPwNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Fetch overview
  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await adminFetch('/api/admin/overview');
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as AdminOverview;
        setOverview(data);
      }
    } finally {
      setOverviewLoading(false);
    }
  }, [onLogout]);

  // Fetch all videos
  const fetchVideos = useCallback(async () => {
    setVideosLoading(true);
    try {
      const res = await adminFetch('/api/admin/videos');
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { videos: VideoItem[] };
        setVideos(data.videos || []);
      }
    } finally {
      setVideosLoading(false);
    }
  }, [onLogout]);

  // Fetch analytics
  const fetchAnalytics = useCallback(
    async (range: string) => {
      setAnalyticsLoading(true);
      try {
        const res = await adminFetch(`/api/admin/analytics?range=${encodeURIComponent(range)}`);
        if (res.ok) {
          const data = (await res.json()) as AnalyticsResponse;
          setAnalytics(data);
        }
      } finally {
        setAnalyticsLoading(false);
      }
    },
    []
  );

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    const res = await adminFetch('/api/admin/settings');
    if (res.ok) {
      const data = await res.json();
      setSettingsForm((prev) => ({
        ...prev,
        ...data,
        defaultSkipIntro: Number.isFinite(Number(data.defaultSkipIntro))
          ? Number(data.defaultSkipIntro)
          : 37,
      }));
    }
  }, []);

  const handleWatermarkImageUpload = async (file: File) => {
    setWatermarkUploading(true);
    setSettingsNotice(null);
    try {
      const res = await adminFetch('/api/admin/upload/thumbnail', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-filename': file.name,
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Watermark image upload failed');
      setSettingsForm((f) => ({ ...f, watermarkImageUrl: data.thumbnailUrl }));
      setSettingsNotice({ type: 'ok', text: 'Watermark photo uploaded. Click Save Settings to apply.' });
    } catch (err: any) {
      setSettingsNotice({ type: 'err', text: err?.message || 'Could not upload watermark photo.' });
    } finally {
      setWatermarkUploading(false);
    }
  };

  // Connect admin WebSocket for real-time live user tracking
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connectAdminWs = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        setWsConnected(true);
        ws?.send(JSON.stringify({ type: 'admin_subscribe', token: getAdminToken() || undefined }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type?: string; data?: LiveSnapshot };
          if (msg.type === 'live:update' && msg.data) {
            setLiveSnapshot(msg.data);
            setOverview((prev) =>
              prev
                ? {
                    ...prev,
                    stats: { ...prev.stats, activeLiveUsers: msg.data!.totalActiveSessions },
                  }
                : prev
            );
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          retryTimer = window.setTimeout(connectAdminWs, 4000);
        }
      };
    };

    connectAdminWs();
    // Initial HTTP snapshot fetch as well
    adminFetch('/api/admin/live-sessions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LiveSnapshot | null) => {
        if (d) setLiveSnapshot(d);
      })
      .catch(() => {});

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    fetchOverview();
    fetchVideos();
    fetchSettings();
  }, [fetchOverview, fetchVideos, fetchSettings]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalytics(analyticsRange);
    } else if (activeTab === 'manage') {
      fetchVideos();
    } else if (activeTab === 'dashboard') {
      fetchOverview();
    }
  }, [activeTab, analyticsRange, fetchAnalytics, fetchVideos, fetchOverview]);

  const handleCopyWatchLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(getWatchUrl(id));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // ignore
    }
  };

  const handleToggleStatus = async (video: VideoItem) => {
    const nextStatus = video.status === 'published' ? 'disabled' : 'published';
    const res = await adminFetch(`/api/admin/videos/${encodeURIComponent(video.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      await Promise.all([fetchVideos(), fetchOverview()]);
    }
  };

  const handleDeleteVideo = async (video: VideoItem) => {
    const res = await adminFetch(`/api/admin/videos/${encodeURIComponent(video.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setDeleteConfirm(null);
      await Promise.all([fetchVideos(), fetchOverview()]);
    }
  };

  const filteredVideos = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return videos.filter((v) => {
      if (filterCategory !== 'All' && v.category !== filterCategory) return false;
      if (filterStatus !== 'all' && v.status !== filterStatus) return false;
      if (q) {
        const hay = `${v.title} ${v.id} ${v.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [videos, searchTerm, filterCategory, filterStatus]);

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSettingsNotice(null);
    const res = await adminFetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsForm),
    });
    if (res.ok) {
      setSettingsNotice({ type: 'ok', text: 'Platform settings saved.' });
      onConfigUpdated();
    } else {
      setSettingsNotice({ type: 'err', text: 'Failed to save settings.' });
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwNotice(null);
    if (pwForm.newPassword.length < 6) {
      setPwNotice({ type: 'err', text: 'New password must be at least 6 characters.' });
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwNotice({ type: 'err', text: 'New passwords do not match.' });
      return;
    }
    const res = await adminFetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwNotice({ type: 'ok', text: 'Admin password updated securely.' });
    } else {
      setPwNotice({ type: 'err', text: data.error || 'Could not update password.' });
    }
  };

  const navItems: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'add', label: 'Add New Video', icon: PlusCircle },
    { id: 'manage', label: 'Manage Videos', icon: Film },
    { id: 'live', label: 'Live Users', icon: Users },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const selectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  };

  return (
    <div className="flex min-h-[calc(100vh-61px)] bg-[#0B0C10]">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.07] bg-[#0F1117] lg:flex">
        <div className="border-b border-white/[0.07] px-5 py-4">
          <div className="text-xs font-medium text-[#9CA3B2]">Signed in as</div>
          <div className="mt-0.5 font-display text-sm font-semibold text-white">{adminUsername}</div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#E50914] text-white shadow-[0_0_18px_rgba(229,9,20,0.28)]'
                    : 'text-[#9CA3B2] hover:bg-[#15171E] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'live' && (
                  <span
                    className={`font-mono-tabular text-xs ${
                      active ? 'text-white' : 'text-[#E50914]'
                    }`}
                  >
                    {liveSnapshot.totalActiveSessions}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.07] p-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium text-[#9CA3B2] transition-colors hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/70 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <aside
            className="flex w-64 flex-col border-r border-white/10 bg-[#0F1117]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <div className="text-xs text-[#9CA3B2]">Admin</div>
                <div className="font-display text-sm font-semibold text-white">{adminUsername}</div>
              </div>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="rounded p-1 text-[#9CA3B2] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium cursor-pointer ${
                      activeTab === item.id
                        ? 'bg-[#E50914] text-white'
                        : 'text-[#9CA3B2] hover:bg-[#15171E] hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-white/[0.07] p-3">
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/10 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {/* Top Context Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open admin menu"
              className="rounded-lg border border-white/10 bg-[#15171E] p-2 text-white lg:hidden cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="text-xs text-[#9CA3B2]">Admin Studio / {navItems.find((n) => n.id === activeTab)?.label}</div>
              <h1 className="font-display text-xl font-bold text-white sm:text-2xl">
                {navItems.find((n) => n.id === activeTab)?.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="rounded-lg border border-white/10 bg-[#15171E] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1D202A] whitespace-nowrap cursor-pointer"
            >
              View Public Site
            </button>
            {activeTab !== 'add' && (
              <button
                type="button"
                onClick={() => setActiveTab('add')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E50914] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#F6121D] whitespace-nowrap cursor-pointer"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Add Video
              </button>
            )}
          </div>
        </div>

        {/* ======================== */}
        {/* TAB 1: DASHBOARD         */}
        {/* ======================== */}
        {activeTab === 'dashboard' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-8"
          >
            {/* 5 KPI Stats */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Total Videos"
                value={overviewLoading ? '—' : String(overview?.stats.totalVideos ?? 0)}
                icon={Film}
              />
              <StatCard
                label="Total Video Views"
                value={overviewLoading ? '—' : String(overview?.stats.totalViews ?? 0)}
                icon={Eye}
              />
              <StatCard
                label="Active Live Users"
                value={String(liveSnapshot.totalActiveSessions)}
                subtext={wsConnected ? 'WebSocket live' : 'Syncing'}
                highlight
                icon={Activity}
              />
              <StatCard
                label="Generated Links"
                value={overviewLoading ? '—' : String(overview?.stats.totalGeneratedLinks ?? 0)}
                icon={Link2}
              />
              <StatCard
                label="Storage Used"
                value={overviewLoading ? '—' : formatBytes(overview?.stats.storageUsedBytes ?? 0)}
                icon={HardDrive}
              />
            </div>

            {/* Recently Added Videos */}
            <div className="rounded-xl border border-white/[0.07] bg-[#15171E]">
              <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
                <h2 className="font-display text-base font-semibold text-white">Recently Added Videos</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('manage')}
                  className="text-xs font-medium text-[#E50914] hover:text-[#FF4D58] cursor-pointer"
                >
                  Manage All
                </button>
              </div>

              {overviewLoading ? (
                <div className="space-y-3 p-5">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="skeleton-shimmer h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : !overview?.recentVideos.length ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium text-white">No videos published yet</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('add')}
                    className="mt-4 rounded-lg bg-[#E50914] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                  >
                    Add Your First Video
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.07] text-[#9CA3B2]">
                      <tr>
                        <th className="px-5 py-3 font-medium">Title</th>
                        <th className="px-4 py-3 font-medium">ID</th>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 text-right font-medium">Views</th>
                        <th className="px-4 py-3 text-right font-medium">Live</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {overview.recentVideos.map((v) => (
                        <tr key={v.id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-16 shrink-0 overflow-hidden rounded bg-[#0B0C10]">
                                <ThumbnailImage
                                  src={v.thumbnailUrl}
                                  alt={v.title}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="max-w-[240px] truncate font-medium text-white">
                                {v.title}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-[#9CA3B2]">{v.id}</td>
                          <td className="px-4 py-3 text-[#9CA3B2]">
                            {v.sourceType === 'upload' ? 'Uploaded File' : 'External Link'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-white">{v.views}</td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-[#E50914]">
                            {v.activeViewers}
                          </td>
                          <td className="px-4 py-3 capitalize text-[#C7CDD9]">{v.status}</td>
                          <td className="px-5 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopyWatchLink(v.id)}
                                title="Copy watch link"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                {copiedId === v.id ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShareTarget({ id: v.id, title: v.title })}
                                title="QR & Share"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                <QrCode className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onNavigate(`/watch/${v.id}`)}
                                title="Open watch page"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ======================== */}
        {/* TAB 2: ADD NEW VIDEO     */}
        {/* ======================== */}
        {activeTab === 'add' && (
          <AddVideoPanel
            defaultSkipIntro={settingsForm.defaultSkipIntro}
            onPublished={(created) => {
              fetchVideos();
              fetchOverview();
              setShareTarget({ id: created.id, title: created.title });
            }}
          />
        )}

        {/* ======================== */}
        {/* TAB 3: MANAGE VIDEOS     */}
        {/* ======================== */}
        {activeTab === 'manage' && (
          <div className="space-y-5">
            {/* Search & Filters */}
            <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-[#15171E] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3B2]" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by title or video ID..."
                  className="w-full rounded-lg border border-white/10 bg-[#0B0C10] py-2 pl-9 pr-3 text-xs text-white placeholder-[#9CA3B2]/60 focus:border-[#E50914] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  aria-label="Filter by category"
                  className="rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-[#E50914] focus:outline-none"
                >
                  <option value="All">All Categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  aria-label="Filter by status"
                  className="rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-[#E50914] focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#15171E]">
              {videosLoading ? (
                <div className="space-y-3 p-5">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="skeleton-shimmer h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm font-medium text-white">No matching videos found</p>
                  <p className="mt-1 text-xs text-[#9CA3B2]">
                    Add a new video or adjust your search and category filters.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.07] text-[#9CA3B2]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Thumbnail</th>
                        <th className="px-4 py-3 font-medium">Video Title</th>
                        <th className="px-4 py-3 font-medium">Video ID</th>
                        <th className="px-4 py-3 text-right font-medium">Views</th>
                        <th className="px-4 py-3 text-right font-medium">Active</th>
                        <th className="px-4 py-3 font-medium">Published</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredVideos.map((v) => (
                        <tr key={v.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-3">
                            <div className="h-10 w-18 overflow-hidden rounded bg-[#101114]">
                              <ThumbnailImage
                                src={v.thumbnailUrl}
                                alt={v.title}
                                className="h-full w-full object-cover"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="max-w-[230px] truncate font-medium text-white">{v.title}</div>
                            <div className="text-[11px] text-[#9CA3B2]">
                              {v.category} · {v.sourceType === 'upload' ? 'Media Upload' : 'External Player'}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-[#9CA3B2]">{v.id}</td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-white">{v.views}</td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-[#E50914]">
                            {v.activeViewers}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-[#9CA3B2]">
                            {formatDateShort(v.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-medium capitalize ${
                                v.status === 'published'
                                  ? 'text-emerald-400'
                                  : v.status === 'disabled'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {v.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setEditingVideo(v)}
                                title="Edit video"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyWatchLink(v.id)}
                                title="Copy watch link"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                {copiedId === v.id ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShareTarget({ id: v.id, title: v.title })}
                                title="Share & QR Code"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                <QrCode className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onNavigate(`/watch/${v.id}`)}
                                title="Preview watch page"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(v)}
                                title={v.status === 'published' ? 'Disable link' : 'Enable link'}
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
                              >
                                {v.status === 'published' ? (
                                  <EyeOff className="h-3.5 w-3.5 text-amber-300" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5 text-emerald-400" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm(v)}
                                title="Delete video"
                                className="rounded p-1.5 text-[#9CA3B2] hover:bg-red-500/15 hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================== */}
        {/* TAB 4: LIVE USERS        */}
        {/* ======================== */}
        {activeTab === 'live' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-[#E50914]/25 bg-[#15171E] p-4 text-xs text-[#C7CDD9]">
              <strong className="text-white">Real Session Telemetry:</strong> Counts below reflect actual
              browser sessions actively sending WebSocket heartbeats every 20 seconds (stale sessions
              automatically expire after 65 seconds). This represents active browser tabs/sessions, not
              verified unique individuals.
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Total Active Sessions"
                value={String(liveSnapshot.totalActiveSessions)}
                subtext={wsConnected ? 'Live WebSocket connected' : 'Reconnecting...'}
                highlight
                icon={Users}
              />
              <StatCard
                label="Currently Watching Videos"
                value={String(liveSnapshot.watchingSessions)}
                icon={Play}
              />
              <StatCard
                label="Active Streams Being Watched"
                value={String(liveSnapshot.byVideo.length)}
                icon={Film}
              />
            </div>

            {/* Video-wise Breakdown */}
            {liveSnapshot.byVideo.length > 0 && (
              <div className="rounded-xl border border-white/[0.07] bg-[#15171E] p-5">
                <h2 className="mb-3 font-display text-sm font-semibold text-white">
                  Video-Wise Active Viewers
                </h2>
                <div className="divide-y divide-white/[0.06]">
                  {liveSnapshot.byVideo.map((item) => (
                    <div key={item.videoId} className="flex items-center justify-between py-2.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-white">{item.title}</span>
                        <span className="ml-2 font-mono-tabular text-[#9CA3B2]">({item.videoId})</span>
                      </div>
                      <span className="font-mono-tabular font-semibold text-[#E50914]">
                        {item.count} active
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sessions Table */}
            <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#15171E]">
              <div className="border-b border-white/[0.07] px-5 py-4">
                <h2 className="font-display text-base font-semibold text-white">Active Browser Sessions</h2>
              </div>
              {liveSnapshot.sessions.length === 0 ? (
                <div className="p-10 text-center text-xs text-[#9CA3B2]">
                  No active visitor sessions connected at this moment.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.07] text-[#9CA3B2]">
                      <tr>
                        <th className="px-5 py-3 font-medium">Session ID</th>
                        <th className="px-4 py-3 font-medium">Location / Video</th>
                        <th className="px-4 py-3 font-medium">Device</th>
                        <th className="px-4 py-3 font-medium">Browser</th>
                        <th className="px-5 py-3 text-right font-medium">Last Activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {liveSnapshot.sessions.map((s) => (
                        <tr key={s.session_id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-3 font-mono-tabular text-[#9CA3B2]">
                            {s.session_id.slice(0, 18)}
                          </td>
                          <td className="px-4 py-3 font-medium text-white">
                            {s.video_id && s.video_id !== 'home'
                              ? s.video_title || `Watch: ${s.video_id}`
                              : 'Browsing Catalog'}
                          </td>
                          <td className="px-4 py-3 text-[#C7CDD9]">{s.device_type}</td>
                          <td className="px-4 py-3 text-[#C7CDD9]">{s.browser}</td>
                          <td className="px-5 py-3 text-right font-mono-tabular text-[#9CA3B2]">
                            {formatRelativeTime(s.last_heartbeat)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================== */}
        {/* TAB 5: ANALYTICS         */}
        {/* ======================== */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 rounded-lg bg-[#15171E] p-1 border border-white/[0.07]">
                {(
                  [
                    { id: 'today', label: 'Today' },
                    { id: '7d', label: '7 Days' },
                    { id: '30d', label: '30 Days' },
                    { id: 'all', label: 'All Time' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAnalyticsRange(opt.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      analyticsRange === opt.id
                        ? 'bg-[#E50914] text-white'
                        : 'text-[#9CA3B2] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {analyticsLoading || !analytics ? (
              <div className="grid gap-4 sm:grid-cols-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="skeleton-shimmer h-24 rounded-xl" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Total Views (All Time)"
                    value={String(analytics.metrics.allTimeViews)}
                    subtext={`Today: ${analytics.metrics.dailyViews} · Week: ${analytics.metrics.weeklyViews} · Month: ${analytics.metrics.monthlyViews}`}
                    icon={Eye}
                  />
                  <StatCard
                    label="Active Viewers Now"
                    value={String(liveSnapshot.totalActiveSessions)}
                    highlight
                    icon={Activity}
                  />
                  <StatCard
                    label="Avg Watch Duration"
                    value={formatDuration(analytics.metrics.avgWatchDurationSec)}
                    icon={Film}
                  />
                  <StatCard
                    label="Playback Errors"
                    value={String(analytics.metrics.playbackErrors)}
                    subtext={`${analytics.metrics.shares} share events logged`}
                    icon={BarChart3}
                  />
                </div>

                {/* SVG Bar Chart */}
                <div className="rounded-xl border border-white/[0.07] bg-[#191B20] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-white">
                      Views Trend ({analyticsRange.toUpperCase()})
                    </h2>
                    <span className="font-mono-tabular text-xs text-[#9CA3B2]">
                      {analytics.metrics.filteredViews} views in selected window
                    </span>
                  </div>
                  <ViewsBarChart series={analytics.dailySeries} />
                </div>

                {/* Most Watched Videos */}
                <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#191B20]">
                  <div className="border-b border-white/[0.07] px-5 py-4">
                    <h2 className="font-display text-base font-semibold text-white">Most Watched Videos</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-white/[0.07] text-[#9CA3B2]">
                        <tr>
                          <th className="px-5 py-3 font-medium">Video</th>
                          <th className="px-4 py-3 font-medium">Category</th>
                          <th className="px-4 py-3 text-right font-medium">Views</th>
                          <th className="px-5 py-3 text-right font-medium">Avg Watch Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {analytics.mostWatched.map((m) => (
                          <tr key={m.id} className="hover:bg-white/[0.02]">
                            <td className="px-5 py-3 font-medium text-white">{m.title}</td>
                            <td className="px-4 py-3 text-[#9CA3B2]">{m.category}</td>
                            <td className="px-4 py-3 text-right font-mono-tabular text-white">{m.views}</td>
                            <td className="px-5 py-3 text-right font-mono-tabular text-[#9CA3B2]">
                              {formatDuration(m.avgDurationSec)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ======================== */}
        {/* TAB 6: SETTINGS          */}
        {/* ======================== */}
        {activeTab === 'settings' && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Watermark & Anti-Recording Shield + Platform Branding */}
            <form
              onSubmit={handleSaveSettings}
              className="rounded-xl border border-white/[0.07] bg-[#15171E] p-6 space-y-5"
            >
              <div className="flex items-center gap-2.5">
                <Shield className="h-5 w-5 text-[#E50914]" />
                <h2 className="font-display text-base font-semibold text-white">
                  Player Watermark, Promo Skip &amp; Anti-Recording
                </h2>
              </div>

              {/* Watermark Photo Upload */}
              <div>
                <label className="block text-xs font-medium text-[#C7CDD9]">
                  Custom Watermark Photo / Logo (PNG, JPG, WebP)
                </label>
                <div className="mt-2 flex items-center gap-3">
                  {settingsForm.watermarkImageUrl ? (
                    <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded border border-white/15 bg-[#0B0C10] p-1">
                      <img
                        src={settingsForm.watermarkImageUrl}
                        alt="Watermark preview"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded border border-dashed border-white/15 bg-[#0B0C10] text-[10px] text-[#9CA3B2]">
                      No logo
                    </div>
                  )}

                  <label className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-[#1D202A] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#252936] cursor-pointer whitespace-nowrap">
                    {watermarkUploading ? 'Uploading...' : 'Upload Logo Photo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleWatermarkImageUpload(file);
                      }}
                    />
                  </label>

                  {settingsForm.watermarkImageUrl && (
                    <button
                      type="button"
                      onClick={() => setSettingsForm((f) => ({ ...f, watermarkImageUrl: '' }))}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-[#9CA3B2] hover:text-white cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={settingsForm.watermarkImageUrl}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, watermarkImageUrl: e.target.value }))
                  }
                  placeholder="Or paste watermark image URL..."
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-xs text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#C7CDD9]">
                  Watermark Text Label
                </label>
                <input
                  type="text"
                  value={settingsForm.watermarkText}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, watermarkText: e.target.value }))
                  }
                  placeholder="LINKPLAYHD · @SAMVIIR"
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#C7CDD9]">
                  Default Auto-Skip Promo Intro (seconds)
                </label>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={settingsForm.defaultSkipIntro}
                  onChange={(e) =>
                    setSettingsForm((f) => ({
                      ...f,
                      defaultSkipIntro: Math.max(0, Math.min(600, Number(e.target.value) || 0)),
                    }))
                  }
                  className="mt-1.5 w-36 rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 font-mono-tabular text-sm text-white focus:border-[#E50914] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-[#9CA3B2]">
                  Automatically jumps past the first {settingsForm.defaultSkipIntro}s promo on uploaded &amp; direct MP4/HLS streams.
                </p>
              </div>

              <div className="space-y-2.5 pt-1">
                <label className="flex items-center gap-2.5 text-xs text-[#C7CDD9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.watermarkEnabled}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, watermarkEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 rounded accent-[#E50914]"
                  />
                  Show custom watermark photo &amp; text inside player (including fullscreen)
                </label>

                <label className="flex items-center gap-2.5 text-xs text-[#C7CDD9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.screenShieldEnabled}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, screenShieldEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 rounded accent-[#E50914]"
                  />
                  Enable Anti-Recording Shield (auto-blur &amp; pause on tab switch / PrintScreen)
                </label>

                <label className="flex items-center gap-2.5 text-xs text-[#C7CDD9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.relatedVideosEnabled}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, relatedVideosEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 rounded accent-[#E50914]"
                  />
                  Show related videos below Watch Page player
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-white/[0.07]">
                <div>
                  <label className="block text-xs font-medium text-[#C7CDD9]">Telegram Channel</label>
                  <input
                    type="text"
                    value={settingsForm.telegramChannel}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, telegramChannel: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#C7CDD9]">Telegram Contact</label>
                  <input
                    type="text"
                    value={settingsForm.telegramContact}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, telegramContact: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                  />
                </div>
              </div>

              {settingsNotice && (
                <div
                  className={`rounded-lg px-3.5 py-2 text-xs ${
                    settingsNotice.type === 'ok'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  {settingsNotice.text}
                </div>
              )}

              <button
                type="submit"
                className="rounded-lg bg-[#E50914] px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#F6121D] cursor-pointer"
              >
                Save All Settings
              </button>
            </form>

            {/* Right Column: Password & Backup */}
            <div className="space-y-6">
              <form
                onSubmit={handleChangePassword}
                className="rounded-xl border border-white/[0.07] bg-[#15171E] p-6 space-y-4"
              >
                <h2 className="font-display text-base font-semibold text-white">Change Admin Password</h2>
                <div>
                  <label className="block text-xs font-medium text-[#C7CDD9]">Current Password</label>
                  <input
                    type="password"
                    required
                    value={pwForm.currentPassword}
                    onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#C7CDD9]">New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={pwForm.newPassword}
                    onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#C7CDD9]">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={pwForm.confirmPassword}
                    onChange={(e) => setPwForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                  />
                </div>
                {pwNotice && (
                  <div
                    className={`rounded-lg px-3.5 py-2 text-xs ${
                      pwNotice.type === 'ok'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-red-500/15 text-red-300'
                    }`}
                  >
                    {pwNotice.text}
                  </div>
                )}
                <button
                  type="submit"
                  className="rounded-lg bg-[#E50914] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#F6121D] cursor-pointer"
                >
                  Update Password
                </button>
              </form>

              <div className="rounded-xl border border-white/[0.07] bg-[#15171E] p-6">
                <h2 className="font-display text-base font-semibold text-white">Catalog Backup</h2>
                <p className="mt-1 text-xs text-[#9CA3B2]">
                  Download a full JSON backup of all video metadata, watch IDs, and platform settings.
                </p>
                <a
                  href={`/api/admin/export?token=${encodeURIComponent(getAdminToken() || '')}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#0B0C10] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1D202A]"
                >
                  <Download className="h-4 w-4 text-[#E50914]" />
                  Download JSON Backup
                </a>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {shareTarget && (
        <ShareModal
          videoId={shareTarget.id}
          title={shareTarget.title}
          onClose={() => setShareTarget(null)}
        />
      )}

      {editingVideo && (
        <EditVideoModal
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={async () => {
            setEditingVideo(null);
            await Promise.all([fetchVideos(), fetchOverview()]);
          }}
        />
      )}

      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-white/10 bg-[#191B20] p-6 shadow-2xl"
          >
            <h3 className="font-display text-base font-semibold text-white">Delete Video?</h3>
            <p className="mt-2 text-xs text-[#9CA3B2]">
              Permanently delete <strong className="text-white">{deleteConfirm.title}</strong> ({deleteConfirm.id})?
              Its watch link will stop working immediately.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-[#C7CDD9] hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteVideo(deleteConfirm)}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================
 * ADD VIDEO PANEL (UPLOAD + URL)
 * ================================ */
function AddVideoPanel({
  defaultSkipIntro,
  onPublished,
}: {
  defaultSkipIntro: number;
  onPublished: (video: { id: string; title: string }) => void;
}) {
  const [method, setMethod] = useState<'external' | 'upload'>('upload');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [category, setCategory] = useState('Movies');
  const [status, setStatus] = useState<'published' | 'draft'>('published');
  const [featured, setFeatured] = useState(false);
  const [skipIntroSeconds, setSkipIntroSeconds] = useState(defaultSkipIntro ?? 37);
  const [qualitySources, setQualitySources] = useState<QualitySource[]>([]);

  // Resumable file upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'paused' | 'done' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedStoragePath, setUploadedStoragePath] = useState('');
  const [uploadedSize, setUploadedSize] = useState(0);
  const pauseRequestedRef = useRef(false);
  const uploadSessionRef = useRef<{ uploadId: string; nextChunk: number; totalChunks: number } | null>(null);

  const [thumbUploading, setThumbUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runResumableUpload = async (file: File, resumeExisting = false) => {
    setError(null);
    pauseRequestedRef.current = false;
    setUploadState('uploading');

    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let uploadId = uploadSessionRef.current?.uploadId || '';
    let startChunk = resumeExisting && uploadSessionRef.current ? uploadSessionRef.current.nextChunk : 0;

    try {
      if (!resumeExisting || !uploadId) {
        const initRes = await adminFetch('/api/admin/upload/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            totalSize: file.size,
            totalChunks,
          }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) {
          throw new Error(initData.error || 'Could not initialize upload.');
        }
        uploadId = initData.uploadId;
        startChunk = 0;
        uploadSessionRef.current = { uploadId, nextChunk: 0, totalChunks };
      }

      for (let idx = startChunk; idx < totalChunks; idx++) {
        if (pauseRequestedRef.current) {
          uploadSessionRef.current = { uploadId, nextChunk: idx, totalChunks };
          setUploadState('paused');
          return;
        }
        const start = idx * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const blob = file.slice(start, end);

        const chunkRes = await adminFetch('/api/admin/upload/chunk', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-upload-id': uploadId,
            'x-chunk-index': String(idx),
          },
          body: blob,
        });
        if (!chunkRes.ok) {
          const errData = await chunkRes.json().catch(() => ({}));
          throw new Error(errData.error || `Chunk ${idx + 1} failed`);
        }

        uploadSessionRef.current = { uploadId, nextChunk: idx + 1, totalChunks };
        setUploadProgress(Math.round(((idx + 1) / totalChunks) * 100));
      }

      const completeRes = await adminFetch('/api/admin/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(completeData.error || 'Failed to finalize uploaded file.');
      }

      setUploadedStoragePath(completeData.storagePath);
      setUploadedSize(completeData.fileSizeBytes);
      setUploadState('done');
    } catch (err: any) {
      setUploadState('error');
      setError(err?.message || 'Upload interrupted. Click Resume to retry.');
    }
  };

  const handleThumbFile = async (file: File) => {
    setThumbUploading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/upload/thumbnail', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-filename': file.name,
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Thumbnail upload failed');
      setThumbnailUrl(data.thumbnailUrl);
    } catch (err: any) {
      setError(err?.message || 'Thumbnail upload failed');
    } finally {
      setThumbUploading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please enter a video title.');
      return;
    }

    if (method === 'external' && !externalUrl.trim()) {
      setError('Please enter an external player URL.');
      return;
    }

    if (method === 'upload' && !uploadedStoragePath) {
      setError('Please upload and complete your video file before publishing.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminFetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          thumbnailUrl: thumbnailUrl.trim(),
          sourceType: method,
          sourceUrl: method === 'external' ? externalUrl.trim() : '',
          storagePath: method === 'upload' ? uploadedStoragePath : '',
          fileSizeBytes: method === 'upload' ? uploadedSize : 0,
          qualitySources: qualitySources.filter((q) => q.label && q.url.trim()),
          skipIntroSeconds: Math.max(0, Math.min(600, Number(skipIntroSeconds) || 0)),
          category,
          status,
          featured,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to publish video.');
        return;
      }

      // Reset form and trigger Watch Link modal
      setTitle('');
      setDescription('');
      setThumbnailUrl('');
      setExternalUrl('');
      setSelectedFile(null);
      setUploadedStoragePath('');
      setUploadState('idle');
      setUploadProgress(0);
      setQualitySources([]);
      setSkipIntroSeconds(defaultSkipIntro ?? 37);
      setFeatured(false);

      onPublished({ id: data.video.id, title: data.video.title });
    } catch {
      setError('Network error while saving video.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Method Switcher */}
      <div className="inline-flex rounded-lg border border-white/[0.07] bg-[#15171E] p-1">
        <button
          type="button"
          onClick={() => setMethod('upload')}
          className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
            method === 'upload' ? 'bg-[#E50914] text-white' : 'text-[#9CA3B2] hover:text-white'
          }`}
        >
          Upload Video (LINKPLAYHD Player)
        </button>
        <button
          type="button"
          onClick={() => setMethod('external')}
          className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
            method === 'external' ? 'bg-[#E50914] text-white' : 'text-[#9CA3B2] hover:text-white'
          }`}
        >
          Stream / External Link
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-white/[0.07] bg-[#15171E] p-6"
      >
        {method === 'external' ? (
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">
              Direct Stream (.mp4 / .m3u8) or External Player URL *
            </label>
            <input
              type="url"
              required
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://cdn.example.com/movie.mp4 or https://playdrive.vip/e/..."
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
            />
            {externalUrl.trim() && (
              <div
                className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                  detectStreamKind(externalUrl) === 'embed'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                }`}
              >
                {detectStreamKind(externalUrl) === 'embed' ? (
                  <>
                    <strong className="text-white">Third-Party Embed Webpage Detected:</strong>{' '}
                    Websites like <code className="text-amber-300">playdrive.vip</code> run their own
                    cross-origin iframe player—browsers block external scripts from skipping 37s
                    inside another site&apos;s iframe or removing their controls on tap. To play
                    inside <strong>100% your LINKPLAYHD Player</strong> with instant 37s auto-skip
                    and zero third-party UI, upload the video file above or paste a direct{' '}
                    <code>.mp4</code> / <code>.m3u8</code> stream URL.
                  </>
                ) : (
                  <>
                    <strong className="text-white">LINKPLAYHD Custom Player Ready:</strong> Direct{' '}
                    {detectStreamKind(externalUrl) === 'hls' ? 'HLS (.m3u8)' : 'video'} stream
                    detected. Auto-skip ({skipIntroSeconds}s), custom tap controls, watermark, and
                    screen shield will run natively.
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">
              Upload Video File (MP4, WebM, MOV, MKV) *
            </label>
            <div className="mt-1.5 rounded-lg border border-dashed border-white/15 bg-[#0B0C10] p-5 text-center">
              <UploadCloud className="mx-auto h-8 w-8 text-[#E50914]" />
              <p className="mt-2 text-xs text-[#C7CDD9]">
                {selectedFile
                  ? `${selectedFile.name} (${formatBytes(selectedFile.size)})`
                  : 'Select a video file for chunked resumable upload'}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
                <label className="rounded-lg border border-white/15 bg-[#191B20] px-4 py-2 text-xs font-medium text-white hover:bg-[#23262E] cursor-pointer">
                  Choose Video File
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv,.m4v"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setSelectedFile(file);
                        if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
                        setUploadState('idle');
                        setUploadProgress(0);
                        setUploadedStoragePath('');
                        runResumableUpload(file, false);
                      }
                    }}
                  />
                </label>

                {uploadState === 'uploading' && (
                  <button
                    type="button"
                    onClick={() => {
                      pauseRequestedRef.current = true;
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-xs text-white hover:bg-white/10 cursor-pointer"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </button>
                )}

                {(uploadState === 'paused' || uploadState === 'error') && selectedFile && (
                  <button
                    type="button"
                    onClick={() => runResumableUpload(selectedFile, true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#E50914] px-3 py-2 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume Upload
                  </button>
                )}
              </div>

              {uploadState !== 'idle' && (
                <div className="mt-4 space-y-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      style={{ width: `${uploadProgress}%` }}
                      className="h-full bg-[#E50914] transition-all duration-200"
                    />
                  </div>
                  <div className="font-mono-tabular text-[11px] text-[#9CA3B2]">
                    {uploadState === 'done'
                      ? 'Upload complete and verified on server'
                      : uploadState === 'paused'
                      ? `Paused at ${uploadProgress}%`
                      : `Uploading: ${uploadProgress}%`}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#C7CDD9]">Video Title *</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Horizon — Director's Cut HD"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#C7CDD9]">Description</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief synopsis or stream details shown on the Watch Page..."
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#C7CDD9]">
            Thumbnail URL or Upload Image
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              placeholder="https://... or upload image"
              className="flex-1 rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
            />
            <label className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#1D202A] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#252936] cursor-pointer whitespace-nowrap">
              {thumbUploading ? 'Uploading...' : 'Upload Thumbnail'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleThumbFile(file);
                }}
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white focus:border-[#E50914] focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">Publish Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'published' | 'draft')}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white focus:border-[#E50914] focus:outline-none"
            >
              <option value="published">Published (Live Watch Link)</option>
              <option value="draft">Save as Draft</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">
              Auto-Skip Intro (sec)
            </label>
            <input
              type="number"
              min={0}
              max={600}
              value={skipIntroSeconds}
              onChange={(e) =>
                setSkipIntroSeconds(Math.max(0, Math.min(600, Number(e.target.value) || 0)))
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 font-mono-tabular text-sm text-white focus:border-[#E50914] focus:outline-none"
            />
          </div>
        </div>

        {/* Optional Multi-Quality Direct Stream Variants */}
        {method === 'external' && (
          <div className="rounded-lg border border-white/[0.07] bg-[#14161B] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-white">
                  Optional Direct Stream Quality Variants
                </div>
                <div className="text-[11px] text-[#9CA3B2]">
                  For direct MP4 streams, add alternate resolution URLs so viewers can switch quality.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setQualitySources((q) => [...q, { label: '720p', url: '' }])
                }
                className="rounded-md border border-white/10 bg-[#191B20] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#23262E] cursor-pointer"
              >
                + Add Quality
              </button>
            </div>
            {qualitySources.length > 0 && (
              <div className="mt-3 space-y-2">
                {qualitySources.map((q, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={q.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQualitySources((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, label: val } : item))
                        );
                      }}
                      className="rounded-md border border-white/10 bg-[#101114] px-2.5 py-2 text-xs text-white"
                    >
                      {QUALITY_LABELS.map((lbl) => (
                        <option key={lbl} value={lbl}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                    <input
                      type="url"
                      value={q.url}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQualitySources((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, url: val } : item))
                        );
                      }}
                      placeholder="https://cdn.example.com/video-720p.mp4"
                      className="flex-1 rounded-md border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-[#E50914] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setQualitySources((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded p-1.5 text-[#9CA3B2] hover:text-red-400 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="flex items-center gap-2.5 text-xs text-[#C7CDD9] cursor-pointer">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
            className="h-4 w-4 rounded accent-[#E50914]"
          />
          Set as Hero Spotlight on the homepage
        </label>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || uploadState === 'uploading'}
          className="inline-flex items-center gap-2 rounded-lg bg-[#E50914] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_22px_rgba(229,9,20,0.3)] transition-colors hover:bg-[#F6121D] disabled:opacity-60 cursor-pointer"
        >
          <Link2 className="h-4 w-4" />
          {submitting ? 'Generating Link...' : 'Publish & Generate Watch Link'}
        </button>
      </form>
    </div>
  );
}

/* ================================
 * EDIT VIDEO MODAL
 * ================================ */
function EditVideoModal({
  video,
  onClose,
  onSaved,
}: {
  video: VideoItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [thumbnailUrl, setThumbnailUrl] = useState(video.thumbnailUrl);
  const [sourceUrl, setSourceUrl] = useState(video.sourceUrl);
  const [category, setCategory] = useState(video.category);
  const [status, setStatus] = useState(video.status);
  const [featured, setFeatured] = useState(video.featured);
  const [skipIntroSeconds, setSkipIntroSeconds] = useState(video.skipIntroSeconds ?? 37);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/videos/${encodeURIComponent(video.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          thumbnailUrl,
          sourceUrl: video.sourceType === 'external' ? sourceUrl : undefined,
          category,
          status,
          featured,
          skipIntroSeconds: Math.max(0, Math.min(600, Number(skipIntroSeconds) || 0)),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update video');
        return;
      }
      onSaved();
    } catch {
      setError('Network error saving changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#15171E] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-white">
            Edit Video ({video.id})
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#9CA3B2] hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#C7CDD9]">Title</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
          />
        </div>

        {video.sourceType === 'external' && (
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">External Player URL</label>
            <input
              type="url"
              required
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#C7CDD9]">Thumbnail URL</label>
          <input
            type="text"
            value={thumbnailUrl}
            onChange={(e) => setThumbnailUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#C7CDD9]">Description</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'published' | 'draft' | 'disabled')}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-white"
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#C7CDD9]">Skip Intro (sec)</label>
            <input
              type="number"
              min={0}
              max={600}
              value={skipIntroSeconds}
              onChange={(e) =>
                setSkipIntroSeconds(Math.max(0, Math.min(600, Number(e.target.value) || 0)))
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 font-mono-tabular text-sm text-white"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-[#C7CDD9] cursor-pointer">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
            className="h-4 w-4 rounded accent-[#E50914]"
          />
          Featured in Homepage Hero Spotlight
        </label>

        {error && (
          <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-200">{error}</div>
        )}

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-[#C7CDD9] hover:text-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#E50914] px-4 py-2 text-xs font-semibold text-white hover:bg-[#F6121D] disabled:opacity-60 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  highlight = false,
  icon: Icon,
}: {
  label: string;
  value: string;
  subtext?: string;
  highlight?: boolean;
  icon: typeof Film;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#15171E] p-5">
      <div className="flex items-center justify-between text-xs text-[#9CA3B2]">
        <span>{label}</span>
        <Icon className={`h-4 w-4 ${highlight ? 'text-[#E50914]' : 'text-[#9CA3B2]'}`} />
      </div>
      <div className="mt-2 font-display text-2xl font-bold tabular-nums text-white">{value}</div>
      {subtext && <div className="mt-1 text-[11px] text-[#9CA3B2]">{subtext}</div>}
    </div>
  );
}

function ViewsBarChart({ series }: { series: Array<{ date: string; views: number }> }) {
  const maxViews = Math.max(1, ...series.map((s) => s.views));
  if (series.length === 0) {
    return <div className="py-10 text-center text-xs text-[#9CA3B2]">No view activity recorded yet.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex h-44 items-end gap-1.5 sm:gap-2">
        {series.map((point) => {
          const pct = Math.max(4, Math.round((point.views / maxViews) * 100));
          return (
            <div key={point.date} className="group relative flex h-full flex-1 flex-col justify-end">
              <div className="pointer-events-none mb-1 text-center font-mono-tabular text-[10px] text-[#9CA3B2] opacity-0 transition-opacity group-hover:opacity-100">
                {point.views}
              </div>
              <div
                style={{ height: `${point.views === 0 ? 4 : pct}%` }}
                title={`${point.date}: ${point.views} views`}
                className={`w-full rounded-t transition-colors ${
                  point.views > 0
                    ? 'bg-[#E50914] group-hover:bg-[#F6121D]'
                    : 'bg-white/[0.07]'
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between font-mono-tabular text-[10px] text-[#9CA3B2]">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}
