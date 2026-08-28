import { closeSharedSql } from '@padelmigas/db';
import { isDomainError } from '@padelmigas/core';
import { buildDeps, configFromEnv, runRankingsSync } from './index.js';

/**
 * `pnpm rankings:sync` (FR-004).
 *
 * Exits non-zero on any failure so a scheduler or a CI step notices. A domain failure —
 * `DUPLICATE_MATCH_KEY` above all — prints its issues, because the operator's next action is to fix
 * the sheet and the issue list is the instruction (ADR-007).
 */
async function main(): Promise<void> {
  const deps = buildDeps(configFromEnv());
  try {
    const report = await runRankingsSync(deps);
    if (report.stale) {
      console.warn(
        'A folha de ranking está inacessível. Foi reimportada a última cópia guardada ' +
          `(${report.sourceFetchedAt}).`,
      );
    }
    console.log(
      `Linhas lidas: ${report.rowsRead} · jogadores criados: ${report.playersCreated} · ` +
        `atualizados: ${report.playersUpdated} · snapshots: ${report.snapshotsWritten}`,
    );
  } finally {
    await closeSharedSql();
  }
}

main().catch((error: unknown) => {
  if (isDomainError(error)) {
    console.error(`${error.code}: ${error.message}`);
    for (const issue of error.issues) console.error(`  - ${issue.path}: ${issue.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
