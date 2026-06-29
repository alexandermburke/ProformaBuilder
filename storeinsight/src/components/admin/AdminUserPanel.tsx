'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

type AdminUser = {
  email: string;
  role: 'admin' | 'user';
  disabled: boolean;
  protected: boolean;
};

type ApiResult = { ok?: boolean; message?: string; users?: AdminUser[]; currentEmail?: string };

const MIN_PASSWORD_LENGTH = 8;

export default function AdminUserPanel({
  open,
  onClose,
  currentEmail,
}: {
  open: boolean;
  onClose: () => void;
  currentEmail: string | null;
}): JSX.Element | null {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');

  const [pwTarget, setPwTarget] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as ApiResult | null;
      if (!res.ok || !json?.ok) throw new Error(json?.message || 'Unable to load users.');
      setUsers(json.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setPwTarget(null);
      setPwValue('');
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  const runMutation = async (key: string, request: () => Promise<Response>): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      const res = await request();
      const json = (await res.json().catch(() => null)) as ApiResult | null;
      if (!res.ok || !json?.ok) throw new Error(json?.message || 'Request failed.');
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addUser = async () => {
    const ok = await runMutation('__add__', () =>
      fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), password: newPassword.trim(), role: newRole }),
      }),
    );
    if (ok) {
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
    }
  };

  const patchUser = (email: string, body: Record<string, unknown>) =>
    runMutation(email, () =>
      fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...body }),
      }),
    );

  const savePassword = async () => {
    if (!pwTarget) return;
    const ok = await patchUser(pwTarget, { password: pwValue.trim() });
    if (ok) {
      setPwTarget(null);
      setPwValue('');
    }
  };

  const removeUser = async (email: string) => {
    if (!window.confirm(`Delete ${email}? This cannot be undone.`)) return;
    await runMutation(email, () =>
      fetch(`/api/admin/users?email=${encodeURIComponent(email)}`, { method: 'DELETE' }),
    );
  };

  const fieldClass =
    'rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm">
      <div className="ios-card ios-animate-up flex max-h-[85vh] w-full max-w-2xl flex-col gap-5 overflow-hidden p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">User Management</h3>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Add, edit, or remove logins. Changes apply to the Firebase auth store immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ios-icon-button text-[color:var(--text-secondary)]"
            aria-label="Close user management"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
              <path
                fill="currentColor"
                d="m7.05 7.757 4.242 4.243 4.243-4.243 1.414 1.415-4.242 4.243 4.242 4.242-1.414 1.415-4.243-4.243-4.242 4.243-1.414-1.415 4.242-4.242-4.242-4.243z"
              />
            </svg>
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-300 bg-red-50/80 px-3 py-2 text-xs text-red-600" role="alert">
            {error}
          </div>
        ) : null}

        {/* Add user */}
        <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 p-4">
          <div className="mb-3 text-sm font-semibold text-[color:var(--text-primary)]">Add user</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@storestorage.com"
              autoComplete="off"
              className={fieldClass}
            />
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={`Password (min ${MIN_PASSWORD_LENGTH})`}
              autoComplete="new-password"
              className={fieldClass}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value === 'admin' ? 'admin' : 'user')}
              className={fieldClass}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              onClick={addUser}
              disabled={busy === '__add__' || !newEmail.trim() || newPassword.trim().length < MIN_PASSWORD_LENGTH}
              className="ios-button px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy === '__add__' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>

        {/* User list */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[color:var(--border-soft)]">
          {loading ? (
            <div className="p-4 text-sm text-[color:var(--text-secondary)]">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="p-4 text-sm text-[color:var(--text-secondary)]">No users found.</div>
          ) : (
            <ul className="divide-y divide-[color:var(--border-soft)]">
              {users.map((user) => {
                const rowBusy = busy === user.email;
                const isSelf = currentEmail?.trim().toLowerCase() === user.email;
                return (
                  <li key={user.email} className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[color:var(--text-primary)]">{user.email}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            user.role === 'admin'
                              ? 'bg-[rgba(37,99,235,0.14)] text-[color:var(--accent)]'
                              : 'bg-[rgba(148,163,255,0.18)] text-[color:var(--text-secondary)]'
                          }`}
                        >
                          {user.role}
                        </span>
                        {user.disabled ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                            disabled
                          </span>
                        ) : null}
                        {user.protected ? (
                          <span className="text-[10px] text-[color:var(--text-muted)]">primary admin</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setPwTarget(pwTarget === user.email ? null : user.email);
                            setPwValue('');
                          }}
                          disabled={rowBusy}
                          className="rounded-lg border border-[color:var(--border-soft)] px-2.5 py-1 text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--accent)] disabled:opacity-50"
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => patchUser(user.email, { role: user.role === 'admin' ? 'user' : 'admin' })}
                          disabled={rowBusy || user.protected || (isSelf && user.role === 'admin')}
                          className="rounded-lg border border-[color:var(--border-soft)] px-2.5 py-1 text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--accent)] disabled:opacity-40"
                        >
                          {user.role === 'admin' ? 'Make user' : 'Make admin'}
                        </button>
                        <button
                          type="button"
                          onClick={() => patchUser(user.email, { disabled: !user.disabled })}
                          disabled={rowBusy || user.protected || (isSelf && !user.disabled)}
                          className="rounded-lg border border-[color:var(--border-soft)] px-2.5 py-1 text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--accent)] disabled:opacity-40"
                        >
                          {user.disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeUser(user.email)}
                          disabled={rowBusy || user.protected || isSelf}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {pwTarget === user.email ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={pwValue}
                          onChange={(e) => setPwValue(e.target.value)}
                          placeholder={`New password (min ${MIN_PASSWORD_LENGTH})`}
                          autoComplete="new-password"
                          className={`${fieldClass} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={savePassword}
                          disabled={rowBusy || pwValue.trim().length < MIN_PASSWORD_LENGTH}
                          className="ios-button px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          {rowBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPwTarget(null);
                            setPwValue('');
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs text-[color:var(--text-secondary)]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
