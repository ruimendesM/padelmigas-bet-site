# ADR-009: Unit-Test the Rules Exhaustively, Contract-Test Every Route, Keep E2E Minimal

## Status
Accepted — 2026-08-27

## Context
Correctness risk in this system is concentrated and identifiable: the scoring formula, ballot
permutation validation, the vote-window boundary, and player matching. Everything else is display.
There is also an architectural risk that is not a test at all — import creep across the package
boundary that would quietly destroy the portability this design is built on. One maintainer means the
test suite has to be fast enough to run on every change and cheap enough to keep green.

## Decision
- **Unit tests (Vitest)** on `packages/core/{scoring,ballot,window,matching}` with a **100% branch
  coverage requirement** on exactly those modules, including zero-ballot groups, exact ties, rounding,
  and the boundary instant of the voting window. No coverage floor anywhere else.
- **Contract tests** per `/api/v1` route asserting the documented success shape and each documented
  failure code (`VOTING_CLOSED`, `ALREADY_VOTED`, `DUPLICATE_POSITION`, `INCOMPLETE_BALLOT`,
  `UNRESOLVED_PLAYERS`, `RESULTS_HIDDEN`, …), plus a non-leakage assertion on every public read path.
- **End-to-end (Playwright)**: exactly two flows — publish a lineup, and vote-then-reveal.
- **Boundary check**: `dependency-cruiser` in CI failing on forbidden imports in `packages/core` and
  on any `packages/**` → `apps/**` edge.
- **Migration check**: all migrations applied to a scratch database in CI.

Test-first is mandatory for the four core modules; elsewhere it is not required.

## Consequences

### Positive
- The parts that produce wrong numbers are the parts under the strictest tests.
- Contract tests double as the guarantee that a future mobile client sees the documented behaviour.
- The non-leakage assertions turn the reveal gate from an intention into a checked property.
- Two E2E flows stay fast and rarely flake, so they are actually trusted.

### Negative
- A 100% branch floor on core makes some defensive branches annoying to justify; unreachable ones
  must be removed rather than ignored.
- Contract tests need a real database, so CI requires a scratch Postgres and is slower than pure units.
- Thin coverage on UI code means visual and interaction regressions can ship.

### Neutral
- Playwright can grow later if a specific regression justifies a third flow; the default is no.

## Alternatives Considered
- **Broad E2E coverage instead of unit depth** — closer to real usage. Rejected: slow, flaky, and bad
  at covering permutation and tie edge cases, which is where the real risk is.
- **A global coverage percentage** — simple to state. Rejected: it rewards testing display code and
  says nothing about whether the scoring branches are covered.
- **Jest** — familiar. Rejected for slower ESM/TypeScript execution in this workspace layout.
- **Reviewing import boundaries by eye** — free. Rejected: it is exactly the discipline that fails
  under time pressure, and the whole portability argument depends on it.

## References
- Constitution, Development Workflow & Quality Gates
- [quickstart.md](../../specs/001-group-standings-voting/quickstart.md) — Automated verification
