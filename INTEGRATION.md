# Integration contract

What a project must expose so that the Swarm Protocol plugin, its skills, its agents and any other coding agent can
operate in it. This is the single source of truth for that interface: skills and agents point here instead of
assuming a stack.

**Rule:** a repository has adopted the protocol if and only if it has a valid `swarm.json` at its root. Everything an
agent runs (verify, land, commit, hooks) is resolved from that file, never guessed.

## 1. The manifest: `swarm.json`

```json
{
  "protocol": "swarm",
  "version": "0.4.0",
  "level": 2,
  "integrationBranch": "main",
  "commands": {
    "setup": "corepack enable && pnpm install --frozen-lockfile && pnpm seed",
    "verify": "pnpm verify",
    "verifyQuick": "pnpm verify --quick",
    "commit": "pnpm wt:commit",
    "status": "pnpm wt:status",
    "land": "pnpm land",
    "newAdr": "docs/adr/draft-<slug>.md",
    "audit": "pnpm audit:repo",
    "ratchets": "node scripts/dev/ratchets.ts",
    "findings": "node scripts/dev/findings.ts",
    "leases": "node scripts/dev/leases.ts",
    "overlap": "node scripts/dev/overlap.ts"
  },
  "findings": { "file": "docs/audits/findings.jsonl", "sla": { "high": 2, "medium": 14, "low": 60 }, "closureEvery": 3 },
  "hooks": {
    "sessionStart": "node scripts/dev/wt.ts setup; node scripts/dev/leases.ts session; node scripts/dev/overlap.ts --session",
    "stop": "node scripts/dev/wt.ts wip; node scripts/dev/leases.ts renew --hook",
    "preEdit": "node scripts/dev/leases.ts check",
    "postEdit": "node scripts/dev/overlap.ts --notify",
    "gateEdit": "warn"
  },
  "leases": { "ttlMinutes": 30, "exclusive": ["**/migrations/**", "*.sql", "src/shared/types/**"] },
  "gates": ["*/vitest.config.*", "*/architecture.test.*", "*/docs.test.*", "*/scripts/dev/*"],
  "review": { "mode": "sensitive", "sensitive": ["**/auth/**", "**/migrations/**", ".github/**", "swarm.json"] }
}
```

Template: [templates/swarm.json](templates/swarm.json). The `adopt` skill writes it at level 0 and raises `level` only
after the conformance checks for that level pass (§6).

| Key | Required from | Meaning |
|---|---|---|
| `protocol`, `version` | level 0 | Always `"swarm"`; the protocol version the project follows. A plugin refuses to act on a newer major. |
| `level` | level 0 | Highest level whose conformance checks pass. Never set by hand. |
| `integrationBranch` | level 0 | `main` unless stated. |
| `commands.setup` | X1 (recommended from level 1) | One command that takes a clean clone to a state where `verify` passes. |
| `commands.verify` | level 1 | The full gate. |
| `commands.verifyQuick` | level 1 | The fast, change-scoped gate. |
| `commands.commit`, `commands.status`, `commands.land` | level 2 | Session commit, session overview, serialized integration (or PR creation in PR mode). |
| `hooks.sessionStart`, `hooks.stop` | level 2 | Run by the plugin hooks (§3). Optional for teams whose agents have no hooks; then §5 applies. |
| `hooks.preEdit` | optional (recommended from level 2) | Run by the plugin's `PreToolUse` hook before an Edit or Write, with the hook JSON on stdin. Its stdout goes back to Claude Code; its exit 2 refuses the edit (the only hook allowed to block, §3). The template runs `leases check`. |
| `commands.leases`, `leases` | optional (recommended from level 2) | The leases CLI (default `node scripts/dev/leases.ts`) and `{ ttlMinutes, exclusive }`: minutes without a renewal before a lease is dead (default 30) and the exclusive zone globs. Read from the integration branch, so a branch cannot relax them. |
| `hooks.postEdit` | optional (recommended from level 2) | Run by the plugin's `PostToolUse` hook after an Edit or Write, with the hook JSON on stdin; its stdout goes back to Claude Code. The template runs `overlap --notify`. |
| `commands.overlap` | optional (recommended from level 2) | Early overlap detection between session branches (§2). Default `node scripts/dev/overlap.ts`. |
| `commands.newAdr` | level 2 | A command, or a path pattern for draft ADRs. |
| `commands.audit` | level 3 | Offline debt metrics. |
| `commands.ratchets` | required from level 1 (L1.6) | Checks `quality-ratchets.json`; with `--tighten`, rewrites it to the current values, only tightening. Default `node scripts/dev/ratchets.ts`. |
| `commands.findings` | level 2 (L2.9) | The findings ledger CLI: `add`, `close`, `accept`, `list`, `check`, `stats`. Default `node scripts/dev/findings.ts`. |
| `findings` | level 2 (L2.8, L2.9) | `{ file, sla, closureEvery }`: the ledger path (default `docs/audits/findings.jsonl`), days to close by severity (defaults 2 / 14 / 60) and the closure quota N (default 3). `land` reads it from the integration branch. |
| `roadmap` | level 3 (L3.6) | `{ maxActive, staleDays }`: active changes allowed at once (default 12) and days without a ticked task before a change counts as stale (default 14) unless its proposal carries `parked: <reason>`. The roadmap validator enforces both inside `verify`. |
| `gates` | optional | Extra file globs whose edits trigger the quality-gate warning. |
| `hooks.gateEdit` | optional | What the plugin's gate hook does when an agent edits a quality-gate file (§3): `warn` (default; a message, the edit goes ahead), `ask` (the person approves that one edit) or `block` (the edit is denied with the reason). Any other value means `warn`. |
| `review.mode`, `review.sensitive` | optional (L2.7) | When `land` requires a review receipt: `always`, `sensitive` (default: only if a changed path matches a `sensitive` glob) or `off`. Read from the integration branch, so a branch cannot relax its own gate. Template default: `sensitive`, with globs for auth, payments, migrations, CI, quality gates and settings. |
| `review.pr` | optional (PR mode, L2.7) | `{ botTimeoutHours, requireReviewer, bots }` for the PR review gate (`pr-review-gate.ts`): hours a requested bot such as Copilot may take before the gate stops waiting for it (default 2; a requested person has no deadline), whether a pull request that never requested a reviewer stays pending (default `true`), and extra logins treated as bots. Read from the integration branch. |

