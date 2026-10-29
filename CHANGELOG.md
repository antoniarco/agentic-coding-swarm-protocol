# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Proposal: a human-gated profile (`proposals/human-gated-profile.md`).** An adopter where a person commits and a
  person merges lists, with evidence, the defaults that commit, merge or guess commands on their own (the `Stop`-hook
  `wip`, PR mode with auto-merge, `audit-repo` landing its report, `gateEdit: warn`, unpinned install, the `pnpm`
  fallback) and proposes one pull request per change, each with its self-test or eval. Documentation only.

- **Leases (`leases`).** Parallel sessions learned about each other only at `land`, when the second branch hit the
  first one's change. `reference/scripts/leases.ts` keeps one reservation per session branch that expires on its own
  (`ttlMinutes`, renewed by the `Stop` hook; a removed worktree holds nothing), so a dead session never blocks anyone.
  Shared leases (every file a session touches) inform: the first time a session edits a file another live lease
  covers, its agent is told who and why. Exclusive zones (`leases.exclusive`: migrations, schemas, contracts, shared
  types) are held by the first live session that edits or claims them; another branch's edit there is refused with the
  holder and its expiry. Zones are taken with `wx` and dead claims with an atomic rename, the list is read from the
  integration branch (a branch cannot relax it), `land` releases the branch's leases after a green integration, and a
  human can `break` a zone with a logged reason. Self-tests in `reference/self-test/leases.test.ts`; the hook in
  `scripts/swarm-hook-pre-edit.test.mjs`.

- **Version coherence check.** `scripts/check-version.mjs` (a `validate` CI step, with its self-test in
  `scripts/check-version.test.mjs`) fails when `.claude-plugin/plugin.json`, `templates/swarm.json`, the first
  released `CHANGELOG.md` entry, the `README.md` Status line or the `INTEGRATION.md` examples disagree. A project
  does not need to act.

