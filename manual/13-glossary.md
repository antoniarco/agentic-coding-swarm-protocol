# 13 · Glossary

| Term | Meaning |
| --- | --- |
| **ADR** | Architecture Decision Record. A short, immutable document with one decision, its context, consequences and alternatives. |
| **Draft ADR** | `docs/adr/draft-<slug>.md`, cited as `ADR-draft-<slug>`; it gets a number when it lands. |
| **Assumption** | Commit trailer (`Assumption:`) recording a decision made without asking, and its reason. |
| **Audit** | Periodic review (every 2 weeks) across five dimensions with deterministic metrics; report in `openspec/audits/`. |
| **AUD-\*** | Stable id of an audit finding across reports. |
| **Change** | OpenSpec unit of work: a folder with a proposal, delta specs, design and tasks. |
| **Deny** | Claude Code permission rule that blocks a tool or path in every mode. |
| **Deterministic / non-deterministic** | What the harness enforces (hooks, deny rules, tests) versus what the agent decides (prompt, `CLAUDE.md`, skills). |
| **E2E** | End-to-end test that starts servers; suffix `.e2e.test.ts`; runs first. |
| **Extension guide** | `docs/extending/<thing>.md`: how to add a kind of component, with a template, required tests and definition of done. |
| **Fast-forward (ff-only)** | Moving a branch forward without a merge commit; requires the branch to be a descendant. |
| **gc / reap** | `wt:gc` deletes worktrees that are landed, clean and have no session; `wt:reap` kills orphaned dev processes. |
| **Hook** | Command that Claude Code runs on an event (`SessionStart`, `Stop`, `PreToolUse`…). `exit 2` blocks. |
| **Invariant (INV-xx)** | Structural rule with an ID, a rationale and a test that enforces it. |
| **Kernel** | Generic part of the core (storage, llm, runtime, policy…) that imports only kernel and schemas. |
| **land** | Integration: rebase, ADR numbering, full verification, fast-forward of `main`, push, gc. |
| **Land lock** | File in git's common directory holding branch and pid; only one `land` at a time. |
| **Append-only log (ledger)** | Event log where a state change is a new event with the same `id`, never an edit; the current state is the last event per `id`; every record carries `schema_version`, and new events carry `actor` (and `run_id` when born in a run). Chapter 17. |
| **Capability / capability registry** | A named, typed operation the system can perform (read, draft, write, publish…). The registry file is the source of truth for names, domain, effect and approval level; code that disagrees with it fails at startup and in a test. Chapter 17. |
| **Evidence ref** | Id of a normalized, stored datum (with source and mode) that a decision cites; a decision without resolvable evidence refs is rejected. Chapter 17. |
| **Write pipeline** | The single path for writes to a published surface: snapshot → write → evaluate → roll back on failure or regression. Chapter 17. |
| **Main checkout** | The original clone of the repo; it holds `main`. Never edited by hand: only `land` moves it. The only place with `.env`. |
| **Playground** | `playground/`: experiments and one-off jobs outside the system; nothing in the system imports from it (tested). |
| **Publisher** | The only machine with the publisher flag set in git config (e.g. `git config <project>.publisher true`); the only one that pushes to `main`. |
| **Quarantine** | Flaky test removed from the gate with a ticket and an expiry date; counted in the audit. |
| **Ratchet** | Threshold that only moves one way: coverage floor, exception lists, debt metrics. |
| **Skill** | `SKILL.md` with a team procedure; only its description is always in context. |
| **Subagent** | Agent with its own context, prompt and tools; it returns a summary. |
| **T0–T3** | Risk tiers of a land, computed from paths; T3 requires human OK (designed). |
| **verify** | The quality gate: `--quick` to iterate, full to finish; identical to CI. |
| **Wave** | Roadmap grouping by goal; dependencies cannot point to a later wave. |
| **wip** | Rolling commit left by the `Stop` hook; `wt:commit` absorbs it; `land` rejects it on its own. |
| **Worktree** | Working copy linked to the same repo, with its own branch; one per session, in `.claude/worktrees/`. |
| **Decision point** | The one component outside the model that recomputes checks, band, permissions and approvals, executes, and never calls the model (chapter 19 §5). |
| **Two-key interaction** | One of four typed agent-to-agent messages (`query`, `task_request`, `delegated_effect`, `subscribe`) allowed only if the sender may send it and the receiver accepts it. |
| **Least authority of the chain** | A receiver acts with the minimum authority along the chain of agents that led to it, never more than the original sender. |
| **Cross-provider judge** | An LLM judge from a different provider than the agent it evaluates; the only kind that counts towards a promotion, after meeting agreement thresholds. |
| **L0–L3** | Autonomy levels per (agent, task), earned through blind audit; launching a new version never raises the level. |
| **Launch gate** | Validation → golden set → cross-provider judge → red teaming → human approval, for every new version of an agent. |
| **Envelope encryption** | Data encrypted with a data key (DEK) that is itself wrapped by a key-encryption key (KEK) per purpose. |
| **Crypto-shredding** | Erasing data by destroying the keys that encrypt it. |