Missing keys fall back to the defaults in the template (Node and pnpm). A skill that uses a fallback says so in its
output, so a non-Node project notices immediately.

**Findings ledger.** Every problem an audit, a review, an incident or CI finds goes into one append-only JSONL file
(`findings.file`), one object per line: `{ id, severity: high|medium|low, title, file, line?, source:
audit|review|incident|ci, opened, owner?, sla_due, status: open|closed|accepted, closed?, closed_by?, reason?,
introduced?: <sha>|"unknown", detected, catchable_at_review?, dc?: "DC-xxx" }`, dates as `YYYY-MM-DD`. A status change
is a new line with the same `id` (the latest line is the state), like every ledger of the protocol; `sla_due` is
`opened` plus the days of `findings.sla` for the severity. `accepted` is a signed risk (`reason` required): it counts as
closed for the gate and is reported apart. The point is to measure and force *closure*, not detection: the reference
project found 32 audit findings and left about 20 of them open for ten days. Example: [templates/docs/audits/findings.jsonl](templates/docs/audits/findings.jsonl);
specification and Node implementation: [reference/README.md](reference/README.md) (findings).

**Review receipt.** The proof of a per-change review that `land` checks (L2.7). One JSON file per change, written by
the `review` skill once the branch is committed and triaged, at `<git-common-dir>/swarm-reviews/<patch_id>.json`
(local to the clone, never committed):

```json
{"patch_id": "...", "base": "<integration sha>", "head": "<sha>", "reviewers": ["reviewer", "security-reviewer"], "verdict": "pass|changes_requested", "open_high": 0, "at": "<iso>", "report_sha256": "<hex>", "report_bytes": 1234}
```

Next to it, `<patch_id>.md` is the full review report (agents dispatched and their verdicts, findings with defect-class
ids, triage; at least 200 bytes), and the receipt carries its sha256 and size: the reviewer names in a receipt are typed
by the session that wants to land, so a `pass` without a report that hashes to the receipt does not count.