- **The gate hook can ask or block (`hooks.gateEdit`).** `swarm.json` accepts `hooks.gateEdit`: `warn` (default,
  today's behavior), `ask` (the person approves the edit) or `block` (the edit is denied with its reason) when an
  agent edits a quality-gate file. The hook answers with the `PreToolUse` permission decision and still exits 0.
  Self-test: `scripts/swarm-hook.test.mjs`. A project does not need to act; set `ask` or `block` to stop gate edits
  before `land` instead of at `land`.

- **Python, command by command (INTEGRATION.md §4).** A full mapping for Python projects that keep the Node
  reference scripts: uv for setup and the lockfile, Ruff, pyright, pytest with pytest-cov and Hypothesis,
  import-linter, the coverage.py → `coverage-summary.json` conversion the coverage ratchet reads, Ruff rules in place
  of the `silentErrors` scanner, pip-audit over `uv export` as `deps.command`, the mutation smoke with pytest and
  mutmut for scheduled runs. Documentation only.

- **"Verify against your plan" (manual chapter 16 §0).** Scenarios B, D and E depend on the merge queue, branch
  protection or rulesets and, with provenance, artifact attestations, whose availability depends on the GitHub
  plan and on the repository being private. The manual now says to check it and gives the fallback for each missing
  feature (serial local `land` with a person merging the verified branch; local guards labelled as `preference`; no
  provenance claims). `skills/adopt/levels.md` and `reference/README.md` point to it. Documentation only.

- **Early overlap detection (`overlap`).** Worktrees isolate files, not work: two sessions can make incompatible
  changes, both stay green, and the collision only appears at the second `land`, after both spent their tokens and a
  full verify. `reference/scripts/overlap.ts` reports, read-only, which active session branches touch the same files,
  which pairs `git merge-tree --write-tree` predicts will conflict, and which branches the integration branch moved
  under (files it changed that the branch also touches, with the rebase conflict predicted). It runs after `wt setup`
  (`--session`: the other live sessions and their areas), after edits through a new `PostToolUse` plugin hook
  (`--notify`: throttled, and only when the overlap changed, as `additionalContext`), and on demand (`--all`,
  `--json`, `--strict`). Self-tests in `reference/self-test/overlap.test.ts`; the hook in
  `scripts/swarm-hook-post-edit.test.mjs`.

### Changed

- The plugin's `PreToolUse` (Edit/Write) hook runs `hooks.preEdit` from `swarm.json` after the quality-gate warning,
  with the hook JSON on stdin, and passes its stdout back. Its exit 2 is passed on and refuses the edit: the one
  deliberate exception to "a hook always exits 0", documented in INTEGRATION.md §3. Any other failure is ignored. The
  hook timeout goes from 5 to 10 seconds.
- `templates/swarm.json` gains a `leases` block and `commands.leases`, runs `leases session` after `wt setup`, `leases
  renew --hook` after `wt wip`, and `leases check` as `hooks.preEdit`; `templates/claude/settings.no-plugin.json`
  wires the same. The `worktree` skill declares a plan with `claim` and treats a refused edit as a stop, never as
  something to route around. Chapter 01 explains shared leases and exclusive zones.
- **Evals pin a full model ID.** The `evals` workflow defaults to `claude-sonnet-5-5` instead of the `sonnet` alias,
  as its own input description asked: an alias moves when a model ships, so an eval regression could not be
  attributed. The shipped agents keep the aliases, which resolve on every provider (Amazon Bedrock and Google Cloud
  use different full IDs); manual chapter 08 explains how to pin them per project.
- The quality-gate hook and `hooks.preEdit` share the `PreToolUse` hook: a gate edit answered with `ask` or `deny`
  (`hooks.gateEdit`) returns that decision alone; every other edit then runs `hooks.preEdit` as above.
- The plugin ships a fourth hook, `PostToolUse` on Edit/Write, which runs `hooks.postEdit` from `swarm.json` with the
  hook JSON on stdin and returns its stdout (INTEGRATION.md §1–§3). Still exit 0 always; a no-op without the key.
- `templates/swarm.json` and `templates/claude/settings.no-plugin.json` wire `overlap --session` after `wt setup` and
  `overlap --notify` as `hooks.postEdit`; `commands.overlap` is a new optional key. The `worktree` skill reads the
  notices; chapter 01 explains the three findings and what they cannot see.

### Fixed

- `README.md` Status said `v0.3` while the plugin was 0.4.0.
- The gate hook's glob loop parses under bash 3.2 (macOS `/bin/sh`): a `case` inside `$(...)` uses the `(pattern)`
  form, or the hook would fail with a syntax error and exit 2, refusing every edit.

### Migration

Nothing breaks: no conformance check changes, and without `hooks.preEdit`, `hooks.postEdit` or `hooks.gateEdit` the
hooks behave as before. **Leases:** copy `reference/scripts/leases.ts` to `scripts/dev/`, add the `leases` block (start with one or two exclusive
zones), `commands.leases` and `hooks.preEdit`, and append the `session` and `renew --hook` calls to
`hooks.sessionStart` and `hooks.stop`. `land.ts` releases leases after a green land; copy it too, or leases expire after
`ttlMinutes`.

**Overlap:** copy `reference/scripts/overlap.ts` to `scripts/dev/`, add
`commands.overlap` and `hooks.postEdit`, and append `; node scripts/dev/overlap.ts --session` to `hooks.sessionStart`.
Conflict prediction needs git 2.38 or later; with an older git it reports shared files only and says so.

## [0.4.0] — 2026-10-28

An independent code analysis of the reference project, run on the same day as the 0.3.1 audit, found that detection
was no longer the bottleneck: about 20 of the 32 High and Medium findings of the latest audit had already been
reported two weeks earlier and were still open, 2 of 769 commits were refactors, 192 empty `catch {}` hid failures,
a critical dependency advisory had a one-line fix and no owner, and 75 changes were active with 19 never started.
This release turns closing into a gate: findings get a ledger with an SLA and `land` refuses work that does not
close them while a High is overdue. It also closes the four detection gaps the analysis exposed (silent errors,
vulnerable dependencies, tests that cannot fail, and unformatted code) and adds the concurrency knowledge the
reference project lacked.

### Added

- **Findings ledger with SLA (L2.8).** `docs/audits/findings.jsonl` holds one line per finding (`id`, severity,
  `opened`, `owner`, `sla_due`, status); `scripts/dev/findings.ts` adds, closes, accepts, lists and checks it and
  prints the closure statistics (open by severity, median age, closed/opened ratio, overdue). `audit.ts` seeds it from
  the audit report (`--findings`) and summarises it at the top of the metrics table; the audit also lists the hot files
  (most fixes per file).
- **Closure gate in `land` (L2.9).** With an overdue HIGH open, `land` refuses a change that does not carry
  `Closes: <id>` in a commit message (or `--override-findings`, which the land log records); every
  `findings.closureEvery` lands (default 3) one must close a finding; a landed `Closes:` closes the finding in the
  ledger on the integration branch. `findings.sla` defaults: HIGH 2 days, MEDIUM 14, LOW 60.
- **Silent-error ratchet (L1.9).** `quality-ratchets.json` gains `silentErrors` (`dirs`, `exceptions`, `total`): a
  `catch` that neither throws, nor calls anything, nor uses its binding, or a `.catch(() => <literal>)`, counts; the
  total only goes down, `verify --quick` checks the changed files (`ratchets.ts --silent-only`) and the architecture
  test template adds a "no silent catch" rule.
- **Dependency gate (L1.7).** `scripts/dev/deps-audit.ts` normalises `npm`/`pnpm audit`, `pip-audit`, `cargo audit`
  and generic JSON reports; advisories at `deps.failOn` severities (default critical, high) block unless
  `deps-allowlist.json` has an unexpired entry with reason and owner. `deps` is a serial step of the full tier and a
  CI step.
- **Formatter step (L1.8).** `format` runs in both verify tiers (`format.check` on the repo, `format.quickCheck` on
  the changed files); the Biome reference config enables the formatter; manual 07 explains turning it on in one
  logic-free commit with `.git-blame-ignore-revs`.
- **Mutation smoke (L2.10).** `scripts/dev/mutation-smoke.ts` mutates the files a change touched (`>=`, `<=`, `===`,
  `&&`/`||`, early `return`) and runs their related tests; all mutants surviving, or no related test, means the change
  is not proven. It is a smoke, not mutation testing; `mode: warn` first, `fail` once the survivors are fixed.
- **WIP limit (L3.6).** `roadmap.ts` fails above `roadmap.maxActive` (default 12) active changes and on changes with
  no task ticked for `roadmap.staleDays` (default 14) unless the proposal carries `parked: <reason>`; the `change`
  skill checks the limit before proposing.
- **Concurrency knowledge.** Manual 17 §16 (state transitions need compare-and-swap: `appendIf`, shared reservations,
  recovery by run id); three defect classes (DC-CONC-01, DC-CONC-02, DC-RUN-06; 49 in total) plus DC rows for silent
  catches and vulnerable dependencies; a required two-callers check in `test-auditor`, a concurrency paragraph in
  `reviewer`, manual 04 "Tests that prove behaviour", manual 06 "Work in progress has a limit".

### Changed

- `INTEGRATION.md` §1 documents `findings`, `format`, `deps`, `mutation` and `roadmap` config; §2 lists the five new
  guarantees; §6 gains L1.7, L1.8, L1.9, L2.8, L2.9, L2.10 and L3.6, and `scripts/check-conformance.mjs` checks the
  mechanical ones.
- `templates/github/workflows/ci.yml` runs the formatter, the dependency gate and the ratchets.
- `MAINTAINING.md`: the release checklist measures closure (open findings, median age, closed/opened) on the
  reference project, not only detection.

### Migration

New checks join levels 1, 2 and 3, so a project that passed `--check` on 0.3.x fails it on 0.4.0 until these steps
are done (each is one `/swarm:adopt` step; the `adopt` skill's `levels.md` has the details):

- Level 1: copy `templates/deps-allowlist.json` and `reference/scripts/deps-audit.ts`, set `deps.command`, add the
  `deps` step (L1.7); turn the formatter on in one logic-free commit and add the `format` step to both tiers (L1.8);
  run `ratchets.ts --init` to record `silentErrors` and add `--silent-only` to the quick tier (L1.9).
- Level 2: copy `reference/scripts/findings.ts`, set `commands.findings` and the `findings` block, seed the ledger
  from the latest audit with an owner on every open HIGH (L2.8, L2.9); copy `mutation-smoke.ts` and add it as a
  warn-mode serial step after the tests (L2.10). The next `land` enforces the SLA gate: an overdue HIGH blocks a
  change that does not carry `Closes: <id>`. Pre-0.4 land-log entries are ignored by the closure quota.
- Level 3: add the `roadmap` block (`maxActive`, `staleDays`); if the project is above the limit, triage with the
  user before anything else (L3.6).

`swarm.json` `version` → `0.4.0`. The audit skill's report now opens with a closure block and the `--check` output
with a `closure:` headline once the ledger exists.

## [0.3.1] — 2026-10-28

A fresh-eyes audit of 0.3.0 and a pilot adoption on a Python repository without the plugin (a non-Claude agent
following the skills by hand) found three High findings, six Medium and sixteen points of friction. This release
fixes them. The audit and pilot method is now part of the release checklist in `MAINTAINING.md`.

### Fixed

- **Ratchets could be loosened by hand** (`max: 500 → 5000`, a new exception, a higher budget) and `verify` and
  `land` accepted it. `ratchets check` now loads the baseline from the merge base with the integration branch and
  fails on any loosening ("quality-ratchets.json loosened vs <integration>: <what>; ratchets only tighten");
  `--tighten` output always passes it. `quality-ratchets.json` is a review-gate path again (`swarm.json` sensitive
  globs, the hook's gate warning, `CODEOWNERS`, the reference config).
- **`land` skipped verification on an environment variable** meant for its own tests. `<PREFIX>LAND_VERIFY` is now
  honoured only under `DEV_FLOW_CONFIG`, is otherwise ignored with a message, and when honoured the console line and
  the land-log entry carry `verify: "overridden"`.
- **The review gate read its config from the local integration branch**, so a direct commit on local `main` could
  relax it. `review-receipt` reads `<remote>/<integration>` when that ref exists.
- `review` skill and `reviewer` agent hard-coded `main`; they use `integrationBranch` from `swarm.json`. Stale
  `scripts/` paths corrected to `scripts/dev/` in the review skill and the ratchets template.
- **The new-agent CI judge trusted files the agent had just edited.** `templates/github/workflows/new-agent-test.yml`
  now reads the acceptance command and `commands.verify` from the base commit with `git show "$BASE:…"` and fails the
  verdict if the agent's diff (tracked or untracked) touches `swarm.json`, `docs/handover/`, `.github/` or
  `quality-ratchets.json`. The residual risk (project scripts run with the API key in the environment during the agent
  step) is documented at the top of the file and in chapters 15 and 18: use a dedicated key with a spend cap, rotate
  monthly.
- **Session hooks ran twice with the shipped templates** (the settings template and the plugin both wired them).
  `templates/claude/settings.json` keeps only the gate warning; `templates/claude/settings.no-plugin.json` carries the
  session hooks for agents without the plugin.
- **The gate warning in the settings template needed `jq`** and silently never fired without it; it is `sh` + `sed`
  only now.
- **Levels disagreed**: `commands.ratchets` was optional in §1 and a blocking level-1 check in §6, and the level-2
  steps never added the `review` block they check for. `skills/adopt/levels.md` opens with one table (level → files
  written → check ids); level 1 adds the ratchets step, level 2 the review block, the receipt and the `land` tighten;
  `ADOPTION.md` follows the same table. L1.6 is split (level 1: present, run by verify, never loosened; level 2: land
  tightens) and L2.7 has a PR-mode pass condition (a required CODEOWNERS review with the `reviewer` agent's report
  attached).
- **`(enforced:)` markers that overclaimed** in `templates/CLAUDE.md` (main-checkout rule, secrets, ADR, `x!`,
  `@ts-ignore`): each now cites a mechanism that enforces it or is a `(preference)`. The template is grouped by the
  level that creates each mechanism (`<!-- level 0/1/2 -->`), so a level-0 adopter copies only the level-0 group and
  L0.6 passes; the docs-test template asserts that the architecture, quality and README docs it names exist.
- Pilot friction on a Python repository, all addressed: the coverage-floor rule now matches the ratchet (measured
  minus half the gap); the lint budget is defined per stack (the linter's diagnostics in report-only mode; `budget: 0`
  where the tool has no warning level) with port notes for Python; `templates/adr/README.md` with the generated-index
  markers exists; `.claude/worktrees/` is ignored in one place; the marketplace/`enabledPlugins` JSON is in the
  settings template; non-plugin agents read the version from their checkout of this repo; INTEGRATION §5 says what to
  run when the manifest has no `hooks`; §4 says a wrapper script is required for `verify` and what the Node-or-port
  choice costs; the `tdd` skill has a Vitest / pytest / go test / cargo test table; the level-2 step asks which paths
  are the project's core (a library needs `src/**` or `mode: always`, the backend-shaped defaults matched nothing);
  `adopt` says how to integrate the adoption itself without `land`.

### Changed

- **A review receipt now requires the full review report** (`<patch_id>.md`, at least 200 bytes): the receipt stores
  its sha256 and size, `check` refuses a missing or altered report, and the `review` skill writes the report before
  the receipt. It proves the report exists and is unchanged; the reviewer's independence remains process.
- `audit` reports landed, rebase-conflict and review-bypass counts from the land log since the previous snapshot, so a
  `--no-review` bypass reaches the audit even when the log lives on one machine.
- `templates/github/workflows/weekly-review.yml` opens its PR as a draft and says it must never be auto-merged; every
  workflow template replaces the empty "pin to a SHA" comment with the `gh api … --jq .object.sha` command that
  resolves one.
- "T-checks" wording left from the rename is now "X-checks" everywhere; the `learn` skill says "a temp dir outside the
  repo" instead of a Claude-specific scratchpad.

### Added

- **`scripts/check-conformance.mjs`**: a deterministic checker for every INTEGRATION.md §6 check (L0.1–L3.5,
  X1–X5). It prints ✓/✗/? per id, supports `--json`, `--level N`, `--transfer`, `--all`, reports version drift, and
  exits 0, 1 or 2. 21 checks are mechanical; five need judgement (running verify, timing, running the audit, audit
  age, the hidden-knowledge count) and are printed as `?` with what to verify. `/swarm:adopt --check` runs it first
  and the agent judges only the `?` lines; `level` rises only on exit 0 with every `?` resolved as pass. 22 self-tests
  in CI (`node --test 'scripts/*.test.mjs'`).
- `templates/github/workflows/ci.yml` gains a gitleaks `secrets` job (with its license note), so "never commit
  secrets" has a mechanism; `templates/docs/quality.md` gains the "Anti-patterns" section the `learn` skill cites.
- `MAINTAINING.md` release checklist: a fresh-eyes audit of the repo and a pilot adoption by an agent without the
  plugin before every minor release; both found what the self-tests could not.

## [0.3.0] — 2026-10-28

The theme of this release: every rule the protocol states now has a mechanism, the mechanisms are tested, and a
project can prove that another team could absorb it.

### Added

- **Quality ratchets.** `reference/scripts/ratchets.ts` and `templates/quality-ratchets.json` turn "only goes down"
  rules into checks: no new file over 500 lines and oversized files only shrink; the coverage floor is neither above the
  measured value nor more than `maxGap` below it ("raise the floor to X"); a lint warning budget, total and per rule
  (Biome or ESLint JSON). The full `verify` runs them after the tests and `--quick` checks file size on changed files.
  After a green verify, `land` tightens the file and commits it alone (`chore: tighten quality ratchets`) on top of the
  verified SHA, aborting if that commit touches anything else. Conformance check L1.6, optional `commands.ratchets`,
  and a guarantee row in `INTEGRATION.md` §2. Manual chapter 07 gains a "Ratchets" section.
- **Every rule names its mechanism.** Each rule in `templates/CLAUDE.md` ends with `(enforced: <path>)` or
  `(preference)` (33 rules, 14 preferences). The docs-test templates fail on a rule without a marker or an enforced
  path that does not exist. Conformance check L0.6.
- **Review as a gate (L2.7).** `checklists/defect-classes.md` lists 46 defect classes (`DC-<area>-<nn>`) distilled
  from about 60 findings of two whole-repo audits: symptom in a diff, why it hurts, how to detect it, the fix, and
  whether a diff review can catch it or it needs a whole-repo audit. `reviewer`, `security-reviewer` and
  `test-auditor` check every diff against the diff-catchable classes and cite DC ids; `reviewer` also walks the
  project's invariants table row by row; `quality-auditor` uses the whole catalog and flags findings that slipped past
  review; `builder` self-checks before claiming done. The `review` skill writes a receipt at
  `<git-common-dir>/swarm-reviews/<patch_id>.json`, keyed by `git patch-id --stable` over `<integration>...HEAD`, and
  `land` refuses a change that `review.mode` covers unless that receipt says `pass` with `open_high: 0`. The `review`
  block of `swarm.json` (`mode`: `always` | `sensitive` | `off`, plus `sensitive` globs) is read from the integration
  branch, so a branch cannot relax its own gate. `land --no-review "<reason>"` is the logged escape hatch.
  `reference/scripts/review-receipt.ts` (`write`, `check`) plus self-tests.
- **Detection latency.** Audit findings record `introduced` (from `git log -S`, `git blame` or `git log -L`, or
  "unknown"), `detected` and `catchable_at_review` against the defect catalog. The audit report gains "Detection"
  (median latency, escape rate, trend) and "Rules and mechanisms" (preference count, eroding rules) sections;
  `audit.ts --write --findings <json>` stores them in the snapshot.
- **Self-tests for the reference implementation.** `reference/self-test/` runs `land`, `wt`, `verify`, `adr`,
  `ratchets`, `review-receipt` and `audit` end to end against throw-away git repos (a bare remote, a publisher clone
  with the real `pre-push` hook, a linked worktree) with `node:test` and no dependencies: 57 tests, in a new CI
  `self-test` job on Node 24. They include a regression test for the 0.2.0 land fix (a commit or edit made while
  verify runs never reaches the integration branch; the Stop hook stays silent during a live land) and the race
  where the integration branch moves during verify (land rebases and verifies again).
  `DEV_FLOW_CONFIG=<json>` deep-merges over `dev-flow.config.ts` so the tests (and adopters) can override it.
- **Skill evals.** `evals/` holds 58 cases for `claude plugin eval`: trigger cases (4 positive, 2 negative) for the
  nine core skills and behaviour cases for `verify` (green evidence, red is not done), `review` (dispatches the
  reviewer and security-reviewer on an auth diff) and `tdd` (test written before the fix). `scripts/check-evals.mjs`
  is the free structural check CI runs; a manual `evals` workflow runs the real suite only when an `ANTHROPIC_API_KEY`
  secret exists, with a cost ceiling.
- **Transferability (manual chapter 18, conformance track X1–X5).** Five checks, separate from the levels, that turn
  "another team can absorb this project" into something a command reports: X1 fresh clone (one `commands.setup` from
  a clean clone to a green `verify`, run weekly by `templates/github/workflows/fresh-clone.yml`), X2 new-agent test
  (an agent with no prior context does the reference task on a throwaway branch with turn and budget caps, judged
  deterministically, `templates/github/workflows/new-agent-test.yml`), X3 explicit ownership (`templates/CODEOWNERS`,
  `templates/docs/runbook.md`, `templates/docs/dependencies.md`), X4 no hidden knowledge (counted by the audit),
  X5 handover checklist (`checklists/handover.md`, with a joint session where the receiving team's agent does the
  reference task live). `/swarm:adopt --check transfer` runs them. New `commands.setup` key and guarantee.
- **Skill `learn`.** Turns an incident or a review finding into a durable rule with a mechanism (test, hook, ratchet,
  check) or an explicit `preference` label, written as a change or ADR draft; drafts an issue or PR for this
  repository when the lesson is generic, and never sends it without explicit confirmation.
- **`MAINTAINING.md`.** Running the protocol inside a company: single source of truth, playbook owner, two approvals
  for gate changes, the semver table, release checklist, update commands and managed-settings pinning, the
  incident → learn → PR loop, protocol score and detection latency per team, pilot before rollout.

### Changed

- `/swarm:adopt --check` compares the project's `swarm.json` `version` with the plugin's and reports drift with a link
  to this changelog.
- `templates/swarm.json` and the `INTEGRATION.md` §1 example carry `commands.setup`, `commands.ratchets` and the
  `review` block; `version` is `0.3.0`.
- The adopted path of the reference tooling is `scripts/dev/` everywhere (`swarm.json`, hooks, `templates/CLAUDE.md`,
  settings, CODEOWNERS, review globs); `reference/README.md` said `scripts/` and now says `scripts/dev/`.
- `reference/README.md` warns that `verify.logDir` must be gitignored before the first land.
- Manual chapter 14 marks file-size gates, rule mechanisms and detection latency as shipped.

### Fixed

- `land` crashed (`ENOENT … docs/adr`) in a repository without an ADR folder; the ADR numbering and index are now
  no-ops there.
- `audit.ts` counted the playground and its own regex source in the `any`, `@ts-ignore`, TODO and big-file metrics
  (AUD-metricas-ruido); it now excludes them and counts lines the same way as the file-size ratchet.

### Decided against

- Splitting the plugin into `core` and `governance` plugins. Claude Code installs a plugin by copying only its own
  directory, and the skills read the manual, templates and reference code through `${CLAUDE_SKILL_DIR}/../../`; a
  split would ship them without that knowledge or duplicate ~400 KB. Recorded in `MAINTAINING.md` §1.

## [0.2.0] — 2026-10-28

### Fixed

- `land` integrated the branch tip at the end of the run, not the commit it verified: a Stop-hook `wip:` commit
  created during the 5–10 minutes of verify was fast-forwarded unverified (twice in the reference project).
  `reference/scripts/land.ts` now records `rev-parse HEAD` before verify, requires the same SHA and a clean tree
  afterwards (aborting otherwise), and fast-forwards that exact SHA (`merge --ff-only <sha>` /
  `update-ref <ref> <sha> <old>`). `wt wip` does nothing while a live land lock belongs to its branch
  (`landRunningFor()` in `reference/scripts/git.ts`). Documented in `INTEGRATION.md` §2, `reference/README.md`,
  manual chapter 03 (incident note) and chapter 11 (anti-pattern).
- Plugin session hooks ran a legacy fallback (`scripts/dev/wt.ts`) in repositories without `swarm.json`. In a project
  that already wires the same commands in its own `.claude/settings.json`, every SessionStart and Stop ran twice. The
  hooks now act only on `swarm.json`.
- `templates/CLAUDE.md` presented `git commit` and `wt:commit` as equivalent; a plain `git commit` on top of a `wip:`
  buries it and `land` refuses the branch.

### Added

- Skill `change`: the spec-driven change lifecycle (explore, propose, apply, verify, archive) in one skill with a
  file per phase, OpenSpec by default and a mapping to other spec tools; red flags taken from real audits (absorbed
  changes left active, meta-tasks, untouched changes, code without a change, empty spec purposes).
- Skill `extend`: adding a new kind of piece follows the project's extension guide, or writes one in the same change;
  six-step skeleton (register, implement, contract, test, document, architecture entry) and per-kind traps.
- `audit-repo` brought to the level of the reference project's audit: run setup and memory rules, deterministic
  checks with "investigate before reporting" and known runner noise, metric hygiene, hunting holes in the
  architecture test, full harness, scalability and ordered security checklists, severity recalibration, and a sixth
  dimension that measures the project against this protocol.
- CI ⊇ verify: conformance check L1.3 now requires CI to run `commands.verify` (or exactly its steps) plus extra jobs
  each documented with why it is not in local verify, and forbids `continue-on-error` in the gate path. The CI
  template ships optional, commented jobs for backend parity (contract suites against a service database, migrations
  from zero, cross-backend fingerprints), an image built without secrets, and a backup/restore roundtrip. Manual
  chapter 02 explains the principle.
- Bidirectional docs test (`templates/tests/docs.test.ts`, `reference/tests/docs.test.ts`), config-driven at the
  top: every invariant id in the table has a test (or a stated reason) and every tested id is in the table; the ADR
  index lists every ADR file; the docs index links every extension guide; every package or app is documented; every
  CLI command appears in the README; prose must not cite invariant ids in a different numbering (`INV-1` for
  `INV-01`). Conformance check L2.5 updated; `templates/CLAUDE.md` lists invariants by their table ids.
- Domain contract validators as a first-class category of the gate: a sentence in `INTEGRATION.md` §2, a column in
  the §4 stack table, and a `validators` step in `reference/scripts/dev-flow.config.ts` (`verify.full` and quick).
- Session details: `templates/claude/.gitignore` (worktrees and the per-worktree ports file), documentation of
  `worktree.baseRef: "head"`, of `.claude/worktree.env` and of the `pre-push` `--no-verify` escape hatch in manual
  chapter 01 and the adoption guide.

## [0.1.0] — 2026-10-28

### Added

- `INTEGRATION.md`: the contract a project exposes (`swarm.json` manifest, command guarantees, plugin hooks,
  stack equivalents for TypeScript, Python, Go, Rust and JVM, the session protocol for agents without hooks,
  conformance checks per level, worked examples), with `templates/swarm.json` and `templates/AGENTS.md`.
- Stack-independent plugin hooks (`hooks/swarm-hook.sh`) driven by `swarm.json`, reading JSON with jq, node or
  python3.
- Every skill shares one structure: a trigger-only description, the gate in one sentence with its reason, when not
  to use it, exact commands resolved from `swarm.json`, a branch per failure, a red-flags table built from the
  manual's anti-patterns, and a mandatory evidence block.
- Skills `worktree` (start, check and clean up session worktrees; nothing deleted without an archive), `tdd` (test
  first, seen red for the right reason, proven to bite), `debug` (root cause before any fix; `debugger` agent for
  long investigations; `architect` after two failed fixes) and `review` (dispatches `reviewer`, `security-reviewer`
  and `test-auditor` with ready briefs, then verifies and triages every finding).
- Sibling reference files loaded on demand: `skills/verify/failures.md`, `skills/land/failures.md`,
  `skills/debug/techniques.md`, `skills/review/brief.md`, `skills/audit-repo/dimension-briefs.md`,
  `skills/audit-repo/skeleton.md`, `skills/adopt/levels.md`.
- `adopt --check [level]`: runs the conformance checks of `INTEGRATION.md` and changes nothing; `adopt` writes and
  maintains `swarm.json` and never raises a level over a failing check.
- Manual: 18 chapters covering principles, worktrees, verification, integration, testing, architecture and docs,
  spec-driven changes, code quality, working with agents, periodic audits, spend and secrets, anti-patterns,
  autonomy, glossary, roadmap, review processes, efficiency in real-world environments, and agentic-system architecture patterns.
- Reference implementation in `reference/`: the generalized `verify`, `land`, worktree, ADR, roadmap and audit
  tooling, architecture and docs tests, and test temp-dir hygiene, extracted from a production system.
- Claude Code plugin and marketplace: skills `playbook`, `adopt`, `verify`, `land`, `new-adr`,
  `audit-repo`; agents `builder`, `reviewer`, `security-reviewer`, `quality-auditor`, `architect`, `debugger`,
  `test-auditor`, `docs-keeper`; worktree hooks and a quality-gate edit warning.
- Templates: `CLAUDE.md`, Claude Code settings, path-scoped rules, ADR, OpenSpec artifacts and roadmap, CI and
  weekly review workflows, `pre-push` hook, architecture and docs tests, Vitest config, quality guide, extension
  guide, playground README, daily and weekly review prompts.
- Adoption guide by level, checklists, sources.
