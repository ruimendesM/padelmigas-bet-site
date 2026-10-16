'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError } from '@padelmigas/client';
import { api } from '../src/api.js';
import { safeReturnPath } from '../src/return-path.js';
import { t } from '../src/i18n/index.js';

/**
 * Register, sign-in, change-password and sign-out (feature 004, FR-303 – FR-322).
 *
 * Validation here only shapes the message: the server re-applies every rule (Principle IV). After a
 * success the page is re-rendered from the server, so the header and every group's voted state come
 * from the same caller resolution the API uses — never from this component's memory.
 */

const INPUT = 'bg-surface border-border min-h-11 w-full rounded-md border px-3 text-sm';
const PRIMARY =
  'bg-accent text-accent-ink min-h-11 rounded-md px-4 text-sm font-semibold disabled:opacity-50';

function messageFor(failure: unknown): string {
  const code = failure instanceof ApiRequestError ? failure.code : 'NETWORK_ERROR';
  const issue = failure instanceof ApiRequestError ? failure.issues[0]?.message : undefined;
  if (code === 'MALFORMED_PAYLOAD' && issue) return issue;
  return t.errors[code as keyof typeof t.errors] ?? t.common.error;
}

function Field(props: {
  id: string;
  label: string;
  hint?: string;
  type: 'text' | 'password';
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type}
        autoComplete={props.autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        className={`${INPUT} mt-1`}
      />
      {props.hint ? (
        <p id={`${props.id}-hint`} className="text-ink-muted mt-1 text-xs">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

interface FormProps {
  onSubmit(): Promise<void>;
  error: string | null;
  children: ReactNode;
}

function Form(props: FormProps) {
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSubmit();
      }}
    >
      {props.children}
      {props.error ? (
        <p role="alert" className="text-danger text-sm">
          {props.error}
        </p>
      ) : null}
    </form>
  );
}

export function RegisterForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.register({ body: { username, password } });
      router.push(safeReturnPath(returnTo));
      router.refresh();
    } catch (failure) {
      setError(messageFor(failure));
      setBusy(false);
    }
  }

  return (
    <Form onSubmit={submit} error={error}>
      <Field
        id="register-username"
        label={t.account.username}
        hint={t.account.usernameHint}
        type="text"
        autoComplete="username"
        value={username}
        onChange={setUsername}
      />
      <Field
        id="register-password"
        label={t.account.password}
        hint={t.account.passwordHint}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
      />
      <button
        type="submit"
        disabled={busy || username.length === 0 || password.length === 0}
        className={PRIMARY}
      >
        {busy ? t.account.registering : t.account.registerSubmit}
      </button>
    </Form>
  );
}

export function SignInForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // Set when the server answers PASSWORD_CHANGE_REQUIRED: the same call is re-sent with the new one.
  const [mustChange, setMustChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.signIn({
        body: { username, password, ...(mustChange ? { newPassword } : {}) },
      });
      router.push(safeReturnPath(returnTo));
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.code === 'PASSWORD_CHANGE_REQUIRED') {
        setMustChange(true);
      } else {
        setError(messageFor(failure));
      }
      setBusy(false);
    }
  }

  return (
    <Form onSubmit={submit} error={error}>
      <Field
        id="signin-username"
        label={t.account.username}
        type="text"
        autoComplete="username"
        value={username}
        onChange={setUsername}
      />
      <Field
        id="signin-password"
        label={t.account.password}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
      {mustChange ? (
        <>
          <p role="status" className="text-sm">
            {t.account.temporaryPasswordNotice}
          </p>
          <Field
            id="signin-new-password"
            label={t.account.newPassword}
            hint={t.account.passwordHint}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
          />
        </>
      ) : null}
      <button
        type="submit"
        disabled={
          busy ||
          username.length === 0 ||
          password.length === 0 ||
          (mustChange && newPassword.length === 0)
        }
        className={PRIMARY}
      >
        {busy
          ? t.account.signingIn
          : mustChange
            ? t.account.temporaryPasswordSubmit
            : t.account.signInSubmit}
      </button>
    </Form>
  );
}

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.changePassword({ body: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setDone(true);
      router.refresh();
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form onSubmit={submit} error={error}>
      <Field
        id="change-current"
        label={t.account.currentPassword}
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={setCurrentPassword}
      />
      <Field
        id="change-new"
        label={t.account.newPassword}
        hint={t.account.passwordHint}
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPassword}
      />
      {done ? (
        <p role="status" className="text-sm">
          {t.account.passwordChanged}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || currentPassword.length === 0 || newPassword.length === 0}
        className={PRIMARY}
      >
        {busy ? t.account.changingPassword : t.account.changePasswordSubmit}
      </button>
    </Form>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await api.signOut();
    } finally {
      // Whatever the network said, show the server's view of who this device now is.
      router.push('/');
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void signOut()} disabled={busy} className={className}>
      {busy ? t.account.signingOut : t.account.signOut}
    </button>
  );
}
