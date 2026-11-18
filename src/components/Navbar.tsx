import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getTelegramHref } from '../lib/format';
import { PublicConfig } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface NavbarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  config: PublicConfig;
  isAdminAuthenticated: boolean;
  overlayMode?: boolean;
}

export function Navbar({
  currentPath,
  onNavigate,
  config,
  isAdminAuthenticated,
  overlayMode = false,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleNav = (path: string) => {
    setMobileOpen(false);
    onNavigate(path);
  };

  const headerClasses = overlayMode
    ? scrolled
      ? 'fixed inset-x-0 top-0 z-40 border-b border-white/[0.08] bg-[#0B0C10]/95 backdrop-blur-md transition-colors duration-200'
      : 'fixed inset-x-0 top-0 z-40 bg-gradient-to-b from-[#0B0C10]/95 via-[#0B0C10]/55 to-transparent transition-colors duration-200'
    : 'sticky top-0 z-40 border-b border-white/[0.07] bg-[#0B0C10]/95 backdrop-blur-md';

  return (
    <header className={headerClasses}>
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-8">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleNav('/');
          }}
          className="font-display text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914] rounded"
        >
          LINKPLAY<span className="glow-wordmark text-[#E50914]">HD</span>
        </a>

        {/* Zone 2: Concise single-line nav links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#C7CDD9]">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleNav('/');
            }}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-white ${
              currentPath === '/' ? 'text-white font-semibold' : ''
            }`}
          >
            Home
          </a>
          <a
            href="/#catalog"
            onClick={(e) => {
              e.preventDefault();
              handleNav('/');
              window.setTimeout(() => {
                document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
              }, 80);
            }}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-white"
          >
            Browse
          </a>
          <a
            href={getTelegramHref(config.telegramChannel)}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-white"
          >
            Telegram
          </a>
          <a
            href="/admin"
            onClick={(e) => {
              e.preventDefault();
              handleNav('/admin');
            }}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-white ${
              currentPath.startsWith('/admin') ? 'text-white font-semibold' : ''
            }`}
          >
            Admin
          </a>
        </nav>

        {/* Zone 3: Install App + Primary Admin Action */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton compact className="hidden sm:inline-flex" />
          <button
            type="button"
            onClick={() => handleNav('/admin')}
            className="inline-flex items-center justify-center rounded-md bg-[#E50914] px-3.5 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(229,9,20,0.3)] transition-all hover:bg-[#F6121D] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914]"
          >
            {isAdminAuthenticated ? 'Admin Studio' : 'Admin Panel'}
          </button>

          <button
            type="button"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex md:hidden items-center justify-center rounded-md border border-white/10 bg-[#15171E]/90 p-2 text-[#F5F7FA] hover:bg-[#1D202A] transition-colors cursor-pointer"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-white/[0.07] bg-[#0F1117] px-4 py-4 md:hidden">
          <div className="flex flex-col gap-2 text-sm font-medium text-[#9CA3B2]">
            <button
              type="button"
              onClick={() => handleNav('/')}
              className="text-left py-2 text-white cursor-pointer"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => {
                handleNav('/');
                window.setTimeout(() => {
                  document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
              }}
              className="text-left py-2 hover:text-white cursor-pointer"
            >
              Browse Catalog
            </button>
            <a
              href={getTelegramHref(config.telegramChannel)}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2 hover:text-white"
            >
              Telegram ({config.telegramChannel})
            </a>
            <button
              type="button"
              onClick={() => handleNav('/admin')}
              className="text-left py-2 text-[#E50914] hover:text-white cursor-pointer"
            >
              {isAdminAuthenticated ? 'Admin Studio' : 'Admin Login'}
            </button>
            <div className="pt-2">
              <PWAInstallButton className="w-full" />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
