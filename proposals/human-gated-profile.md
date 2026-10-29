# Proposal · a human-gated profile: install the plugin where a person commits and a person merges

Status: **proposed**, not implemented. Each item below is meant to be its own pull request with its self-test or eval.

## Context

An adopting project (an agentic accounting system; 1–2 people; Claude Code sessions in worktrees; OpenSpec; GitHub
pull requests; npm and `node --test` today, Python next) reviewed v0.1.0, adopted levels 0–1 and the level-2
invariant tests by hand, and did not install the plugin. It re-reviewed `v0.4.0` and wants the plugin as its
development harness. Its rules: commit, push and open a PR only when a person asks; nothing reaches `main` except
through a PR a person merges; some untracked paths hold data that must never be committed.

The plugin is already close: in a repository without `swarm.json` the session hooks do nothing
([INTEGRATION.md §3](../INTEGRATION.md)), and every command a hook runs comes from the project's manifest. What
collides are the **defaults** in the template and in the skills.

## Evidence

| # | What happens with the defaults | Where |
| --- | --- | --- |
| E1 | The `Stop` hook commits after every turn: `git add -A` and `git commit --no-verify`, amending its own `wip:` | `hooks.stop` in `templates/swarm.json` → `wip()` in `reference/scripts/wt.ts` |
| E2 | `git add -A` stages every untracked file not in `.gitignore`: one missing ignore line puts data or a secret in a commit, and `--no-verify` skips any pre-commit secret scan | `wip()` in `reference/scripts/wt.ts`; `dirtyPaths()` in `reference/scripts/git.ts` |
| E3 | PR mode always means "a PR with auto-merge"; there is no option for a person to merge | `skills/land/SKILL.md` (introduction) |
| E4 | `audit-repo`, read-only by its own rule 1, ends by committing its report and landing it | `skills/audit-repo/SKILL.md` (step 5) |
| E5 | `hooks.gateEdit` defaults to `warn`, so an agent can edit `swarm.json`, whose strings the hooks run with `sh -c`; it is caught only at `land` or review | `hooks/swarm-hook.sh` |
| E6 | The install commands track the default branch, which moves several times a day | [README.md](../README.md) (Install) |
| E7 | When a `commands.*` key is missing, the skills fall back to `pnpm …`; in an npm or uv repository that is a wrong command, not "no tooling" | `skills/land/SKILL.md` (introduction) |

## Proposals

| # | Change | Default | Check |
| --- | --- | --- | --- |
| P1 | The `Stop`-hook commit becomes opt-in: `hooks.wip: "off" \| "local"`, and the template's `hooks.stop` no longer calls `wt wip` | `off` (`local` = today) | `wt.test.ts`: with `off`, Stop leaves the tree dirty and creates no commit |
| P2 | `wip` stages tracked files only (`git add -u`) plus an explicit `wip.include` glob list, and drops `--no-verify`; a hook rejection is reported and the tree is left as is | include = none | `wt.test.ts`: an untracked `secret.txt` is not in the `wip:` commit |
| P3 | PR mode without auto-merge: `land.pr.autoMerge`; `false` opens the PR, prints its URL and stops. `templates/claude/settings.json` adds `Bash(gh pr merge*)` to `ask` | `true` (= today) | `land.test.ts` with a fake `gh`: no `--auto` |
| P4 | `audit-repo` ends at the report and the ledger lines; it commits and lands only with `--land` or when the person asks | no commit | trigger eval "run the audit" → no commit |
| P5 | Safer gate defaults: template `gateEdit: "ask"`; `swarm.json` and `.claude/settings.json` are always `block`, whatever the mode | `ask` | `swarm-hook.test.mjs` |
| P6 | Pinned install: the README and INTEGRATION show the install pinned to a release tag and say to update by PR; `adopt` records the pinned version | — | documentation only |
| P7 | A missing `commands.*` key means "say so and follow `CLAUDE.md`" or detect the package manager from the lockfile; never a guessed `pnpm` | — | eval on an npm fixture without `swarm.json`: no `pnpm` call |
| P8 | Optional `adopt --preset human-gated` writes P1–P5 at once (scenario D with a person merging) | — | `check-conformance` on the preset |

Order: P1 + P2, P3, P5, P4, P6, P7, P8. P1–P3 change defaults; existing adopters keep today's behavior by setting
`hooks.wip: "local"` and `land.pr.autoMerge: true`, which the CHANGELOG entry of each release will say.

## How we will know it worked

The adopting project installs the plugin with the preset and tracks, for its first two weeks, commits and pushes
nobody asked for (target 0) and edits to gates or `swarm.json` that reached a PR without a person's approval
(target 0). It reports back as an adoption report.

## Alternatives

- **Do nothing.** Each cautious team writes its own `swarm.json` by hand, and a missed key (E1, E3) still commits or
  merges on its own.
- **Document the safe manifest only.** Cheaper, but E2, E4 and E7 live in scripts and skills, not in the manifest.
