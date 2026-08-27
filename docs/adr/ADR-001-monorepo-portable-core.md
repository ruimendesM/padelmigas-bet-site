# ADR-001: Monorepo with a Portable Core and Thin Host Adapters

## Status
Accepted — 2026-08-27

## Context
The product starts as a React web app but two future directions are stated up front: native mobile
clients built with React Native, and possibly a standalone API service once mobile clients exist.
Both are cheap if business logic is host-agnostic and expensive if it is entangled with the web
framework. The usual failure mode is not a bad initial layout but decay: `lib/` starts pure, then a
`next/headers` import appears in a validation module, and a year later the "shared" logic is
unshareable. Constraints: one maintainer, TypeScript everywhere, and a preference for not paying for
flexibility that is never used.

## Decision
Use a pnpm-workspaces monorepo with Turborepo, split into hosts and portable packages:

- `apps/web` — the only Next.js-aware directory. Pages, components, and route adapters.
- `packages/contracts` — Zod schemas; generates OpenAPI and the typed client.
- `packages/core` — domain logic: scoring, ballot validation, vote-window rules, player matching,
  lineup derivation, and repository *interfaces*. Imports no framework and no vendor SDK.
- `packages/api` — application handlers shaped `(input, deps) => Promise<output>`.
- `packages/db` — the only module permitted to construct a Supabase client.
- `packages/client` — generated fetch-only HTTP client.
- `packages/ui-logic` — hooks and state shared with a future mobile client; no DOM access.

Enforce it mechanically: `dependency-cruiser` rules in CI forbid `next/*`, `react`, `react-dom`,
`react-native`, `expo/*`, and `@supabase/*` inside `packages/core`, forbid any `packages/**` →
`apps/**` import, and forbid `apps/**` → `packages/db`. A violation fails the build.

## Consequences

### Positive
- Adding `apps/mobile` requires no new packages: it imports `packages/client` and
  `packages/ui-logic` as they stand.
- Detaching the API means re-hosting `packages/api` behind another framework; `packages/core` is
  untouched.
- Domain rules are unit-testable with no framework harness, which is what makes the 100% branch
  coverage requirement on core affordable.
- The boundary is a build failure rather than a code-review habit, so it survives busy weeks.

### Negative
- Workspace tooling to set up and keep working: shared tsconfig, build ordering, package versioning.
- More indirection than a single app: a change spanning contract, handler, and page touches three
  packages.
- Cross-package refactors need care with editor tooling and CI caching.

### Neutral
- Turborepo caching is useful now and more useful later; it is not load-bearing for correctness.

## Alternatives Considered
- **Single Next.js app with `lib/`** — fastest start and least ceremony. Rejected because the two
  stated future moves both become rewrites, and the purity of `lib/` is unenforceable in practice.
- **Nx** — richer generators and task graph than Turborepo. Rejected as more configuration surface
  than a project this size repays.
- **Separate repos for web and API from day one** — genuine isolation. Rejected because the contract
  would need publishing and versioning across repos before there is a second consumer.

## References
- Constitution, Principle II (Portable Core, Thin Adapters)
- [plan.md](../../specs/001-group-standings-voting/plan.md) — Project Structure
- [research.md](../../specs/001-group-standings-voting/research.md) — D1