`patch_id` is `git patch-id --stable` over `git diff <integration>...HEAD`: stable across a squash and a clean rebase
(so it survives land's own rebase), new for any further edit. A receipt passes only with `verdict: "pass"` and
`open_high: 0`. Specification and Node implementation: [reference/README.md](reference/README.md) (review gate).

## 2. What each command must guarantee

The names are free; the behaviour is the contract. Every guarantee below is something a skill relies on.

| Command | Must | Must never |
|---|---|---|
| `setup` | From a clean clone with only the prerequisites the README lists (runtime, package manager), install dependencies, create local config from `.env.example` with non-secret defaults and seed local data, so that `verify` exits 0 next. Be idempotent: a second run changes nothing. | Need a secret, a manual step, a tool not in the README's prerequisites, a cache, or network beyond package registries; modify tracked files. |
| `verify` | Run every step of CI's quality job (CI ⊇ verify: CI may add documented jobs that need services, Docker or minutes, never skip a verify step), including the domain contract validators. Exit 0 if and only if every step is green. Print one line per step and the tail of each failure; keep full logs on disk and print their path. | Pass with a skipped, retried or "known flaky" step, unless the tolerance is a documented exact signature. |
| `verifyQuick` | Run the steps affected by the diff against the integration branch, plus the structural tests. Finish in seconds to a few minutes. | Be accepted as the gate that closes a task. |
| `commit` | Absorb a pending `wip:` commit and commit everything with the given message. | Push. |
| `status` | List worktrees and branches with unintegrated work, dirty state and age. | Change anything. |
| `land` | Serialize integrations (lock), refuse foreign commits on the remote, rebase, record the SHA, run full `verify`, fast-forward to that SHA, publish, log the attempt. Integrate exactly the commit it verified: if the branch tip moved or the tree changed during verify, abort (or start a new attempt). On any failure leave the integration branch untouched and exit non-zero with the reason. After the rebase and before verify, refuse a change without a passing review receipt for its patch id when `review.mode` requires it; `--no-review "<reason>"` skips that check and logs the reason. Next, before verify, two findings gates read the ledger **from the integration branch**: an open HIGH past its `sla_due` blocks the land unless a commit of the branch carries `Closes: <id>` for every one of them, and when none of the last `closureEvery` lands (any branch) closed a finding, this land must close one (`Closes: <id>` trailer, or a `fix(AUD-…)` subject) or be a `refactor:` (while any finding is open); `--override-findings "<reason>"` skips both and logs `findings-overridden` with the reason. After a green verify each `Closes: <id>` appends a `closed` line (`closed_by` = that commit) in a commit on top of the verified SHA that touches only the ledger (and the ratchets file, as one commit, when both changed). Each `landed` log entry records `closes: [ids]` and `refactor`. The verification is never replaced by an environment variable outside the reference's own self-tests; if one is honoured there, the land log says `verify: "overridden"`. | Fast-forward to a branch name instead of the verified SHA; resolve conflicts, merge histories, or force-push. |
| `audit` | Run offline with no spend, print metrics, optionally store a snapshot for deltas. The table opens with a **Closure** block (open findings by severity, overdue, median open age, opened and closed in 14 days, closure ratio, accepted risks) and **Hot files** (files with several `fix` commits in a month that are also over the size limit); `--write` stores both in the snapshot. | Fix anything. |
| `findings` | Keep the append-only ledger: `add` (one finding, with severity, file, source, owner and `dc`), `close <id>`, `accept <id> --reason`, `list`, `stats`, and `check`, which exits 1 if and only if an open HIGH is past its `sla_due`, naming each and its days overdue (overdue mediums only warn). A status change is a new line, never an edit. | Delete or rewrite a line; close a finding without recording who or what closed it. |
| `ratchets` | Check `quality-ratchets.json`: no new file over the size limit and no exception above its recorded size; measured coverage neither below the floor nor more than `maxGap` above it; lint warnings within budget. Run last in the full `verify` (after the tests, which write the coverage summary); the quick tier checks file size on the changed files only. With `--tighten` (run by `land` after a green verify), move every value to the measured one in the tightening direction only; `land` commits the file alone on top of the verified SHA and aborts if that commit touches anything else. `check` also compares the file with the integration branch's copy (merge base) and fails on any loosening: new or larger exception, higher `max`, higher budget, lower floor, higher `maxGap`, narrower `include`; the file is a sensitive path of the review gate. | Loosen a value (add an exception, lower a floor, raise a budget), or change any other file. |
| `deps-audit` | Run the stack's dependency audit as JSON (`deps.command`), normalise it, and exit 1 on any advisory at a `deps.failOn` severity (default critical, high) that `deps-allowlist.json` does not list with a reason, an owner and an unexpired date; an expired entry fails again; an advisory with no severity counts as high. Serial, last step of the full tier and a CI step. | Pass when the audit printed no JSON (network down counts as a failure, not a pass). |
| `mutation-smoke` | For each changed source file with related tests, apply a few mutations (`>=`/`<=`, `===`, `&&`/`||`, early `return`) one at a time and run those tests; restore the original on every exit path. Report each file whose mutants all survive and each changed file with no related test as "not proven". `mode: warn` reports; `mode: fail` exits 1. | Leave a mutated file on disk; claim a red baseline as a kill. |
| `leases` | Keep one lease per session branch that expires after `ttlMinutes` without a renewal or when its worktree is gone. `check`: take the exclusive zone that covers the edited file, or refuse with exit 2 and the holder when another live branch holds it; add the file to the lease; tell the agent once which other live leases cover it. `claim`, `renew`, `release` (also run by `land` after a green integration), `break --reason` (logged), `session`, `list`. | Block for any reason other than a zone held by another live branch; let an expired or orphaned lease hold anything; refuse with any exit code but 2. |
| `overlap` | List the active session branches (linked worktrees with commits not in the integration branch or uncommitted changes) and report, for the current branch by default or every pair with `--all`: files two branches both touch, the files `git merge-tree` predicts will conflict, and files the integration branch changed since the branch's merge base that the branch also touches. `--strict` exits 1 on a predicted conflict. | Commit, rebase, fetch, block, or report a pair as conflict-free when git could not predict it. |
| `hooks.sessionStart` | Prepare a session (deps, ports, warnings) and exit 0 even on error. | Block the session or print more than a few actionable lines. |
| `hooks.stop` | Keep at most one rolling `wip:` commit when the tree is dirty, outside the main checkout. | Commit in the main checkout, during a rebase or merge, or while a `land` of its branch is running. |
| `hooks.preEdit` | Exit 0 and print nothing or one `PreToolUse` JSON with `additionalContext`; exit 2 with the reason on stderr only for a deliberate refusal. | Exit 2 on its own errors. |
| `hooks.postEdit` | Exit 0 always. Print nothing, or one `PostToolUse` JSON with `hookSpecificOutput.additionalContext`; speak only when there is something new for the agent. | Block, or repeat the same notice on every edit. |

**Domain contract validators are a first-class category of the gate**, next to lint, types and tests: the
project's own data (tool or plugin registries, tenant configuration, specs, fixtures) checked against its schemas
and cross-references by dedicated commands that run inside `verify` and in CI. A registry that names an
implementation that does not exist is as broken as code that does not compile.

The reference implementation of every command is specified in [reference/README.md](reference/README.md), with code
in `reference/scripts/`.

## 3. Plugin hooks

The plugin ships four hooks, all implemented by [hooks/swarm-hook.sh](hooks/swarm-hook.sh), all exit 0 always but
for one deliberate refusal:

- **SessionStart** runs `hooks.sessionStart` from `swarm.json`.
- **Stop** runs `hooks.stop`.
- **PostToolUse (Edit/Write)** runs `hooks.postEdit` with the hook JSON on stdin and passes its stdout back, so the
  command can add `additionalContext` for the agent (the template: an early overlap notice). Because it runs in the
  project root, the command finds the session's worktree from `tool_input.file_path`.
- **PreToolUse (Edit/Write)** reacts when a file matching a quality-gate glob is edited (the defaults plus `gates`
  from `swarm.json`), as `hooks.gateEdit` says. `warn`, the default, prints a message and lets the edit through, so
  the gate is only stopped at `land` and review. `ask` and `block` answer with the `PreToolUse` permission decision
  on stdout (`ask` or `deny`, with the reason) and still exit 0, so a broken hook never blocks a session. With
  `block` an agent cannot edit `swarm.json` either: a person changes the mode by hand. In a non-interactive run
  nobody answers `ask`; check what your harness does with it before relying on it there. The warning in
  `templates/claude/settings.json` is independent of the plugin and only warns.
  For every edit that the gate does not answer with `ask` or `deny`, it then runs `hooks.preEdit`, if present, with the hook JSON on stdin and
  passes its stdout back; if that command exits 2, the hook exits 2 and Claude Code refuses the edit, showing the
  command's stderr to the agent. Any other exit status is ignored. The template uses it for leases: an edit inside an
  exclusive zone that another live session holds. Because the hook runs in the project root, the command finds the
  session's worktree from `tool_input.file_path`.

In a repository without `swarm.json` the session hooks do nothing, so installing the plugin globally is safe, and a
project that already wires its own SessionStart/Stop hooks in `.claude/settings.json` never gets them run twice. A
project that adopts the manifest moves those commands into `hooks` and removes them from its settings. The settings
template carries no session hooks; without the plugin use `templates/claude/settings.no-plugin.json`. They read JSON with `jq`, `node` or `python3`,
whichever exists first. The hook commands come from the project's own committed file, under the same trust as its
`.claude/settings.json`: review changes to `swarm.json` like any other change to the build.

## 4. Stack equivalents

The workflow tooling (`land`, `wt`, ADR numbering) needs git and Node 24. Choose explicitly: keep Node as a dev
dependency (a Python team still carries it) and run the scripts as they are, or port them (ratchets about 190 lines,
verify about 110, land about 150, plus `wt` and `adr`). Stack-neutral ports are welcome contributions. The gate
itself uses the stack's native tools:

| Stack | Lint | Types | Domain contract validators | Tests + coverage floor | Quick (affected only) | Architecture rules |
|---|---|---|---|---|---|---|
| TypeScript (pnpm) | Biome or ESLint | `tsc --noEmit` | a CLI command per data family parsing with Zod (`validate:registry`, `validate:config`), `openspec validate --all` | Vitest with `coverage.thresholds` | `vitest run --changed <branch>` | import-graph test, dependency-cruiser |
| Python (uv / Poetry) | `ruff check` | `mypy` or `pyright` | Pydantic or `check-jsonschema` over the data files | `pytest --cov --cov-fail-under=<N>` | `pytest --testmon`, or tests under changed paths | import-linter contracts |
| Go | `golangci-lint run` | the compiler, `go vet` | a `cmd/validate` over the data files, or `cue vet` | `go test -race -coverprofile` + a coverage-floor check | `go test` on changed packages and their dependents | arch-go, or a test over `go list -deps` |
| Rust | `cargo clippy -- -D warnings` | `cargo check` | a `validate` binary with serde + schema checks | `cargo llvm-cov --fail-under-lines <N>` | `cargo test -p <changed crates>` | module visibility, cargo-deny for dependencies |
| JVM (Gradle) | Spotless or Checkstyle | the compiler | a Gradle task with a JSON Schema validator | `gradle check` with JaCoCo violation rules | `:<module>:test` for changed modules | ArchUnit |
| Anything | `make lint` | `make typecheck` | `make validate` | `make test` | `make test-changed` | a test in the project's own test runner |

### Python, command by command

For a Python project that keeps the Node 24 reference scripts as dev tooling, this is the full mapping: the
`swarm.json` commands, every step of the reference `verify` (`verify.full` and `verify.quick` in
`reference/scripts/dev-flow.config.ts`, which `land` also runs), and the 0.4.0 ratchets, dependency gate and mutation
smoke. Commands assume uv, Ruff, pyright, pytest with pytest-cov, import-linter, pip-audit, mutmut and Hypothesis as
dev dependencies; check the flags against the versions you pin.

| Concern | Reference (TypeScript) | Python |
|---|---|---|
| `commands.setup`, `installCommand`, `setupInstallCommand` | `pnpm install --frozen-lockfile` | `uv sync --locked` (fails when `uv.lock` is out of date) |
| `lockfile`, `installMarker` (re-install after a rebase) | `pnpm-lock.yaml`, `node_modules/.modules.yaml` | `uv.lock`, `.venv/pyvenv.cfg` |
| verify `lint` | `pnpm -s lint` | `uv run ruff check .` |
| verify `format` | `pnpm -s biome format .` | `uv run ruff format --check .` |
| verify `typecheck` | `pnpm -s typecheck` | `uv run pyright` (strict mode in `pyproject.toml`) or `uv run mypy` |
| verify `validators` | `pnpm -s validate:registry` | `uv run python -m <package>.validate` with Pydantic models, or `uvx check-jsonschema --schemafile <schema> <files>` |
| verify `tests + coverage` | `pnpm -s test:coverage` | `uv run pytest --cov=<package> --cov-branch --cov-report=json:coverage/coverage.json` (pytest-cov). Property tests use Hypothesis inside the same run; a CI settings profile with `derandomize=True` keeps the gate reproducible |
| verify `ratchets`, coverage floor | reads `coverage/coverage-summary.json` (Istanbul `{ total: { lines: { pct } } }`) | coverage.py writes another shape: convert it after the tests, for example `jq '{total: {lines: {pct: (.totals.covered_lines * 100 / .totals.num_statements)}, branches: {pct: (if .totals.num_branches > 0 then .totals.covered_branches * 100 / .totals.num_branches else 100 end)}}}' coverage/coverage.json > coverage/coverage-summary.json`, and keep only `lines` and `branches` in `coverage.floor` (a metric the summary lacks is not judged) |
| ratchets `fileSize` | `include` of `*.ts` globs | `"include": ["src/**/*.py"]`, `"exclude": ["tests/**", "**/test_*.py"]` |
| ratchets `lintWarnings` | Biome or ESLint JSON with warnings | Ruff has no warning level (a rule passes or fails): drop the block, or point `command` at a wrapper that prints ESLint-shaped JSON for the rules you treat as warnings |
| ratchets `silentErrors` | the TypeScript `catch` scanner | the scanner does not read Python: enable Ruff `S110` (`try`/`except`/`pass`), `S112` (`try`/`except`/`continue`) and `BLE001` (blind `except Exception`); put today's hits in `per-file-ignores` and let that list only shrink (`pyproject.toml` is then a `review.sensitive` path) |
| verify `structural rules`, architecture | `pnpm -s test:arch` | `uv run lint-imports` (import-linter contracts in `pyproject.toml`) |
| verify `mutation smoke` | `node scripts/dev/mutation-smoke.ts`, `mutation.command: "pnpm vitest run {files}"` | the same script: it already mutates `.py` (`True`/`False`, `and`/`or`, `==`) and finds `test_<name>.py`; set `mutation.command` to `"uv run pytest -q {files}"`. For real mutation testing, schedule `uv run mutmut run` outside `verify` |
| verify `deps` (`deps-audit`) | `deps.command: "pnpm audit --prod --json"` | `deps.command: "uv export --frozen --no-dev --no-emit-project --format requirements-txt -o tmp/requirements.audit.txt && uvx pip-audit --disable-pip -r tmp/requirements.audit.txt -f json"` (the exported file carries hashes, which `--disable-pip` needs; `--no-emit-project` drops the unhashed `-e .` line). pip-audit reports no severity, so every advisory counts as `high` and fails unless `deps-allowlist.json` lists its `PYSEC-…`, `GHSA-…` or `CVE-…` id |
| quick tier | `vitest run --changed`, Biome on changed files | `uv run ruff check <changed .py files>`, `uv run pytest --testmon` (pytest-testmon) or the tests under the changed paths |
| `commands.verify`, `verifyQuick` | `pnpm verify`, `pnpm verify --quick` | `node scripts/dev/verify.ts`, `node scripts/dev/verify.ts --quick` with the steps above in `verify.full` and `verify.quick` |
| `commands.land`, `commit`, `status`, `newAdr` | `pnpm land`, `pnpm wt:commit`, `pnpm wt:status` | `node scripts/dev/land.ts`, `node scripts/dev/wt.ts commit`, `node scripts/dev/wt.ts status`; unchanged, since `land` only runs git and the configured `verify` |
| `commands.ratchets`, `commands.findings` | `node scripts/dev/ratchets.ts`, `node scripts/dev/findings.ts` | unchanged |

Wrap the steps in one entry point (`make verify`, `just verify`, `tox -e verify`, a script) and put that in
`commands.verify`. A bare `make verify: lint test` cannot meet the §2 guarantee (one line per step, the tail of each
failure, logs on disk): a wrapper script is required. A pilot's shape was about 110 lines: run the steps, print one
line each, 40-line tails, a logs directory, and `--quick`. The docs test (links, cited paths, structure in its index) is stack-independent: a
small script in any language.

## 5. Agents without hooks or plugins

Codex, Cursor, Aider, CI runners and anything else that does not load Claude Code plugins get the same protocol
through files: they read `AGENTS.md`, and the project's `AGENTS.md` (template:
[templates/AGENTS.md](templates/AGENTS.md)) states the session protocol they must follow by hand:

