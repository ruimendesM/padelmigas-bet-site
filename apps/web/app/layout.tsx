import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { t } from '../src/i18n/index.js';
import './globals.css';

/**
 * App shell.
 *
 * `lang="pt-PT"` and copy from `src/i18n` — no visible string is written inline anywhere in the app
 * (constitution: Locale & time). Instants are formatted in `Europe/Lisbon` by
 * `@padelmigas/ui-logic/format`, never by the device's timezone.
 */

export const metadata: Metadata = {
  title: {
    default: t.app.name,
    template: `%s · ${t.app.name}`,
  },
  description: t.app.tagline,
  // The site is a voting surface, not content to index while a tournament is live.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1220',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <body className="min-h-dvh">
        {/* Skip link: the first tab stop on a page whose main content is a long list (SC-011). */}
        <a
          href="#conteudo"
          className="focus:bg-accent focus:text-accent-ink sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:px-3 focus:py-2"
        >
          {t.app.nav.tournaments}
        </a>

        <header className="border-border border-b">
          <nav
            aria-label={t.app.nav.tournaments}
            className="max-w-content mx-auto flex items-center justify-between gap-4 px-4 py-3"
          >
            <Link href="/" className="text-base font-semibold tracking-tight">
              {t.app.name}
            </Link>
            <ul className="text-ink-muted flex items-center gap-4 text-sm">
              <li>
                <Link href="/" className="hover:text-ink">
                  {t.app.nav.tournaments}
                </Link>
              </li>
              <li>
                <Link href="/historico" className="hover:text-ink">
                  {t.app.nav.history}
                </Link>
              </li>
            </ul>
          </nav>
        </header>

        <main id="conteudo" className="max-w-content mx-auto px-4 py-6">
          {children}
        </main>

        <footer className="max-w-content text-ink-muted mx-auto px-4 pb-10 pt-4 text-xs">
          {t.app.footer.note}
        </footer>
      </body>
    </html>
  );
}
