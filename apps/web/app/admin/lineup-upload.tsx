'use client';

import { useRef, useState } from 'react';
import {
  LINEUP_IMAGE_MIME_TYPES,
  MAX_LINEUP_IMAGE_BYTES,
  type LineupExtractionDto,
} from '@padelmigas/contracts';
import { api } from '../../src/api.js';
import { t } from '../../src/i18n/index.js';

/**
 * The image upload control (FR-101, FR-115, FR-117).
 *
 * Size and type are pre-checked here so the organiser gets an instant answer instead of a round
 * trip, but the server checks both again and is the only authority — a client-side check is a
 * courtesy, never a gate (FR-112, Principle IV).
 *
 * The request goes through the generated client, like every other call in the app (Principle III).
 * The image is read into memory, sent, and dropped; nothing is kept here either.
 */

interface Props {
  /** Called with the extraction result. Replacing an existing draft is the caller's business. */
  readonly onExtracted: (extraction: LineupExtractionDto) => void;
  readonly onFailure: (failure: unknown) => void;
  readonly disabled: boolean;
}

const MEGABYTES = MAX_LINEUP_IMAGE_BYTES / (1024 * 1024);

export function LineupUpload({ onExtracted, onFailure, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function choose(file: File): Promise<void> {
    setLocalError(null);

    if (!(LINEUP_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setLocalError(t.admin.uploadWrongType);
      return;
    }
    if (file.size > MAX_LINEUP_IMAGE_BYTES) {
      setLocalError(t.admin.uploadTooLargeLocal(MEGABYTES));
      return;
    }

    setBusy(true);
    try {
      const extraction = await api.extractLineup({
        body: {
          image: {
            mimeType: file.type as (typeof LINEUP_IMAGE_MIME_TYPES)[number],
            dataBase64: await toBase64(file),
          },
        },
      });
      onExtracted(extraction);
    } catch (failure) {
      onFailure(failure);
    } finally {
      setBusy(false);
      // Let the same file be chosen again after a failure; otherwise the input ignores it.
      if (input.current !== null) input.current.value = '';
    }
  }

  return (
    <section className="mt-6" aria-label={t.admin.uploadHeading}>
      <h2 className="text-sm font-semibold">{t.admin.uploadHeading}</h2>
      <p className="text-ink-muted mt-1 text-xs">{t.admin.uploadHint}</p>

      <input
        ref={input}
        id="lineup-image"
        type="file"
        accept={LINEUP_IMAGE_MIME_TYPES.join(',')}
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void choose(file);
        }}
        className="text-ink-muted mt-3 block w-full text-xs"
      />

      {busy ? (
        <p role="status" className="text-ink-muted mt-2 text-xs">
          {t.admin.uploadReading}
        </p>
      ) : null}

      {localError !== null ? (
        <p role="alert" className="text-danger mt-2 text-xs">
          {localError}
        </p>
      ) : null}
    </section>
  );
}

/** `File` → base64, without a data-URL prefix, which is what the contract asks for. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // Chunked: spreading a multi-megabyte array into `String.fromCharCode` overflows the call stack.
  const CHUNK = 8192;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
