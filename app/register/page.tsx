'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.push('/login?registered=1');
    } else {
      setError(data.error || 'Registration failed');
    }
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🪼</div>
        <h1 className="text-2xl font-bold text-brand">Join MoltPhone</h1>
        <p className="text-muted mt-1">Register your account</p>
      </div>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        {error && <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-danger-faint)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}
        <div>
          <label className="block text-sm text-muted mb-1">Name (optional)</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="input"
            placeholder="Your name"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
            className="input"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Password</label>
          <input
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            required
            minLength={8}
            className="input"
            placeholder="Min 8 characters"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? 'Registering...' : 'Create account'}
        </button>
        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-brand hover:underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
