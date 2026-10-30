# What each level writes

Read only the section for the level you are applying. Sources are relative to this plugin; destinations are in the
target repo. Merge every destination that already exists. The checks that prove each level are INTEGRATION.md §6.

## The one table

Each level writes these files and must pass these checks. ADOPTION.md's checklists follow this table.

| Level | Files written in the repo | Checks that must pass |
| --- | --- | --- |
| 0 | `swarm.json`; `CLAUDE.md` (level-0 rules only); `.claude/settings.json`; `.claude/.gitignore`; root `.gitignore` entries; `docs/adr/` (template, index, adoption ADR) | L0.1 to L0.6 |
| 1 | verify entry point and `commands.verify`/`verifyQuick`; CI workflow; `docs/quality.md`; `quality-ratchets.json` (with `silentErrors`); the coverage floor; `deps-allowlist.json` and the dependency audit; the formatter check; level-1 rules appended to `CLAUDE.md` | L1.1 to L1.9 |
| 2 | `land`, `wt`, `adr` and their config; `hooks` and the session commands in `swarm.json`; `review` block in `swarm.json` and the first receipt; architecture test and docs test; `AGENTS.md`; the `pre-push` guard (or branch protection); the findings ledger and `commands.findings`; `mutation-smoke`; level-2 rules appended to `CLAUDE.md` | L2.1 to L2.10 |
| 3 | OpenSpec and roadmap with the WIP limit; `commands.audit` and a baseline audit; scheduled reviews | L3.1 to L3.6 |
| Transferability | fresh-clone workflow, `CODEOWNERS`, runbook, dependencies, reference task, new-agent workflow, handover checklist | X1 to X5 (`--check transfer`) |

