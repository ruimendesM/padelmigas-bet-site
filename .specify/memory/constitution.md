<!--
Sync Impact Report
- Version change: none → 1.0.0 (initial ratification)
- Modified principles: none (initial adoption)
- Added sections: Core Principles I–V; Technology & Data Constraints; Development Workflow &
  Quality Gates; Governance
- Removed sections: none
- Templates requiring review: .specify/templates/plan-template.md (Constitution Check gate),
  .specify/templates/spec-template.md, .specify/templates/tasks-template.md — read at runtime,
  no edits made here
- Deferred TODOs: none
-->
# Padelmigas Bet Constitution

## Core Principles

### I. Spec-Driven Delivery (NON-NEGOTIABLE)
Every behavioural change MUST start as a spec, then a plan, then tasks, before any implementation
code is written. Specs describe WHAT and WHY in user-observable terms and MUST NOT name
frameworks, table layouts, or file paths; those belong to the plan. Any implementation detail
discovered mid-build that contradicts the spec MUST be resolved by amending the spec first, not by
diverging silently in code.

Rationale: the product will outlive its first stack. A written, reviewed spec is the only artifact
that survives a rewrite of the web app, the API host, or the database.

### II. Portable Core, Thin Adapters (NON-NEGOTIABLE)
All business logic — validation, scoring, aggregation, lock-time rules, domain types — MUST live in
framework-agnostic packages that import nothing from a host framework or a vendor SDK. Enforced
statically:

- `packages/core/**` MUST NOT import `next/*`, `react`, `react-dom`, `react-native`, `expo/*`,
  `@supabase/*`, or any Node-only built-in beyond `crypto`.
- Data access MUST be expressed in `packages/core` as repository interfaces; the only module allowed
  to construct a Supabase client is `packages/db`.
- Application handlers MUST be pure functions of shape `(input, deps) => Promise<output>` in
  `packages/api`; host route files (Next.js route handlers today) are adapters limited to parsing
  the request, calling one handler, and serialising the response — no business branching.
- Any UI logic shared with a future mobile client MUST live in `packages/ui-logic` as hooks and
  pure functions with no DOM access; only rendering components may be platform-specific.

Rationale: a React Native app and a standalone API service are both stated future intents. Keeping
the core portable turns each migration into replacing adapters instead of rewriting the product.

### III. Contract-First, Versioned API
The HTTP surface MUST be defined by Zod schemas in `packages/contracts` before handlers are written,
and those schemas MUST be the single source of truth for request/response validation, generated
TypeScript client types, and generated OpenAPI. All routes MUST be served under an explicit version
prefix (`/api/v1/...`). Additive fields MAY ship within a version; any removal, rename, or semantic
change of an existing field MUST ship as a new version prefix with the previous version kept alive
until every known client is migrated. Clients (web today, mobile later) MUST consume the generated
client package and MUST NOT hand-roll fetch calls or hard-code URLs outside it.

Rationale: mobile clients ship on store timelines and cannot be redeployed with the server.

### IV. Server-Authoritative Trust Boundary
Rules that decide what is allowed MUST be enforced on the server: vote-window (open/closed) checks,
one-ballot-per-voter enforcement, ballot completeness and permutation validity, and all aggregation.
Clients MAY pre-validate for UX but their results MUST NOT be trusted. Secrets MUST NOT reach the
client: the Supabase service-role key and any admin credential MUST exist only in server runtime
environment variables. Row Level Security MUST be enabled and deny-by-default on every table;
anonymous clients MUST have no direct write path to ballots, tournaments, players, or pairs.
Aggregate results MUST NOT be readable through any path that reveals an individual voter's ballot.

Rationale: the voting surface is public and anonymous; anything checkable only in the browser is
effectively unenforced.

### V. Simplicity and YAGNI
The smallest design that satisfies the current spec MUST be chosen. Queues, caches, background
workers, microservices, event sourcing, GraphQL, and multi-region deployment are FORBIDDEN until a
written spec states a requirement that the simpler design provably cannot meet. Every new runtime
dependency, deploy target, or hosted service MUST be justified in the plan's Complexity Tracking
section with the simpler alternative that was rejected and why. Schema MAY reserve space for a
planned phase (for example real final standings) but code for unbuilt phases MUST NOT be written.

