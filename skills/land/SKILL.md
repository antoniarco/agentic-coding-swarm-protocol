---
name: land
description: Integrates the current worktree branch into the integration branch with the repo's land command (default pnpm land - rebase, ADR numbering, full verify inside a lock, fast-forward, publish) and handles every failure it can report. Use when the user asks to land, integrate, merge or ship finished work, or when land failed with a conflict, a held lock, foreign commits, a red verify or a failed push.
disable-model-invocation: true
argument-hint: "[--squash \"<message>\"] [--no-push] [--override-findings \"<reason>\"]"
allowed-tools: Bash(pnpm land) Bash(pnpm land *) Bash(pnpm wt:commit *) Bash(pnpm wt:status *) Bash(pnpm verify *) Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git rebase *) Bash(git add *) Bash(uptime) Bash(gh pr create *) Bash(gh pr merge * --auto*) Bash(node *pr-review-gate.ts *)
---

# land

Say at the start: "Using land to integrate <branch>."

**Resolve the commands first.** Read `swarm.json` at the repo root: `{land}`, `{commit}`, `{verify}` and
`{verifyQuick}` are its `commands.*` keys. Only when the file or a key is missing, fall back to `pnpm land`,
`pnpm wt:commit`, `pnpm verify` and `pnpm verify --quick`. Contract: [INTEGRATION.md](../../INTEGRATION.md). `main`
below stands for `integrationBranch` from the manifest. If `swarm.json` says `"level"` below 2, or it is missing and the fallback
command does not exist, the repo has no land tooling: say so and integrate the way its `CLAUDE.md` says. Teams that integrate through pull requests run land in PR mode: the
same steps up to the quick verify, then a PR with auto-merge. **PR mode** below says how reviews gate that merge.

## The gate

The integration branch moves **only** through `{land}`: serialized by a lock, rebased, fully verified, then
fast-forwarded. You never `git merge`, `git push` or `--no-verify` to it, never resolve a conflict anywhere except
on your own branch, and never delete the lock or stop another session's land. `land` and the `pre-push` hook enforce
most of this; the rest is on you.

Why: every manual shortcut here has an incident behind it (chapter 11): two publishing clones produced two
histories for six days (405 commits); conflicts resolved without the author's context broke working code.

## Before you run it

Copy this checklist and tick it:

```
- [ ] In a linked worktree on its own branch (not the main checkout, not detached)
- [ ] Nothing uncommitted; no stray `wip:` commit (or I will pass --squash)
- [ ] Full {verify} green on this tip (land reruns it, but a known red should not hold the lock)
- [ ] Docs updated in the same change; draft ADR if a contract, invariant or formula changed
- [ ] Non-trivial change reviewed (`review` skill); no open high-severity security finding
- [ ] Product decisions I took alone are `Assumption: <what> — <why>` trailers in the commit
```

## Steps

