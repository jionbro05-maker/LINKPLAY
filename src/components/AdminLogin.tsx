import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { FormEvent, useState } from 'react';
import { setAdminToken } from '../lib/adminAuth';

interface AdminLoginProps {
  onSuccess: (admin: { id: number; username: string }) => void;
  onNavigateHome: () => void;
}

export function AdminLogin({ onSuccess, onNavigateHome }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both username and password.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as {
        admin?: { id: number; username: string };
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.admin) {
        setError(data.error || 'Authentication failed.');
        return;
      }
      if (data.token) {
        setAdminToken(data.token);
      }
      onSuccess(data.admin);
    } catch {
      setError('Network error while signing in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[calc(100vh-140px)] items-center justify-center overflow-hidden bg-[#0B0C10] px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[#E50914]/15 blur-[120px]"
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md rounded-xl border border-white/10 bg-[#15171E] p-7 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E50914]/15 text-[#E50914]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-white">
              LINKPLAY<span className="glow-wordmark text-[#E50914]">HD</span> Admin
            </h1>
            <p className="text-xs text-[#9CA3B2]">Sign in to manage streams, links, watermark, and live analytics</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-username" className="block text-xs font-medium text-[#C7CDD9]">
              Username
            </label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter admin username"
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-xs font-medium text-[#C7CDD9]">
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-lg border border-white/10 bg-[#0B0C10] py-2.5 pl-3.5 pr-10 text-sm text-white placeholder-[#9CA3B2]/50 focus:border-[#E50914] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#9CA3B2] hover:text-white cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#E50914] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(229,9,20,0.3)] transition-all hover:bg-[#F6121D] disabled:opacity-60 cursor-pointer"
          >
            <Lock className="h-4 w-4" />
            {submitting ? 'Signing in...' : 'Sign In to Studio'}
          </button>
        </form>

        <div className="mt-6 border-t border-white/[0.07] pt-4 text-center">
          <button
            type="button"
            onClick={onNavigateHome}
            className="text-xs font-medium text-[#9CA3B2] transition-colors hover:text-white cursor-pointer"
          >
            Return to Public Catalog
          </button>
        </div>
      </motion.div>
    </div>
  );
}