1. **Start:** work in a dedicated worktree and branch (`git worktree add ../<repo>-<task> -b <task>`), then run
   `hooks.sessionStart` yourself; if `hooks` is absent, run `commands.setup` (level 1 or above) or nothing.
2. **Iterate:** `verifyQuick` after each meaningful change. With `commands.leases`, run `claim <globs> --intent
   "<why>"` before editing and `renew` before you stop: without hooks nothing does it for you, and an exclusive zone
   is respected only if you check it (`list`).
   Run `commands.overlap` (if present) every few commits: there is no `PostToolUse` notice without the hook.
3. **Before stopping, every time:** commit (there is no `wip:` safety net without the Stop hook), with
   `Assumption: <what> — <why>` trailers for decisions taken without asking.
4. **Finish:** full `verify`, an independent review (the prompts in `agents/` work as plain system prompts), then
   `land` or a PR.

Keep one source of rules: `AGENTS.md` either points to `CLAUDE.md` or is a symlink to it.

## 6. Conformance checks

`/swarm:adopt --check [level]` runs these checks, reports each one as pass or fail with its evidence, and changes
nothing. A level is adopted only when it and every level below it pass. Agents without the plugin can run the same
list by hand.

| Id | Check | Pass when |
|---|---|---|
| L0.1 | Manifest | `swarm.json` parses; `protocol`, `version`, `level` present. |
| L0.2 | Agent memory | `CLAUDE.md` exists, is under 200 lines and names the verify command. |
| L0.3 | Secrets | `.claude/settings.json` denies reading `.env*` and secret files. |
| L0.4 | Local files ignored | `git check-ignore CLAUDE.local.md .claude/settings.local.json` matches both. |
| L0.5 | Decision log | `docs/adr/` holds at least the adoption ADR. |
| L0.6 | Rules have mechanisms | every rule in `CLAUDE.md` ends with `(enforced: <path>, …)` or `(preference)`, every enforced path exists, and the docs test checks both (once it exists, level 2). |
| L1.1 | Full gate | `commands.verify` exits 0 on a clean checkout of the integration branch. |
| L1.2 | Quick gate | `commands.verifyQuick` exits 0 and is faster than the full gate. |
| L1.3 | CI parity (CI ⊇ verify) | CI runs `commands.verify` (or exactly its steps) plus any extra jobs, each documented with why it is not in local verify; no step in the gate path may use `continue-on-error`. |
| L1.4 | Coverage floor | a threshold is configured and enforced by the test step. |
| L1.5 | No secrets in CI | the quality job reads no secrets. |
| L1.6 | Ratchets | Level 1: `quality-ratchets.json` exists and covers file size, coverage gap and lint budget; `verify` runs the check; nothing is loosened compared with the integration branch. Level 2 adds: `land` tightens it and commits only that file. |
| L1.7 | Dependency gate | `deps-allowlist.json` exists, parses, and every entry has a reason, an owner and an unexpired `expires`; a dependency audit exists (`scripts/**/deps-audit.*`, or CI, `package.json`, Makefile or pyproject naming `npm`/`pnpm audit`, `pip-audit`, `cargo audit`, `govulncheck` or `osv-scanner`); its run inside `verify` shows in L1.1's output. |
| L1.8 | Formatter | a formatter is configured and not disabled (`biome.json` formatter, prettier, ruff/black, rustfmt, gofmt) or a format step is named in CI, `package.json`, Makefile or pyproject; `verify` runs the check in both tiers (L1.1). |
| L1.9 | Silent errors | `quality-ratchets.json` has a `silentErrors` section (`dirs`, `exceptions`, `total`) and the total only goes down; a new `catch {}` that neither throws, calls nor uses its binding fails `ratchets`. |
| L2.1 | Worktrees | the worktree directory is gitignored; the session start hook or §5 step 1 is documented. |
| L2.2 | Session commands | `commands.commit`, `status` and `land` resolve to existing scripts. |
| L2.3 | Protected integration | a `pre-push` publisher guard is installed (`git config core.hooksPath`) or branch protection is on. |
| L2.4 | Invariants as tests | an architecture test exists and runs inside `verify`. |
| L2.5 | Docs as tests | a docs test runs inside `verify` and checks both directions: links, cited paths and functions exist; every module, package or app, CLI command, extension guide (docs index) and ADR (ADR index) is documented; every invariant id in the table has a test and every tested id is in the table; prose uses one invariant numbering (no `INV-1` for `INV-01`). |
| L2.6 | Non-Claude agents | `AGENTS.md` exists and states the §5 session protocol, or points to `CLAUDE.md` which does. |
| L2.7 | Review gate | `land` requires a passing review receipt per `review.mode` (default `sensitive`) and the `review` skill writes receipts: a change touching a sensitive path, with no receipt, is refused with "run /swarm:review". In PR mode, a required review by CODEOWNERS in which the reviewer attaches the `reviewer` agent's report counts as the receipt, and the `review-gate` status (template `templates/github/workflows/review-gate.yml`) is a required check: every requested reviewer answered (bots within `review.pr.botTimeoutHours`) and no review thread is unresolved. |
| L2.8 | Findings ledger | the ledger at `findings.file` exists and every line parses (id, severity, status, `opened`, `sla_due`); every open HIGH has an `owner` and an `sla_due`; `findings.sla`, if present, gives positive days for the three severities. |
| L2.9 | Closure gate | `commands.findings` resolves to an existing script, and `land` enforces the SLA gate and the closure quota (structure only: the land log, when it exists, shows `closes` on its latest `landed` entry). |
| L2.10 | Mutation smoke | a `mutation-smoke.*` script exists under `scripts/` and runs as a serial step of the full tier (L1.1); `--mode fail` on a file whose tests cannot fail exits 1 (proven by the reference self-tests). |
| L3.1 | Roadmap | a roadmap file exists and its validator runs inside `verify`. |
| L3.2 | Audit | `commands.audit` runs offline and exits 0. |
| L3.3 | Fresh audit | the latest audit report is under 14 days old. |
| L3.4 | Scheduled review | a scheduled review exists (CI workflow or a `/schedule` routine named in `CLAUDE.md`). |
| L3.5 | Conflict-free ADRs | new ADRs are drafts numbered at integration time. |
| L3.6 | WIP limit | the active changes in the changes directory are at most `roadmap.maxActive` (default 12); the roadmap validator inside `verify` also fails a change with no task ticked for `roadmap.staleDays` (default 14) unless its proposal says `parked: <reason>`. |