1. `git status --short`. If dirty: `{commit} "<what changes and why>"` (it absorbs the Stop hook's `wip:`).
2. `{land} $ARGUMENTS`. It runs the full suite inside the lock (one measured land: 214 s, 204 of them tests): give
   it a 10-minute timeout or run it in the background and wait.
3. Read the last line and branch:

   | Output starts with | Meaning | Do |
   | --- | --- | --- |
   | `✓ N commit(s) of <branch> on main` | landed and published | **Report** |
   | `✗ land: another pnpm land is running` | the lock is held by a live land | wait for it and retry; never delete the lock (a dead pid is cleared automatically) |
   | `✗ land: conflict while rebasing onto main` | your branch and main touch the same lines; the rebase was aborted | **Conflict** below |
   | `✗ land: … open HIGH finding(s) past the SLA` or `… the last N lands closed nothing` | the findings gates: fix or close a finding with a `Closes: <id>` trailer (or a `refactor:` commit) | **findings gates** in [failures.md](failures.md); `--override-findings` only with the human's agreement |
   | `✗ land: origin/main has N commit(s) that main lacks` | two histories: someone published from another clone | stop; report the listed commits to the human; do not pull, merge or rebase onto `origin/main` |
   | `✗ land: verification failed: main was not touched` | red inside the lock | `verify` skill on your branch; under load, rerun the failing files and queue the land |
   | `✗ main integrated locally but NOT published` | the push failed after the fast-forward | read the reason; a `pre-push` rejection means this clone is not the publisher: tell the human. Never force or `--no-verify` |

   Every other message (`.env` in the worktree, `wip` commits, no network, main moved three times, could not
   advance main) is in [failures.md](failures.md) with its action. Messages are those of the reference
   implementation; an adapted land prints the same cases in its own words.

4. **Conflict.** On your branch, in your worktree:
   1. `git rebase main`; for each conflicted file, read what the other side changed
      (`git log -p main -- <file>`, newest commits first) before editing.
   2. Keep both intents. Never take `--ours` or `--theirs` for a whole file you did not write.
   3. `git add <file>`, `git rebase --continue`, then `{verifyQuick}`.
   4. `{land}` again.
   If the other side's logic is not yours and you cannot tell what it needs, stop and ask the human with the
   decision card (Context, Challenge, Concern, Recommendation, Impact, Reversible, Evidence).

5. Several branches to land: one at a time, never in parallel.

## PR mode: reviews you cannot time

Copilot, another bot or a person may comment minutes or days after the PR opens. Never wait for them in the session
(no `sleep`, no polling): the `review-gate` required status (template `templates/github/workflows/review-gate.yml`,
script `pr-review-gate.ts`) holds auto-merge until every requested reviewer answered and no thread is open.

1. Open the PR with the reviewers requested (`--reviewer <people>`, and Copilot by ruleset or by hand): a request
   nobody made is nothing to wait for, and the gate stays `pending` with "no reviewer requested".
2. Enable auto-merge, report the PR link and the gate's current line (`node scripts/dev/pr-review-gate.ts check
   --pr <n>`), and end the session. Do not report "landed": report "PR open, auto-merge on, review-gate pending".
3. When the gate goes red (unresolved threads, changes requested), a new session handles each thread with the
   `review` skill's **Pull request threads** step, pushes, and the gate re-evaluates itself.
4. A requested bot that does not answer within `review.pr.botTimeoutHours` (default 2) stops blocking; a person
   blocks until they answer or the request is removed by a person.
5. Reviews left after the merge land in a `post-merge-review` issue: triage them into the findings ledger
   (`findings add --source review`) and close the issue.

## Red flags

| Thought | Reality |
| --- | --- |
| "The conflict is trivial; I will fix it in the main checkout." | Nobody works in the main checkout. Rebase on your branch. |
| "I will merge main into my branch." | Rebase, not merge: land fast-forwards only, and the history stays linear. |
| "origin has a few extra commits; a pull fixes it." | That is the two-histories incident. Stop and tell the human. |
| "The land seems stuck; I will delete the lock." | A live pid holds it. Wait. Stale locks clear themselves. |
| "Two lands in parallel will be faster." | They serialize on the lock anyway, and under load both go red. |
| "Verify failed on a test I did not touch; retry until green." | Classify it with the `verify` skill first. |
| "The push was rejected; `--force` or `--no-verify`." | The hook protects the single publisher. Ask the human. |
| "Copilot has not commented yet; I will wait a few minutes and merge." | The gate waits, not you. End the session; the status check holds the merge. |
| "That bot comment is noise; I will resolve the thread silently." | Reply with the reason, then resolve. A thread closed without an answer is a dismissed finding with no record. |
| "The `.env` is in the way; delete it." | It may hold someone's credentials. Tell the human; spend happens only from the main checkout. |

## Report

```
land: ✓ 3 commit(s) of worktree-billing-rounding on main (a1b2c3d, published to origin, 231s, 1 attempt(s))
ADRs: draft-invoice-rounding → 0042
Notes: <conflicts resolved and how, retries and why, or "none">
Commands: swarm.json | fallback pnpm defaults (no swarm.json)
```

On failure, report the `✗ land:` line verbatim, the class from the table and the next action. Never say "landed"
without the `✓` line.

Depth: [failures.md](failures.md) (every message), [chapter 03](../../manual/03-integration-land.md) (how land works),
[chapter 01](../../manual/01-sessions-and-worktrees.md) (single workstation).
