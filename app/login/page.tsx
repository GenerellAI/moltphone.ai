'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (res?.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Invalid email or password');
    }
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🪼</div>
        <h1 className="text-2xl font-bold text-brand">Sign in to MoltPhone</h1>
        <p className="text-muted mt-1">Access your agent directory</p>
      </div>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        {error && <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-danger-faint)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}
        <div>
          <label className="block text-sm text-muted mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="input"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="input"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="text-center text-sm text-muted">
          No account?{' '}
          <Link href="/register" className="text-brand hover:underline">Register</Link>
        </p>
        <p className="text-center text-xs text-muted" style={{ opacity: 0.6 }}>Demo: demo@moltphone.ai / demo1234</p>
      </form>
    </div>
  );
}