Output format:

When the ledger exists, a headline line follows the first one at any level: `closure: open 12 · overdue 2 · median age 9d ·
closure 0.6` (open findings, how many are past their SLA, median age of the open ones, closed / opened over the last
14 days). It is information; only L2.8 and L2.9 can fail.

```text
swarm check · level 1 · protocol 0.4.0
closure: open 12 · overdue 2 · median age 9d · closure 0.6
✓ L0.1 Manifest            swarm.json ok (level 0)
✓ L0.2 Agent memory        CLAUDE.md 142 lines, names "make verify"
✗ L1.3 CI parity           .github/workflows/ci.yml runs "pytest" but not "make verify"
result: level 0 conformant; level 1 blocked by L1.3
```

### Transferability (X1–X5)

`/swarm:adopt --check transfer` runs these checks ([chapter 18](manual/18-transferability-and-handover.md)). They
are a separate track, independent of levels 0–3: a project at any level may run them, and none of them raises
`level`. **All five are required before a project is declared "absorbable"**, that is, ready to be handed to another
team (checklist: [checklists/handover.md](checklists/handover.md)). X1–X5 are unrelated to the T0–T3 land tiers of
manual chapter 12.

| Id | Check | Pass when |
|---|---|---|
| X1 | Fresh clone | `commands.setup` exists and meets §2; a scheduled CI job (template `templates/github/workflows/fresh-clone.yml`) runs setup and `verify` on a clean runner with no caches, and its latest run is green and under 14 days old. |
| X2 | New-agent test | `docs/handover/reference-task.md` exists with an acceptance command; the latest new-agent test report (artifact of `templates/github/workflows/new-agent-test.yml`, or a copy in `docs/handover/reports/`) is under 30 days old with verdict `pass`. |
| X3 | Explicit ownership | `CODEOWNERS` (root, `.github/` or `docs/`) has a catch-all owner and team handles; `docs/runbook.md` covers deploy, rollback, secrets rotation, alerts, on-call, scheduled jobs and known failure modes; `docs/dependencies.md` lists every external service with owner, payer, secrets, failure mode and rotation. No template placeholders (`<…>`) left. |
| X4 | No hidden knowledge | the latest audit (under 14 days old) reports the hidden-knowledge count (manual chapter 18 §d: env vars missing from `.env.example`, external services missing from the inventory, scheduled jobs missing from the runbook, active work without a change) as zero, or every item has an owner and a date. |
| X5 | Handover checklist | `docs/handover/checklist.md` exists, copied from the protocol's checklist, and names the current owning team. |

