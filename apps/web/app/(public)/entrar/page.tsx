import type { Metadata } from 'next';
import Link from 'next/link';
import { SignInForm } from '../../../components/AccountForms.js';
import { t } from '../../../src/i18n/index.js';
import { RETURN_PARAM, safeReturnPath } from '../../../src/return-path.js';

/** Sign in to an optional voter account (feature 004, Stories 2 and 5). */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: t.account.signInTitle };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const returnTo = safeReturnPath((await searchParams)[RETURN_PARAM]);
  return (
    <section className="max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">{t.account.signInTitle}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t.account.signInIntro}</p>
      <SignInForm returnTo={returnTo} />
      <p className="text-ink-muted mt-6 text-sm">{t.account.forgotPassword}</p>
      <p className="text-ink-muted mt-2 text-sm">
        {t.account.noAccount}{' '}
        <Link
          href={`/registar?${RETURN_PARAM}=${encodeURIComponent(returnTo)}`}
          className="text-ink underline"
        >
          {t.account.register}
        </Link>
      </p>
    </section>
  );
}
