# First-use ballot timing (SC-002, T099)

**Status**: ⏳ **not yet run.** This one cannot be automated or simulated: it needs two people who
have not seen the site.

## What SC-002 asks

A first-time visitor, on a phone, reaches a submitted ballot in **under 60 seconds (median)**.

## Protocol

1. Deploy to a reachable URL and publish a tournament with at least one group.
2. Recruit two people who have never seen the site. Hand them a phone with the link already open in a
   fresh browser profile — a fresh profile matters, or the voter cookie makes them a returning voter
   and the flow under test is not the one being timed.
3. Say only: "vote on how you think this group will finish". No instructions beyond that; the copy on
   the page is part of what is being tested.
4. Start timing at first paint. Stop when the ballot is accepted and the results appear.
5. Record the time, and every hesitation — which control they reached for first, whether the position
   buttons read as buttons, whether they looked for a drag handle.

## Record here

| Participant | Device | Time to submitted ballot | Where they hesitated |
|-------------|--------|--------------------------|----------------------|
| | | | |
| | | | |

**Median**: _to fill in_

## If the median exceeds 60 seconds

Fix the step that cost the time rather than trimming copy generally. The interaction was built as
one tap per position with no drag gesture precisely because drag is the least reliable interaction on
a small screen (research D8) — if the timing fails, the first suspects are the instruction line and
whether the position buttons look tappable, not the number of steps.