```text
swarm check · transfer · protocol 0.4.0
✓ X1 Fresh clone           fresh-clone.yml green 2026-10-26 (2 days)
✗ X2 New-agent test        last report 2026-09-14 (44 days), verdict pass
✓ X3 Explicit ownership    CODEOWNERS 14 rules · runbook 7/7 sections · dependencies 6 services
✓ X4 No hidden knowledge   audit 2026-10-20: 0 items
✓ X5 Handover checklist    docs/handover/checklist.md · owner @acme/billing
result: not absorbable; blocked by X2
```

## 7. Worked examples

**Adopting in a Python service** (one level per session, `/clear` between them):

```text
> /swarm:adopt 0 --plan
  stack: Python 3.12 (uv), pytest, ruff; CI: GitHub Actions; scenario D (team reviews by PR)
  will write: swarm.json (verify = "make verify"), CLAUDE.md (merged with the existing one), .claude/settings.json,
              docs/adr/draft-adopt-agentic-coding-swarm-protocol.md
  will not adopt: local land (PR mode instead), pre-push publisher (branch protection instead)
> /swarm:adopt 0            → files written, /swarm:adopt --check 0 all green, one commit
> /swarm:adopt 1            → Makefile verify target, CI calls it, coverage floor at measured − 1, --check 1 green
> /swarm:adopt 2            → worktrees, PR-mode land, import-linter contracts, docs test, AGENTS.md, --check 2 green
```

**A daily session in an adopted repo:**

```text
claude -w fix-invoice-rounding          # own worktree; sessionStart hook installs deps, assigns ports
… write the failing test, fix, verifyQuick …
/swarm:verify                           # full gate, evidence in the reply
reviewer agent                          # independent review of the diff
/swarm:land                             # serialized integration, or a PR in PR mode
```

## 8. Versioning

`swarm.json` carries the protocol version the project follows; the plugin carries its own in
`.claude-plugin/plugin.json`. Minor versions add checks or optional keys; a major version may change a command's
guarantees and ships with a migration note in [CHANGELOG.md](CHANGELOG.md). `/swarm:adopt --check` reports when the
project's protocol version is behind the plugin's.
