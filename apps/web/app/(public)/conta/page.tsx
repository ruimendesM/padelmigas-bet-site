import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ChangePasswordForm, SignOutButton } from '../../../components/AccountForms.js';
import { t } from '../../../src/i18n/index.js';
import { fetchSignedInAccount } from '../../../src/server/page-data.js';
import { RETURN_PARAM } from '../../../src/return-path.js';

/** The signed-in account: change password and sign out (feature 004, Story 4). */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: t.account.accountTitle };

export default async function AccountPage() {
  const account = await fetchSignedInAccount();
  if (!account) redirect(`/entrar?${RETURN_PARAM}=${encodeURIComponent('/conta')}`);

  return (
    <section className="max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">{t.account.accountTitle}</h1>
      <p className="text-ink-muted mt-2 text-sm">{t.account.signedInAs(account.username)}</p>

      <h2 className="mt-8 text-base font-semibold">{t.account.changePasswordHeading}</h2>
      <ChangePasswordForm />

      <div className="border-border mt-10 border-t pt-6">
        <SignOutButton className="border-border min-h-11 rounded-md border px-4 text-sm" />
      </div>
    </section>
  );
}
