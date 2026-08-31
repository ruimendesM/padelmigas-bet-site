import {
  LINEUP_IMAGE_MIME_TYPES,
  MAX_LINEUP_IMAGE_BYTES,
  type ExtractLineupBody,
  type LineupExtractionDto,
} from '@padelmigas/contracts';
import { domainError, normalizeExtraction } from '@padelmigas/core';
import type { Handler } from '../handler.js';

/**
 * Reads a lineup screenshot and returns candidate rows with suspect values flagged (FR-101, FR-102,
 * FR-105 – FR-108).
 *
 * Nothing here is authoritative. What this returns is a suggestion the organiser edits; publication
 * is still decided by preview and publish, which re-validate the submitted draft exactly as they do
 * a hand-typed one (FR-111, FR-112). No path from this handler writes to the database.
 *
 * The image is held only for the duration of this call. It is never persisted, never logged, and
 * never echoed back in a message or an issue (FR-118).
 *
 * Order of checks is deliberate: size and type are refused before the reader is touched, so an
 * oversized or wrong-typed upload never reaches a third party (FR-117).
 */
export const extractLineup: Handler<ExtractLineupBody, LineupExtractionDto> = async (
  body,
  deps,
) => {
  const { mimeType, dataBase64 } = body.image;

  if (!(LINEUP_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw domainError(
      'PAYLOAD_TOO_LARGE',
      `Tipo de imagem não suportado. Usa ${LINEUP_IMAGE_MIME_TYPES.join(', ')}.`,
      [{ path: 'image.mimeType', message: `Aceita apenas ${LINEUP_IMAGE_MIME_TYPES.join(', ')}.` }],
    );
  }

  // Base64 carries 3 bytes per 4 characters, so the decoded size is knowable before decoding. An
  // over-cap body is refused without ever being allocated.
  const declaredBytes = Math.floor((dataBase64.length * 3) / 4);
  if (declaredBytes > MAX_LINEUP_IMAGE_BYTES) {
    throw tooLarge();
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(dataBase64);
  } catch {
    throw domainError('MALFORMED_PAYLOAD', 'A imagem não está codificada em base64 válido.', [
      { path: 'image.dataBase64', message: 'Não é base64 válido.' },
    ]);
  }

  if (bytes.byteLength > MAX_LINEUP_IMAGE_BYTES) {
    throw tooLarge();
  }

  // Absence is a supported deployment state, not a fault: the organiser is told extraction is off
  // and keeps hand entry (FR-119, FR-120, ADR-011).
  const reader = deps.imageReader;
  if (reader === undefined) {
    throw domainError(
      'EXTRACTION_UNAVAILABLE',
      'A leitura de imagens não está configurada nesta instalação.',
    );
  }

  let rawRows;
  try {
    rawRows = await reader.read({ mimeType, bytes });
  } catch {
    // Deliberately swallowing the cause: it may quote the provider's response, and nothing derived
    // from the image may reach a client or a log (FR-118).
    throw domainError(
      'EXTRACTION_FAILED',
      'Não foi possível ler a imagem. Tenta outra imagem ou introduz o alinhamento à mão.',
    );
  }

  const { rows, warnings } = normalizeExtraction(rawRows);

  return {
    rows: rows.map((row) => ({
      sourceIndex: row.sourceIndex,
      players: [
        { name: row.players[0].name, points: row.players[0].points },
        { name: row.players[1].name, points: row.players[1].points },
      ],
      totalPoints: row.totalPoints,
      club: row.club,
      flags: [...row.flags],
    })),
    warnings: [...warnings],
  };
};

function tooLarge() {
  const megabytes = MAX_LINEUP_IMAGE_BYTES / (1024 * 1024);
  return domainError('PAYLOAD_TOO_LARGE', `A imagem excede o limite de ${megabytes} MB.`, [
    { path: 'image.dataBase64', message: `O limite é ${megabytes} MB.` },
  ]);
}

/**
 * Base64 → bytes without a Node-only API.
 *
 * `packages/api` must run on any host (Principle II), so `Buffer` is out; `atob` is part of the
 * platform in every runtime this ships to. It throws on invalid input, which is what the caller
 * turns into `MALFORMED_PAYLOAD`.
 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