Rationale: this is a small-audience club product maintained by one person; operational surface is
the dominant long-term cost.

## Technology & Data Constraints

- **Language**: TypeScript everywhere, `strict: true`. No `any` in `packages/**` except at parse
  boundaries with an inline justification comment.
- **Web**: React with Next.js (App Router). **Mobile (future)**: React Native/Expo consuming the
  same contracts and `packages/ui-logic`.
- **Data**: Supabase Postgres is the system of record. All schema changes MUST be committed SQL
  migrations in `supabase/migrations/`; console-only edits are FORBIDDEN.
- **Domain model**: players are stored individually, one row per real person, never as a
  denormalised "pair" string. Pairs reference two player rows. Tournament history is a separate
  entity that references pairs and therefore players, so a player's history across tournaments is
  a query, not a copy.
- **Player identity**: the canonical external identifier is the `ID` column of the public
  Padelmigas ranking sheet. Player matching MUST be exact-name after Unicode NFC normalisation,
  case folding, and whitespace collapsing — no fuzzy matching. Unmatched names MUST fail the import
  loudly and be resolved by a human, never auto-created silently under a guessed identity.
- **Voter identity**: anonymous, cookie-backed voter tokens. No account, no password, no email in
  phase 1. A cleared cookie or a private window is an accepted new voter; heavier anti-abuse is out
  of scope until abuse is observed.
- **Privacy**: no personal data beyond publicly published player names, club, and ranking points.
  Voter records MUST NOT store IP addresses or user agents beyond what is needed for rate limiting,
  and any such data MUST have a stated retention window.
- **Locale & time**: pt-PT is the primary user language, en as fallback; copy MUST NOT be
  hard-coded in components. All instants MUST be stored as `timestamptz` in UTC and presented in
  `Europe/Lisbon`.

## Development Workflow & Quality Gates

- **Test-first for the core**: scoring, aggregation, ballot validation, lock-window logic, and
  player matching MUST have failing unit tests written before their implementation. These modules
  MUST reach and hold 100% branch coverage; the rest of the codebase has no coverage floor.
- **Contract tests**: every `/api/v1` route MUST have a test asserting its documented success shape
  and its documented failure shapes (closed window, duplicate ballot, invalid permutation,
  unknown tournament).
- **Gates before merge**: typecheck, lint, unit tests, contract tests, and the import-boundary
  check enforcing Principle II MUST all pass. A failing gate MUST NOT be bypassed; fix or revert.
- **Migrations**: every migration MUST be applied against a scratch database in CI and MUST be
  accompanied by the rollback statement or an explicit note that it is irreversible.
- **Definition of done**: spec updated, tests passing, migration committed, and the observable
  behaviour verified against the running app — not merely asserted.

## Governance

This constitution supersedes ad-hoc preference and prior habit. It applies to all code, schema,
and documentation in this repository.

- **Amendment procedure**: amendments MUST be made by editing this file in a dedicated change,
  stating the motivation and the migration impact on existing code. Principles marked
  NON-NEGOTIABLE MAY be amended but MUST NOT be waived case-by-case.
- **Versioning policy**: semantic. MAJOR for removing or redefining a principle in a
  backward-incompatible way, MINOR for a new principle or materially expanded rule, PATCH for
  clarification and wording.
- **Compliance review**: every plan MUST include a Constitution Check that names the principles at
  risk and how the design satisfies them. Any deliberate deviation MUST be recorded in the plan's
  Complexity Tracking table with the simpler alternative rejected and the reason; an undocumented
  deviation is a defect.
- **Runtime guidance**: agent-facing operational guidance lives in `CLAUDE.md`; where it conflicts
  with this constitution, the constitution wins.

**Version**: 1.0.0 | **Ratified**: 2026-08-27 | **Last Amended**: 2026-08-27
