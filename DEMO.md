# Demo video script and submission post

Working notes, not part of the deliverable. Target **90 seconds**, hard ceiling 2 minutes.

NEAR's own guidance for the demo post: open with the user problem, show one complete moment from a
real action to a visible result, skip long intros and architecture slides, say concretely what NEAR
enables, and end with a next step.

## The one thing to land

> **Only 6 of 168 token contracts publish source that anyone could rebuild.**

Every other number is support for that sentence. If a viewer remembers one thing, it is that one.

## Before recording

```bash
npm install
npm run report
npm test
```

**Re-check the live demo cases the morning you record.** They read the live chain, and an owner can
fix their contract at any time, which would quietly delete your example:

```bash
node dist/bin.js initiate.nearlegion.near   # still a <xxx>/<xxx> placeholder?
node dist/bin.js token.sweat                # still pinned, resolving, SourceScan-matched?
node dist/bin.js wrap.near                  # still nothing published?
```

If `initiate.nearlegion.near` has been fixed, good for them, and use a backup: `itlx.intellex_xyz.near`
(has a SourceScan record, but its GitHub repo returns 404 — note SourceScan stores source on IPFS, so
say the *repository* is gone, not that the source is unreadable) or `e85f23b81ab3edbdf4c0e5fd889eed50cc2bd465c57c67b71105741ac1b8ceda`
(verified once, redeployed, publishes nothing).

Terminal at a large font, dark theme, window cropped tight. Nothing else on screen.

---

## Beat 1 — the problem (0:00–0:15)

**Show:** nothing yet, or a contract page on an explorer.

> "A smart contract runs code you've never read. Projects publish a link to the source and say *read
> it*. But does the link go anywhere? Is it tied to the version that's actually running? I measured
> that across NEAR."

Don't say "blockchain", "Web3" or "trustless". The problem has to land for someone who doesn't care
about crypto.

## Beat 2 — one complete moment (0:15–0:50)

**Show:** type these live. Three seconds each.

```bash
node dist/bin.js initiate.nearlegion.near
```

> "This contract publishes a source link. Look at it."

**Pause on `https://github.com/<xxx>/<xxx>`.**

> "It's a template placeholder. Nobody ever filled it in. That counts as 'publishes source' in most
> measurements."

```bash
node dist/bin.js token.sweat
```

> "And this is what good looks like. The link is pinned to a specific commit, the repository
> resolves, and SourceScan has a record that matches the code that's deployed."

This pair is the whole project: the same field, one empty, one meaningful. Let both screens sit.

## Beat 3 — the scale (0:50–1:20)

**Show:** `report/index.html`, scrolling slowly through the funnel table in finding 1.

> "Of a hundred and sixty-eight token contracts: fifty-three expose source metadata. Thirty-four
> carry a link. Twenty-eight of those point at a repository that exists. And only **six** are pinned
> to a commit — the minimum you'd need to actually rebuild the code and check it."

**Scroll to finding 2.**

> "SourceScan's two registries hold a hundred and twelve verifications ever. Sixty-four still match
> what's deployed. Of the twenty-nine that don't, twenty-seven now publish their own link — so the
> registry is being replaced by on-chain metadata, not abandoned."

Say "six" slowly. That is the line people remember.

## Beat 4 — honesty (1:20–1:40)

> "I got two of my own headline numbers wrong building this. NEAR has a feature called global
> contracts that reports an empty code hash — my scanner was throwing those accounts away. A review of my
> own claims caught it, and the corrections are listed in the README. Everything reproduces: clone it, run the
> tests, run the checker."

**Show:** the Corrections section of the README, briefly, then `npm test` passing.

This beat is not filler. It is the strongest evidence the other numbers can be trusted.

## Beat 5 — use it, and close (1:40–1:55)

**Show:**

```bash
node dist/bin.js wrap.near || echo "no readable source"
```