The protocol version: plugin agents read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`; agents without the
plugin read `.claude-plugin/plugin.json` of their own checkout of the protocol repo (`${CLAUDE_PLUGIN_ROOT}` does not
exist for them). Write that `version` into `swarm.json`.

## Contents

- Level 0 · manifest and agent memory
- Level 1 · one gate
- Level 2 · worktrees, integration, structure
- Level 3 · governance
- Integrating the adoption itself
- Transferability track (X1–X5) · separate from the levels

## Level 0 · manifest and agent memory

1. `swarm.json` from `${CLAUDE_SKILL_DIR}/../../templates/swarm.json`, with `"level": 0`, the detected
   `integrationBranch`, and the `commands` the user confirmed in the plan (stack mapping: INTEGRATION.md §4). Leave
   out keys whose commands do not exist yet; skills fall back and say so. Leave out `hooks` too until the scripts they
   name exist (level 2).
2. `CLAUDE.md` from `${CLAUDE_SKILL_DIR}/../../templates/CLAUDE.md`, with the real commands (install, single-file
   test, types, lint, verify). Under 200 lines. If one exists, merge section by section. **Keep only rules that are
   true for this repo today:** a rule whose mechanism does not exist is written as `(preference)` or dropped, and the
   stack-specific sections (TypeScript, pnpm, vitest, OpenSpec, the INV table) are deleted or replaced for another
   stack. At level 0 copy only the `<!-- level 0 -->` group: every `enforced:` path in it exists after this level
   (L0.6). The level-1 and level-2 groups are added by those levels.
3. `.claude/settings.json`: `deny` for `.env*` and secret files, `ask` for `git push *`, `allow` for the verify
   commands. Choose the source by how the team runs agents:
   - Plugin users: `${CLAUDE_SKILL_DIR}/../../templates/claude/settings.json`. It already carries
     `extraKnownMarketplaces` and `enabledPlugins` for `swarm@agentic-coding-swarm-protocol` (chapter 16 §0) and no
     SessionStart/Stop hooks: the plugin runs `hooks.sessionStart` and `hooks.stop` from `swarm.json`, so wiring
     them here too would run them twice.
   - No plugin (other agents, or a team that declines it): `${CLAUDE_SKILL_DIR}/../../templates/claude/settings.no-plugin.json`.
     It wires the two session hooks itself. Their commands must be `swarm.json` → `hooks`; if the repo has no such
     scripts, delete both hook entries, because a hook that points at a missing script only prints errors.
   Merge; remove nothing.
4. `.gitignore` (the root one is the only place that ignores session worktrees): `CLAUDE.local.md`,
   `.claude/settings.local.json`, `.claude/worktrees/`. Copy `${CLAUDE_SKILL_DIR}/../../templates/claude/.gitignore`
   to `.claude/.gitignore`; it only ignores the per-worktree ports file.
5. `docs/adr/0000-template.md` from `${CLAUDE_SKILL_DIR}/../../templates/adr/0000-template.md`, `docs/adr/README.md`
   from `${CLAUDE_SKILL_DIR}/../../templates/adr/README.md` (it holds the `<!-- generated:adr-index -->` markers the
   ADR tool rewrites), and the adoption ADR draft from the plan.

Evidence: `git diff --stat`; `node -e "JSON.parse(require('fs').readFileSync('swarm.json','utf8'))"` and the same
for `.claude/settings.json` (or `python3 -m json.tool`); `--check 0`.

## Level 1 · one gate

1. A single verify entry point that runs exactly the CI steps. Node: start from
   `${CLAUDE_SKILL_DIR}/../../reference/scripts/verify.ts` (replace `fullSteps()` with the real CI steps and
   `quickSteps()` with their changed-files equivalents; temp prefix = project name). Other stacks: a wrapper script
   (INTEGRATION.md §4); a bare `make verify: lint test` cannot print one line per step, the tail of each failure and
   keep logs on disk. It must meet the guarantees in INTEGRATION.md §2.
2. Set `commands.verify` and `commands.verifyQuick` in `swarm.json`.
3. CI calls the same entry point (merge with the existing workflow; template
   `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/ci.yml`, which includes a secret-scan job). No secrets in
   the quality job.
4. Coverage floor: measure first, then set the floor to measured minus half of `maxGap` (with `maxGap: 1`, half a
   point below). That is the value `ratchets.ts --tighten` writes, so the first tighten changes nothing. `.only`
   forbidden in CI.
5. **Ratchets** (L1.6). `${CLAUDE_SKILL_DIR}/../../templates/quality-ratchets.json` to the root, adapted (`include`,
   lint command), then `ratchets.ts --init` (`${CLAUDE_SKILL_DIR}/../../reference/scripts/ratchets.ts`) **before the
   first commit of the file**: it records today's oversized files, the coverage floor and the lint warning count.
   Add the ratchets check as the last serial step of the full `verify` (after the tests, which write the coverage
   summary) and `fileSize` to the quick one. Set `commands.ratchets`. Tightening by `land` is level 2.
   - **Lint budget per stack.** The budget counts the linter's diagnostics with the tool in "report, don't fail"
     mode: ruff `--exit-zero --output-format json`, eslint `-f json`, biome `--reporter=json` (with
     `--max-diagnostics=10000`). A stack with no warning severity (ruff has none) keeps `budget: 0` and treats every
     diagnostic as an error.
   - **Porting.** `--init` and the lint counter are Node-shaped. A Python pilot ported the ratchets in about 190 lines
     and verify in about 110; keep the file format identical so the ports stay interchangeable (manual chapter 07).
6. **Dependency gate** (L1.7). `${CLAUDE_SKILL_DIR}/../../templates/deps-allowlist.json` to the root and
   `${CLAUDE_SKILL_DIR}/../../reference/scripts/deps-audit.ts` to `scripts/dev/` with `deps.command` set to the
   stack's audit (`pnpm audit --prod --json`, `pip-audit -f json`, `cargo audit --json`). Run it once: every high or
   critical advisory it prints gets an upgrade today or an allowlist entry with reason, owner and a short expiry.
   Add `deps` as the last serial step of the full `verify` and to CI.
7. **Formatter** (L1.8). If the formatter is off, turn it on in one logic-free commit at a quiet moment (manual
   chapter 07: `git diff -w --stat` empty, `.git-blame-ignore-revs` with that SHA, every open branch rebases once).
   Add the `format` step to both verify tiers (`format.check`, `format.quickCheck`).
8. **Silent errors** (L1.9). `ratchets.ts --init` records today's silent catches in `silentErrors`; add
   `ratchets.ts --silent-only` on the changed files to the quick tier. The count only goes down from here.
9. `docs/quality.md` from `${CLAUDE_SKILL_DIR}/../../templates/docs/quality.md`.
10. Append the `<!-- level 1 -->` rules of `CLAUDE.md`, keeping only those whose mechanism now exists.

Evidence: both gates green with their last lines pasted; `--check 1`. L1.6 at this level: the file exists, `verify`
runs it, and nothing is loosened compared with the integration branch.

## Level 2 · worktrees, integration, structure

Depends on the scenario (chapter 16 §0):

- **A (single workstation, small team):** from `${CLAUDE_SKILL_DIR}/../../reference/scripts/`: `land.ts`, `git.ts`,
  `remote.ts`, `adr.ts`, `wt.ts`, `procs.ts`, `dev-flow.config.ts`, parameterized; test temp-file hygiene from
  `${CLAUDE_SKILL_DIR}/../../reference/tests/`; the `pre-push` publisher guard from
  `${CLAUDE_SKILL_DIR}/../../templates/githooks/pre-push` with `git config core.hooksPath`.
- **B, D, E (slow CI, PR teams, several machines):** `wt.ts` and `adr.ts`, but `land` in PR mode (rebase, quick
  gate, push the branch, PR with auto-merge; the merge queue runs the full gate and numbers ADRs). Branch
  protection instead of the publisher hook. Reviews gate the merge through
  `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/review-gate.yml` and
  `${CLAUDE_SKILL_DIR}/../../reference/scripts/pr-review-gate.ts` (to `scripts/dev/`), with `review-gate` a required
  status check and the `review.pr` block in `swarm.json`; ask the user whether Copilot reviews the PRs and how long
  a bot may take (template 2 h).
  The merge queue, branch protection or rulesets and attestations depend on the code host's plan and on the
  repository being public or private: verify against the project's plan before choosing B, D or E, and use the
  fallbacks in manual chapter 16 §0 ("Verify against your plan") when a feature is missing.
- **C (monorepo):** as A or D, with the quick gate per affected package and a `CLAUDE.md` per package.

Then, in every scenario:

1. `commands.commit`, `commands.status`, `commands.land`, `commands.newAdr` and `hooks.sessionStart`/`hooks.stop`
   in `swarm.json`. The plugin hooks run them (INTEGRATION.md §3); without the plugin, use the no-plugin settings
   variant of level 0 step 3.
2. An invariants table (propose five to the user) and the architecture test from
   `${CLAUDE_SKILL_DIR}/../../templates/tests/architecture.test.ts`, inside verify.
3. The docs test from `${CLAUDE_SKILL_DIR}/../../templates/tests/docs.test.ts`, inside verify.
4. `AGENTS.md` from `${CLAUDE_SKILL_DIR}/../../templates/AGENTS.md` for agents without plugins (INTEGRATION.md §5),
   or a pointer to `CLAUDE.md`.
5. **Review gate** (L2.7). Add the `review` block to `swarm.json` (template `mode: sensitive`). The template's
   `sensitive` globs are shaped like a backend application (auth, payments, CI); **ask the user which paths are this
   project's core** and add them: a library's `src/**` matches none of the defaults, so without this `land` would
   not ask for a receipt on a core logic change. For a library, use `mode: always`. Then run the `review` skill once
   on the adoption change so the first receipt exists, and show the `land` refusal when it is missing. In PR mode
   there is no local `land` check: a required review by `CODEOWNERS` in which the reviewer attaches the `reviewer`
   agent's report counts as the receipt, and the `review-gate` status must be required: open a test PR with a
   reviewer requested and show it `pending`, then `success` once the review is in.
6. `land` tightens the ratchets (level 1 step 5) and commits only that file.
7. **Findings ledger and closure gate** (L2.8, L2.9). `${CLAUDE_SKILL_DIR}/../../reference/scripts/findings.ts` to
   `scripts/dev/`, `commands.findings` and the `findings` block in `swarm.json` (template SLA 2 / 14 / 60 days,
   `closureEvery: 3`). Seed the ledger from the latest audit with `findings add` (one line per open finding, an
   `--owner` on every HIGH, `--opened` the audit's date so the SLA clock is honest), then show the user `findings
   check`: an overdue HIGH blocks `land` from now on unless the change carries `Closes: <id>`.
8. **Mutation smoke** (L2.10). `${CLAUDE_SKILL_DIR}/../../reference/scripts/mutation-smoke.ts` to `scripts/dev/`
   with `mutation.command` set to the test runner; `--mode warn` as a serial step of the full tier after the tests,
   `--mode fail` once the survivors it reports are fixed.
9. Append the `<!-- level 2 -->` rules of `CLAUDE.md`. In PR mode there is no `pre-push` hook: change the rule that
   cites it to name the branch protection as a `(preference)`, since a setting cannot be cited as a path.

Evidence: a trivial `docs/` change landed (or its PR opened) with the output shown; `--check 2`.

## Level 3 · governance

Only after levels 0–2 have run for about two weeks.

1. OpenSpec (`openspec init`, with the user's agreement) and a roadmap with its validator inside verify
   (`${CLAUDE_SKILL_DIR}/../../reference/scripts/roadmap.ts`, templates in
   `${CLAUDE_SKILL_DIR}/../../templates/openspec/`).
2. The audit metrics script (`${CLAUDE_SKILL_DIR}/../../reference/scripts/audit.ts`) → `commands.audit`; a first
   run of the `audit-repo` skill as the baseline.
3. Scheduled reviews (`${CLAUDE_SKILL_DIR}/../../templates/review/`,
   `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/weekly-review.yml`). **Ask first**: they spend money and
   send code to a model, so the user decides on budget and data policy. Use a dedicated API key with a spend cap
   (manual chapter 15).
4. **WIP limit** (L3.6). The `roadmap` block in `swarm.json` (template `maxActive: 12`, `staleDays: 14`); the
   roadmap validator fails above the limit and on stale changes. If the project is already above it, the first
   task is a triage with the user: archive, park (`parked: <reason>` in the proposal) or finish; never raise the
   limit to fit.

Evidence: `--check 3`.

## Integrating the adoption itself

The adoption changes land "the repo's way". Without `land` (levels 0–1) or without a remote: commit on a branch and
merge it with `--ff-only` after `verify`. Never commit on the integration branch directly. With `land`, use it.

## Transferability track (X1–X5) · separate from the levels

The X-checks (INTEGRATION.md § "Transferability (X1–X5)", manual chapter 18) prove that another team can absorb the
project. They never change `level`, and a project needs all five before it is declared "absorbable". Start once
level 1 is green (a working `verify`); apply them in this order, one session each if the repo is large.

1. **X1 · fresh clone.** Write one `commands.setup` that meets INTEGRATION.md §2 (install, local config from
   `.env.example` with non-secret defaults, seed). Prove it locally in a fresh clone (clone into a temp directory,
   run setup, then verify), list the prerequisites in the README, then add
   `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/fresh-clone.yml` (adapt the runtime step).
2. **X3 · ownership.** `${CLAUDE_SKILL_DIR}/../../templates/CODEOWNERS` → `.github/CODEOWNERS`;
   `${CLAUDE_SKILL_DIR}/../../templates/docs/runbook.md` → `docs/runbook.md`;
   `${CLAUDE_SKILL_DIR}/../../templates/docs/dependencies.md` → `docs/dependencies.md`. Pre-fill only what the repo
   proves (CI schedules, env vars in `.env.example`, SDKs and hosts in code); every owner, payer, rollback and alert
   is a question for the user, never a guess.
3. **X4 · no hidden knowledge.** Add the hidden-knowledge counts (chapter 18 §d) to the audit metrics
   (`commands.audit`) and run the `audit-repo` skill once as the baseline.
4. **X2 · new-agent test.** With the user, pick the reference task and write `docs/handover/reference-task.md` from
   `${CLAUDE_SKILL_DIR}/../../templates/handover/reference-task.md`, with its acceptance command. **Ask first** before
   adding `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/new-agent-test.yml`: it spends money and sends code to
   a model, and the agent runs project commands with the API key in its environment (use a dedicated, capped key;
   chapter 18 §b). Trigger it once by hand and turn every gap in its report into a docs fix.
5. **X5 · handover checklist.** `${CLAUDE_SKILL_DIR}/../../checklists/handover.md` → `docs/handover/checklist.md`,
   with the current owning team named.

Evidence: the fresh-clone and new-agent runs (links or `gh run list` output); `--check transfer`.
