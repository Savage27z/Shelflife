# Demo video script and submission post

Working notes, not part of the deliverable. Target length **90 seconds**, hard ceiling 2 minutes.

NEAR's own guidance for the demo post: open with the user problem, show one complete moment from a
real action to a visible result, skip long intros and architecture slides, say concretely what NEAR
enables, and end with a next step.

## Before recording

```bash
npm install          # also builds
npm run report       # make sure report/index.html is current
```

Terminal at a large font, dark theme, window cropped tight. Nothing else on screen — no editor, no
browser tabs with the plan in them.

---

## Beat 1 — the problem (0:00–0:15)

**Show:** nothing yet, or NearBlocks open on a contract page.

> "When you use a smart contract, you're trusting code you've never read. Projects publish their
> source on GitHub and say *this is what's running*. Almost nobody checks whether that's true.
> On NEAR, you can check — and I did, for the whole chain."

Don't say "blockchain", "Web3", "trustless", or the project name yet. The problem has to land for
someone who doesn't care about crypto.

## Beat 2 — one complete moment (0:15–0:45)

**Show:** type this live. It takes about three seconds.

```bash
node dist/bin.js devhub.near
```

> "This is NEAR's own DevHub contract. It *was* verified — the source was published and checked.
> Then it was redeployed."

**Point at the two hashes on screen.**

> "The record says this hash. The chain is running that one. Nothing re-checks it, so explorers
> still show it as verified. The source you'd read describes code that isn't running any more."

This is the whole project in one screen. Don't rush it — let the two hashes sit there.

## Beat 3 — the scale (0:45–1:15)

**Show:** `report/index.html` in a browser, scrolling slowly through findings 1 and 2.

> "Across all of NEAR mainnet, 105 contracts have ever been verified. Forty-two of them have
> redeployed since. So the real number — contracts whose verification matches the code running
> today — is fifty-four. On the whole chain."

**Scroll to finding 3.**

> "And of ordinary token contracts, only one in five publishes a source link you can actually
> follow. A third of the rest are just copies of each other."

Say "fifty-four, on the whole chain" slowly. That's the line people remember.

## Beat 4 — what you can do with it (1:15–1:35)

**Show:** terminal.

```bash
node dist/bin.js wrap.near || echo "no source published"
```

> "It exits non-zero when there's no source, so you can fail your own build when something you
> depend on goes dark. And if it's your contract, two commands fix it."

## Beat 5 — close (1:35–1:50)

> "Every number is computed from free public RPC reads. The datasets are in the repo, so you can
> re-run it and get the same answers — or point it at your own contract right now."

**Show:** the repo URL on screen.

---

## What to say about NEAR specifically

Not "built on NEAR". The concrete version:

> "This only works because NEAR has an on-chain verification registry you can read directly, and
> a standard for contracts to publish their own source. I'm not scraping an explorer — I'm reading
> `v2-verifier.sourcescan.near` and calling `contract_source_metadata` on every contract. The
> ecosystem already built the plumbing. Nobody had measured whether it was being used."

## Do not say

- "Audit" — this is coverage measurement, not a security audit
- Any phrasing implying a named project is dishonest. Contracts without source are *unverifiable*,
  not dishonest
- "Verified" to mean "we rebuilt it". Nothing has been rebuilt yet, and the README says so

---

## X post draft

Must say it was built at NEAR HACKATHON, tag **@NEARProtocol** and **#NEARHackathon**, and attach
the video.

> Across all of NEAR mainnet, 105 contracts have ever had their source verified.
>
> 42 of them have redeployed since — so their "verified" badge describes code that no longer
> exists.
>
> 54. That's how many contracts on the whole chain have a verification record matching what's
> running today.
>
> I built Shelflife at NEAR HACKATHON to measure it. It reads the on-chain registry directly and
> checks every contract's published source metadata — all free public RPC reads, no API keys. The
> datasets are committed, so you can re-run it and get the same numbers.
>
> Point it at your own contract:
> `node dist/bin.js <account.near>`
>
> Repo: <link>
>
> Did I get the methodology wrong anywhere? The traps I hit are documented in the README — I'd
> rather someone found a third one.
>
> @NEARProtocol #NEARHackathon

Ending on a real question rather than "check it out" follows the organisers' own advice, and it is
a genuine ask: a methodology error found now is better than one found by a judge.

## Submission form

- **Tracks:** Open Innovation (primary), Investment Thesis (the value-weighting in finding 4)
- **Team size:** solo
- **Payout:** NEAR **mainnet** address
- **Repo:** public, stays public through judging
- **Deadline:** 14 Nov 2026, 23:59 UTC — submit the morning of the 14th, not the evening