> "It exits non-zero when there's no readable source, so you can fail your own build when something
> you depend on goes dark. Every number comes from free public reads. The datasets are in the repo.
> Point it at your own contract."

**Show:** the repo URL on screen.

---

## What to say about NEAR specifically

Not "built on NEAR". The concrete version:

> "This works because NEAR lets a contract publish its own source metadata on-chain, and because
> SourceScan keeps its verification registries as contracts I can read directly. I call
> `contract_source_metadata` on every contract and read both registries on-chain — no scraping an
> explorer."

## Do not say

- **"audit"** — this measures what is published. It is not a security audit
- Anything implying a named project is dishonest. A contract with no source is *unverifiable*, not
  dishonest
- **"verified"** to mean rebuilt. Nothing has been rebuilt. Say *rebuildable*
- **"the whole chain"**. The registry counts are complete for two SourceScan registries; the contract
  sample is 168 token contracts, not the chain
- **"random"** or "unbiased" about the sample. It follows the indexer's order
- **"explorers still show it as verified"** — never checked, and removed from the README
- Any of the old numbers: **54, 42, 40%, 105 "complete", 20%**. All were wrong or misleading

---

## X post draft

Must say it was built at NEAR HACKATHON, tag **@NEARProtocol** and **#NEARHackathon**, and attach the
video. If you are not on a plan that allows long posts, use this as a thread. **Post 1 is the one that
carries the video and the tags.**

**Post 1**
> Only 6 of 168 NEAR token contracts I checked publish source anyone could rebuild: a link that
> resolves AND is pinned to a commit.
>
> Built Shelflife at NEAR HACKATHON to measure it.
>
> @NEARProtocol #NEARHackathon

**Post 2**
> The funnel:
> 168 contracts
> 53 expose source metadata
> 34 carry a link
> 28 point at a repo that exists (one "source" is literally github.com/<xxx>/<xxx>)
> 6 are pinned to a commit
>
> A link is not source. A repo is not a version.

**Post 3**
> SourceScan's registries hold 112 verifications ever. 64 still match what's deployed. Of the 29 that
> don't, 27 now publish their own link, so the registry is being superseded, not abandoned.
>
> I also had two headline numbers wrong along the way — the corrections are in the README.
>
> Check your own contract: `node dist/bin.js <account.near>`
> https://github.com/Savage27z/Shelflife
>
> Is the methodology wrong anywhere?

Ending on a real question follows the organisers' advice, and it is a genuine ask: a mistake found
now is better than one found by a judge.

## Submission form

- **Tracks:** **Open Innovation** only. I would not tick Investment Thesis: finding 3 is a custody
  floor dominated by one account (`wrap.near`, 90%), not a thesis about NEAR, and a judge in that
  track would be right to say so. Ticking a track the project does not fit costs more than it earns
- **Team size:** solo
- **Payout:** a NEAR **mainnet** address
- **Repo:** public, and it stays public through judging
- **Deadline:** 14 Nov 2026, 23:59 UTC. Submit the morning of the 14th, not the evening

**Description (20–2,000 characters):**

> Shelflife measures how much NEAR contract source anyone can actually check. A contract can publish
> a source link in its NEP-330 metadata, but a link is not source: it can be a template placeholder,
> point at a repository that no longer exists, or name a repo front page rather than a commit. Of 168
> token contracts, 53 expose metadata, 34 carry a link, 28 point at a repository that resolves, and
> only 6 are pinned to a commit — the minimum needed to rebuild the code and compare it with what is
> deployed. It also reads both of SourceScan's on-chain registries: 112 verifications ever, 64 still
> matching the deployed code, and of the 29 that do not, 27 now publish their own link. A checker
> (`node dist/bin.js <account>`) gives any contract a verdict with CI exit codes. Everything runs on
> free public reads with no keys; the datasets are committed; 85 tests, mutation-tested. Nothing is
> rebuilt yet, and the README says so, along with every correction made after a review of the
> project's own claims.
