import { Check, Copy, ExternalLink, Send, Share2, X } from 'lucide-react';
import { motion } from 'motion/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { getWatchUrl } from '../lib/format';

interface ShareModalProps {
  videoId: string;
  title: string;
  onClose: () => void;
  onShared?: () => void;
}

export function ShareModal({ videoId, title, onClose, onShared }: ShareModalProps) {
  const watchUrl = getWatchUrl(videoId);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(watchUrl, {
      width: 220,
      margin: 2,
      color: {
        dark: '#F5F7FA',
        light: '#15171E',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [watchUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(watchUrl);
      setCopied(true);
      onShared?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${title} — LINKPLAYHD`,
          url: watchUrl,
        });
        onShared?.();
      } catch {
        // User cancelled
      }
    } else {
      handleCopy();
    }
  };

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    watchUrl
  )}&text=${encodeURIComponent(`Watch "${title}" on LINKPLAYHD`)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Share Watch Link"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#15171E] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-white">Share Watch Link</h3>
            <p className="mt-1 truncate text-xs text-[#9CA3B2]">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-[#9CA3B2] transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Link copy bar */}
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-[#0B0C10] p-2">
          <input
            type="text"
            readOnly
            value={watchUrl}
            aria-label="Shareable watch URL"
            className="min-w-0 flex-1 bg-transparent px-2 font-mono-tabular text-xs text-[#F5F7FA] focus:outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#E50914] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#F6121D] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy Link'}
          </button>
        </div>

        {/* QR Code */}
        <div className="mt-5 flex flex-col items-center rounded-lg border border-white/[0.07] bg-[#0F1117] p-4">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code for ${title}`}
              className="h-44 w-44 rounded-lg border border-white/10"
            />
          ) : (
            <div className="skeleton-shimmer h-44 w-44 rounded-lg" />
          )}
          <p className="mt-3 text-xs text-[#9CA3B2]">Scan to open stream on mobile or Smart TV</p>
        </div>

        {/* Actions */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={handleNativeShare}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#1D202A] px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[#252936] cursor-pointer"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
          <a
            href={telegramShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onShared?.()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#1D202A] px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[#252936]"
          >
            <Send className="h-3.5 w-3.5 text-[#E50914]" />
            Telegram
          </a>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#1D202A] px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[#252936]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        </div>
      </motion.div>
    </div>
  );
}
