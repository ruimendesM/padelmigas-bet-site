import type { Messages } from './pt.js';

/**
 * English fallback (constitution: Locale & time — "pt-PT is the primary user language, en as
 * fallback").
 *
 * Typed as `Messages`, so the pt-PT file is the schema: adding a key there without adding it here is
 * a compile error, which is how the fallback stays complete instead of quietly degrading to blanks.
 */
export const en: Messages = {
  app: {
    name: 'Padelmigas Bet',
    tagline: "Predict each group's final standings.",
    nav: {
      tournaments: 'Tournaments',
      history: 'History',
      admin: 'Organiser',
    },
    footer: {
      note: 'Anonymous voting. One ballot per group, per device.',
    },
  },

  common: {
    loading: 'Loading…',
    retry: 'Try again',
    error: 'Something went wrong. Try again.',
    back: 'Back',
    points: 'points',
    group: 'Group',
    seed: 'Seed',
    close: 'Close',
  },

  tournamentList: {
    title: 'Tournaments',
    empty: 'No tournaments published yet.',
    openBadge: 'Voting open',
    closedBadge: 'Voting closed',
    groupCount: (count: number) => (count === 1 ? '1 group' : `${count} groups`),
    ballotCount: (count: number) => (count === 1 ? '1 ballot' : `${count} ballots`),
    startsAt: 'Starts',
    loadMore: 'Show more',
  },

  tournament: {
    votingOpenUntil: 'Voting open until the start',
    votingClosed: 'Voting closed',
    startsAt: 'Start',
    groupsHeading: 'Groups',
  },

  ballot: {
    heading: 'Your prediction',
    instructions: "Choose each pair's finishing position. Each position can be used only once.",
    positionLabel: (position: number) => `Position ${position}`,
    choosePosition: 'Choose position',
    clearPosition: 'Clear position',
    submit: 'Confirm ballot',
    submitting: 'Recording…',
    incomplete: 'Every position still needs to be assigned.',
    recorded: 'Ballot recorded.',
    recordedAnnouncement: "Your ballot was recorded. The group's results are now visible.",
    yourVote: 'Your ballot',
    alreadyVoted: 'You have already voted in this group.',
    closed: 'Voting has closed for this group.',
    rateLimited: 'Too many attempts. Wait a moment.',
  },

  results: {
    heading: 'Group prediction',
    hidden: 'Vote to see what the crowd predicts.',
    noVotes: 'No ballots in this group yet.',
    ballotCount: (count: number) => (count === 1 ? 'from 1 ballot' : `from ${count} ballots`),
    predictedPosition: 'Predicted position',
    meanPosition: 'Average position',
    positionSharesHeading: 'Vote distribution',
    sharePerPosition: (position: number, share: string) => `Position ${position}: ${share}`,
  },

  history: {
    title: 'History',
    empty: 'No closed tournaments yet.',
    finalPrediction: "Group's final prediction",
  },

  player: {
    appearances: 'Appearances',
    noAppearances: 'This player has not appeared in any tournament yet.',
    partner: 'Partner',
    pointsAtTournament: 'Points at the tournament',
    currentPoints: 'Current points',
    club: 'Club',
    rankingId: 'Ranking ID',
  },

  admin: {
    title: 'Publish a tournament',
    payloadLabel: 'Lineup (JSON)',
    payloadHint: 'Paste the lineup and preview it before publishing.',
    preview: 'Preview',
    previewing: 'Validating…',
    publish: 'Publish tournament',
    publishing: 'Publishing…',
    published: 'Tournament published.',
    resolvedPlayers: 'Resolved players',
    newPlayer: 'new',
    issuesHeading: 'Problems to fix',
    signIn: 'Sign in',
    password: 'Password',
    signInFailed: 'Incorrect password.',
    syncRankings: 'Sync rankings',
    syncing: 'Syncing…',
    syncReport: (created: number, updated: number) =>
      `${created} players created, ${updated} updated.`,
    syncStale: 'The ranking sheet is unreachable; the last stored copy was used.',
  },

  errors: {
    NOT_FOUND: 'Not found.',
    UNAUTHORISED: 'Not authorised.',
    RATE_LIMITED: 'Too many requests. Wait a moment.',
    MALFORMED_PAYLOAD: 'The request is not in the expected format.',
    INTERNAL_ERROR: 'Something unexpected went wrong. Try again.',
    UNRESOLVED_PLAYERS: 'Some names do not match any player on the ranking list.',
    START_NOT_IN_FUTURE: 'The start time must be in the future.',
    DUPLICATE_PLAYER: 'A player appears twice in this tournament.',
    POINTS_MISMATCH: "The total does not equal the sum of both players' points.",
    INVALID_GROUP_SIZE: 'A group must have between 3 and 6 pairs.',
    SLUG_TAKEN: 'A tournament with this address already exists.',
    NOT_CONFIRMED: 'Publishing must be confirmed.',
    DUPLICATE_MATCH_KEY: 'Two ranking-list players share the same name. Resolve it manually.',
    INCOMPLETE_BALLOT: 'Every position still needs to be assigned.',
    DUPLICATE_POSITION: 'Each position can be used only once.',
    UNKNOWN_PAIR: 'One of the pairs does not belong to this group.',
    MISSING_PAIR: 'One of the group’s pairs is missing from the ballot.',
    ALREADY_VOTED: 'You have already voted in this group.',
    VOTING_CLOSED: 'Voting has closed.',
    RESULTS_HIDDEN: 'Vote to see the results.',
    NETWORK_ERROR: 'Could not reach the server.',
  },
};
