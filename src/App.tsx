/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLogin } from './components/AdminLogin';
import { Footer } from './components/Footer';
import { HomePage } from './components/HomePage';
import { Navbar } from './components/Navbar';
import { OfflineIndicator } from './components/PWAInstallButton';
import { WatchPage } from './components/WatchPage';
import { adminFetch, setAdminToken } from './lib/adminAuth';
import { apiUrl } from './lib/api';
import { useLivePresence } from './lib/session';
import { PublicConfig } from './types';

const DEFAULT_CONFIG: PublicConfig = {
  brand: 'LINKPLAYHD',
  telegramChannel: '@NETWORKBOYOU',
  telegramContact: '@SAMVIIR',
  relatedVideosEnabled: true,
  siteTagline: 'Adaptive Streaming & Shareable Watch Links',
  watermarkEnabled: true,
  watermarkText: 'LINKPLAYHD · @SAMVIIR',
  watermarkImageUrl: '',
  defaultSkipIntro: 37,
  screenShieldEnabled: true,
};

export default function App() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname || '/');
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [adminUser, setAdminUser] = useState<{ id: number; username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    const clean = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
    if (window.location.pathname !== clean) {
      window.history.pushState({}, '', clean);
      setPathname(clean);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const loadConfig = useCallback(() => {
    fetch(apiUrl('/api/public/config'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PublicConfig | null) => {
        if (data) setConfig(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConfig();
    adminFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data: { authenticated: boolean; admin?: { id: number; username: string } }) => {
        if (data.authenticated && data.admin) {
          setAdminUser(data.admin);
        } else {
          setAdminToken(null);
          setAdminUser(null);
        }
      })
      .catch(() => setAdminUser(null))
      .finally(() => setAuthChecked(true));
  }, [loadConfig]);

  const watchMatch = useMemo(() => {
    const m = /^\/watch\/([^/]+)\/?$/.exec(pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }, [pathname]);

  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isHomeRoute = !watchMatch && !isAdminRoute;
  const presenceTarget = watchMatch ? watchMatch : isAdminRoute ? 'admin' : 'home';
  const { totalActive, videoCounts } = useLivePresence(presenceTarget);

  const handleLogout = useCallback(async () => {
    try {
      await adminFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAdminToken(null);
    setAdminUser(null);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#0B0C10] text-[#F5F7FA]">
      <Navbar
        currentPath={pathname}
        onNavigate={navigate}
        config={config}
        isAdminAuthenticated={Boolean(adminUser)}
        overlayMode={isHomeRoute}
      />

      <div className="flex-1">
        {watchMatch ? (
          <WatchPage
            videoId={watchMatch}
            onNavigate={navigate}
            videoCounts={videoCounts}
            config={config}
          />
        ) : isAdminRoute ? (
          !authChecked ? (
            <div className="mx-auto max-w-md px-4 py-20">
              <div className="skeleton-shimmer h-72 w-full rounded-xl" />
            </div>
          ) : adminUser ? (
            <AdminDashboard
              adminUsername={adminUser.username}
              onLogout={handleLogout}
              onNavigate={navigate}
              onConfigUpdated={loadConfig}
            />
          ) : (
            <AdminLogin
              onSuccess={(admin) => setAdminUser(admin)}
              onNavigateHome={() => navigate('/')}
            />
          )
        ) : (
          <HomePage
            onNavigate={navigate}
            videoCounts={videoCounts}
            totalActive={totalActive}
            config={config}
          />
        )}
      </div>

      {!isAdminRoute && <Footer config={config} onNavigate={navigate} />}
      <OfflineIndicator />
    </div>
  );
}
