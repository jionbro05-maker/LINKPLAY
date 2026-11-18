import { getTelegramHref } from '../lib/format';
import { PublicConfig } from '../types';

interface FooterProps {
  config: PublicConfig;
  onNavigate: (path: string) => void;
}

export function Footer({ config, onNavigate }: FooterProps) {
  return (
    <footer className="border-t border-white/[0.07] bg-[#0B0C10] px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div className="space-y-1.5">
          <div className="font-display text-base font-extrabold tracking-tight text-white">
            LINKPLAY<span className="glow-wordmark text-[#E50914]">HD</span>
          </div>
          <p className="text-xs text-[#9CA3B2]">
            Made with LINKPLAYHD · Adaptive Video Hosting &amp; Shareable Watch Links
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#9CA3B2]">
          <a
            href={getTelegramHref(config.telegramChannel)}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white"
          >
            Channel: <span className="font-medium text-[#F4F6FB]">{config.telegramChannel}</span>
          </a>
          <span aria-hidden="true" className="text-white/20">
            /
          </span>
          <a
            href={getTelegramHref(config.telegramContact)}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white"
          >
            Contact: <span className="font-medium text-[#F4F6FB]">{config.telegramContact}</span>
          </a>
          <span aria-hidden="true" className="text-white/20">
            /
          </span>
          <button
            type="button"
            onClick={() => onNavigate('/admin')}
            className="transition-colors hover:text-white cursor-pointer"
          >
            Admin Console
          </button>
        </div>
      </div>
    </footer>
  );
}
