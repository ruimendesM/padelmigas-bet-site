import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '../../../components/AccountForms.js';
import { t } from '../../../src/i18n/index.js';
import { RETURN_PARAM, safeReturnPath } from '../../../src/return-path.js';

/** Create an optional voter account (feature 004, Story 1). */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: t.account.registerTitle };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const returnTo = safeReturnPath((await searchParams)[RETURN_PARAM]);
  return (
    <section className="max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">{t.account.registerTitle}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t.account.registerIntro}</p>
      <RegisterForm returnTo={returnTo} />
      <p className="text-ink-muted mt-6 text-sm">
        {t.account.haveAccount}{' '}
        <Link
          href={`/entrar?${RETURN_PARAM}=${encodeURIComponent(returnTo)}`}
          className="text-ink underline"
        >
          {t.account.signIn}
        </Link>
      </p>
    </section>
  );
}
