/**
 * Ballot-path load test at 3× expected peak (SC-009, T095).
 *
 * Run with k6 against a DEPLOYED environment — never against production with real tournaments, since
 * every iteration casts a real ballot:
 *
 *   k6 run -e BASE_URL=https://staging.example -e SLUG=torneio-de-carga tools/loadtest/vote.js
 *
 * ## What "3× peak" means here
 *
 * Expected peak is the minutes just before a tournament starts, when a WhatsApp link goes round a
 * club of roughly 100 people. Assume 100 voters arriving inside two minutes, each loading the page
 * and casting one ballot per group: ~1 request/second sustained, bursting to ~5.
 *
 * 3× that is 15 requests/second sustained for two minutes, which is what `stages` below describes.
 * The number is small in absolute terms and deliberately stated rather than inflated: designing for
 * a load this product will never see would be the kind of speculative generality Principle V refuses.
 *
 * ## What it asserts
 *
 * Each virtual user gets its own cookie jar, so each is a distinct device casting its one ballot
 * (FR-013). The pass criteria are the ones SC-009 names: no 5xx, and the ballot write stays under
 * 500 ms at p95 while the aggregate is being read concurrently.
 */
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const SLUG = __ENV.SLUG;

export const options = {
  stages: [
    { duration: '30s', target: 15 },
    { duration: '2m', target: 15 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // A failed ballot is a lost vote; the budget is deliberately tight.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:cast-ballot}': ['p(95)<500'],
    'http_req_duration{name:tournament-detail}': ['p(95)<400'],
  },
};

export function setup() {
  if (!BASE_URL || !SLUG) fail('BASE_URL and SLUG are required.');
  const response = http.get(`${BASE_URL}/api/v1/tournaments/${SLUG}`);
  if (response.status !== 200) fail(`Tournament ${SLUG} is not reachable: ${response.status}`);

  const tournament = response.json();
  const groups = tournament.groups.map((group) => ({
    id: group.id,
    pairIds: group.pairs.map((pair) => pair.id),
    votingOpen: group.votingOpen,
  }));
  const open = groups.filter((group) => group.votingOpen);
  if (open.length === 0) fail(`Tournament ${SLUG} has no open group; the ballot path is closed.`);
  return { groups: open };
}

export default function run(data) {
  // Each VU is a fresh device: no cookie is carried in, so each casts its own single ballot.
  const jar = http.cookieJar();
  void jar;

  const detail = http.get(`${BASE_URL}/api/v1/tournaments/${SLUG}`, {
    tags: { name: 'tournament-detail' },
  });
  check(detail, {
    'detail is 200': (response) => response.status === 200,
    // The un-voted payload must carry no aggregate, under load as much as at rest (SC-006).
    'detail leaks no aggregate': (response) => !response.body.includes('positionShares'),
  });

  const group = data.groups[Math.floor(Math.random() * data.groups.length)];
  const ordering = group.pairIds.map((pairId, index) => ({ pairId, position: index + 1 }));

  const ballot = http.post(
    `${BASE_URL}/api/v1/groups/${group.id}/ballots`,
    JSON.stringify({ ordering }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'cast-ballot' } },
  );

  check(ballot, {
    // 201 for a first ballot, 409 if this VU's jar already voted, 429 if the limiter engaged.
    // All three are correct answers; a 5xx is not.
    'ballot answered without a server error': (response) => response.status < 500,
    'ballot returns results when accepted': (response) =>
      response.status !== 201 || response.body.includes('standings'),
  });
}
