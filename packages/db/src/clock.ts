import type { Clock } from '@padelmigas/core';

/**
 * The system clock.
 *
 * This is the only implementation of {@link Clock} in production code and therefore the only place
 * the wall clock is read — the ESLint `no-restricted-syntax` rule bans `new Date()` and `Date.now()`
 * everywhere else. One source means one place a lock-boundary bug can live (SC-007, Risk R5).
 */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock frozen at a chosen instant. For tests and for the boundary cases `core/window` asserts. */
export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at.getTime()) };
}
