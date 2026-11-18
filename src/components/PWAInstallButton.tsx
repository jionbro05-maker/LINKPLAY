import { Download, MoreVertical, PlusSquare, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  className?: string;
}

export function PWAInstallButton({ compact = false, className = '' }: PWAInstallButtonProps) {
  const { isInstalled, canPromptNative, isIOS, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (canPromptNative) {
      const outcome = await promptInstall();
      if (outcome !== 'unavailable') {
        return;
      }
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-white/15 bg-[#15171E]/90 px-3 py-2 text-xs font-semibold text-[#F5F7FA] transition-all hover:border-[#E50914]/60 hover:bg-[#1D202A] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914] ${className}`}
        title="Install LINKPLAYHD App on your device"
      >
        {compact ? <Download className="h-3.5 w-3.5 text-[#E50914]" /> : <Smartphone className="h-3.5 w-3.5 text-[#E50914]" />}
        <span>{compact ? 'App' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#15171E] p-6 text-[#F5F7FA] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              aria-label="Close install instructions"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-[#9CA3B2] hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E50914]/40 bg-[#E50914]/15">
                <Smartphone className="h-5 w-5 text-[#E50914]" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-white">Install LINKPLAYHD App</h3>
                <p className="text-xs text-[#9CA3B2]">Free direct install · No Play Store or card needed</p>
              </div>
            </div>

            {isIOS ? (
              <ol className="space-y-3 text-sm text-[#D1D5E0]">
                <li className="flex items-start gap-2.5 rounded-lg bg-[#0B0C10]/70 p-3 border border-white/[0.06]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-xs font-bold text-white">1</span>
                  <span>
                    Tap the <Share className="mx-1 inline h-4 w-4 text-[#E50914]" /> <strong>Share</strong> button in Safari&apos;s toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 rounded-lg bg-[#0B0C10]/70 p-3 border border-white/[0.06]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-xs font-bold text-white">2</span>
                  <span>
                    Scroll down and tap <PlusSquare className="mx-1 inline h-4 w-4 text-[#E50914]" /> <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 rounded-lg bg-[#0B0C10]/70 p-3 border border-white/[0.06]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-xs font-bold text-white">3</span>
                  <span>Tap <strong>Add</strong> to launch LINKPLAYHD in fullscreen app mode.</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm text-[#D1D5E0]">
                <li className="flex items-start gap-2.5 rounded-lg bg-[#0B0C10]/70 p-3 border border-white/[0.06]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-xs font-bold text-white">1</span>
                  <span>Open the public LINKPLAYHD link directly in <strong>Chrome</strong> on Android or Desktop (not an in-app preview frame).</span>
                </li>
                <li className="flex items-start gap-2.5 rounded-lg bg-[#0B0C10]/70 p-3 border border-white/[0.06]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-xs font-bold text-white">2</span>
                  <span>
                    Tap <MoreVertical className="mx-0.5 inline h-4 w-4 text-[#E50914]" /> Chrome menu → <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
                  </span>
                </li>
                <li className="flex items-start gap-2.5 rounded-lg bg-[#0B0C10]/70 p-3 border border-white/[0.06]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-xs font-bold text-white">3</span>
                  <span>LINKPLAYHD installs onto your phone like an app with fullscreen playback and no browser bar.</span>
                </li>
                <li className="rounded-lg border border-white/10 bg-[#0B0C10]/70 p-3 text-xs text-[#9CA3B2]">
                  <strong className="text-white">Need an .apk file in Downloads/Files?</strong> Open{' '}
                  <span className="text-[#E50914] font-medium">pwabuilder.com</span>, paste this app&apos;s public URL, and click <strong>Package for Stores → Android</strong> to download a free signed <code className="text-white">.apk</code> (no card needed).
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-lg bg-[#E50914] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#F6121D] cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/40 bg-[#15171E]/95 px-4 py-2 text-xs font-medium text-amber-200 shadow-xl backdrop-blur-md"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-amber-400" />
      <span>You&apos;re offline — cached pages remain available, live streams need internet.</span>
    </div>
  );
}
