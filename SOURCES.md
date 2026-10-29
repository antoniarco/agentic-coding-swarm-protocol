# Sources

## Reference project (internal, anonymized)

- Repository rules for agents (`CLAUDE.md`), README, quality guide, architecture document (kernel and invariants
  sections), scaling notes and documentation index.
- Architecture decision records on resumable execution (ADR-0014), the multi-session flow (ADR-0026), resource
  hygiene (ADR-0060), compiled skills and per-output checks (ADR-0065), the memory guard (ADR-0066), the periodic
  audit (ADR-0076) and the single integration workstation (ADR-0081).
- Development-flow scripts (verify, land, worktree management, git and remote helpers, process reaping, ADR
  numbering, audit, roadmap, test temp files, playground), the `pre-push` hook, the shared Claude Code settings and
  the CI workflow.
- Test configuration (coverage floor, sequencer, temp-file cleanup), the architecture and documentation tests, the
  linter and TypeScript base configuration.
- OpenSpec configuration, roadmap, a periodic audit report, and the changes that introduced the dev panel, land
  tiers and problem briefs.
- Internal product requirement documents on the multi-session flow and autonomous development.
- The project's audit skill and its `builder`, `reviewer` and `architect` agents.
- The tech lead's context policy and tmux session guide for the integration workstation.

## External

- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — deterministic vs
  non-deterministic, short `CLAUDE.md`, checks, hooks, permissions, subagents, unattended runs, what is no longer
  needed.
- [Hooks reference](https://code.claude.com/docs/en/hooks) — events, exit codes, structure in settings.
- [Skills](https://code.claude.com/docs/en/skills) — frontmatter, invocation, progressive disclosure, descriptions.
- [Subagents](https://code.claude.com/docs/en/sub-agents) — format, fields, when to use them.
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — Anthropic Engineering.
- [Trunk Based Development](https://trunkbaseddevelopment.com/) — short-lived branches, CI, flags, branch by
  abstraction.
- [MADR](https://adr.github.io/madr/) and [adr.github.io](https://adr.github.io/) — ADR templates, statuses, file
  naming, the "Confirmation" field.
- [AI Coding Anti-Patterns](https://getunblocked.com/blog/ai-coding-anti-patterns/) — the three levers (cost,
  production, autonomy) and seven anti-patterns.
- [AI coding agents kill team collaboration](https://leaddev.com/ai/ai-coding-agents-kill-team-collaboration) —
  LeadDev, review by the same person.
- [Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)
- [Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html) — Google Testing Blog.
- [Mutation testing for AI-generated code](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code) and
  [Coverage lied, mutation testing told the truth](https://dev.to/newellpaul/coverage-lied-mutation-testing-told-the-truth-4f8g)
- [Git worktrees for parallel AI coding agents](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents)
  and [Parallel AI agent workflows with git worktrees](https://dev.to/dublecc/parallel-ai-agent-workflows-with-git-worktrees-the-concrete-pattern-59lp)
- [Fitness functions and architecture tests (ArchUnit demo)](https://github.com/tiarebalbi/archunit-demo)


Figures from third-party sources (vendor blogs) are cited as indicative, not as a standard.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — Anthropic
  Engineering; workflows versus agents and the pattern ladder (chapter 19).
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) —
  Anthropic Engineering; cost of orchestrator-workers.
- [Why Do Multi-Agent LLM Systems Fail? (MAST)](https://arxiv.org/abs/2503.13657) — Cemri et al., 2025; failure
  taxonomy of multi-agent systems.
- [Defeating Prompt Injections by Design (CaMeL)](https://arxiv.org/abs/2503.18813) — Debenedetti et al., 2025; a
  barrier outside the model with provenance.
- [Agent2Agent (A2A) protocol](https://a2a-protocol.org/) and [Model Context Protocol](https://modelcontextprotocol.io/)
  — agent-to-agent and agent-to-tool standards.
- [CloudEvents 1.0](https://cloudevents.io/) and [CEL](https://cel.dev/) — event envelope and declarative checks.
- [Hexagonal architecture](https://alistair.cockburn.us/hexagonal-architecture/) — Alistair Cockburn.
- [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final) and
  [SP 800-57 Part 1](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final) — GCM limits and cryptoperiods.
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/) and the
  [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html).

## Skills and agents

- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) — frontmatter (`tools`, `disallowedTools`,
  `model`, `color`, `maxTurns`), "use proactively" in descriptions, fields plugin agents ignore. Used for every agent.
- [claude-code-security-review](https://github.com/anthropics/claude-code-security-review) — Anthropic's security
  review prompt: diff-only scope, data-flow tracing, confidence threshold, hard exclusions and precedents, exploit
  scenario per finding. Adapted (paraphrased) in `agents/security-reviewer.md`.
- [Claude Code official plugins](https://github.com/anthropics/claude-plugins-official) — `code-review` (validate
  each finding, false-positive list, Opus for bug finding), `pr-review-toolkit` (0–100 confidence with a cut at 80,
  behavioural test coverage, silent-failure hunting), `feature-dev` (decisive architecture blueprint). Shaped
  `reviewer`, `test-auditor` and `architect`.
- [claude-code-action security guide](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) —
  CI agent risks: `pull_request_target`, trigger permissions, tool allowlists, log exposure.
- [obra/superpowers](https://github.com/obra/superpowers) — code-reviewer template (read-only on the checkout, no
  nested reviewers, explicit verdict, list what was set aside) and systematic debugging (no fix before root cause;
  question the design after repeated failed fixes). Shaped `reviewer` and `debugger`.
- [wshobson/agents](https://github.com/wshobson/agents) — hypothesis-driven debugger with confirming and
  falsifying evidence; also a counter-example: long capability lists without a procedure.
- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) — model
  routing and tool sets per role; the docs-drift editor's minimal-edit and no-invention guards (`docs-keeper`).
- [lst97/claude-code-sub-agents](https://github.com/lst97/claude-code-sub-agents) — counter-example: a reviewer on
  a small model with broad tools that asks clarifying questions a subagent cannot get answered.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) and
  [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — prompt injection reaching
  tools, excessive agency, unbounded consumption (agent-specific categories of `security-reviewer`).
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  and [Claude Code skills](https://code.claude.com/docs/en/skills) — third-person "what + when" descriptions,
  `SKILL.md` under 500 lines, references one level deep with a table of contents, copyable progress checklists,
  validate-fix-repeat loops, degrees of freedom (exact commands for fragile operations), frontmatter
  (`disable-model-invocation`, `allowed-tools`, `argument-hint`) and `${CLAUDE_SKILL_DIR}`. Shaped every skill.
- [anthropics/skills](https://github.com/anthropics/skills) — `skill-creator` (Apache 2.0 for the open skills):
  descriptions are the trigger and should name the contexts that must activate the skill; explain the why instead
  of shouting; trigger evals with near-miss negatives. Shaped the descriptions and the plain-sentence gates.
- [obra/superpowers](https://github.com/obra/superpowers) (MIT) — skills `verification-before-completion`,
  `test-driven-development`, `systematic-debugging`, `using-git-worktrees`, `requesting-code-review`,
  `finishing-a-development-branch` and `writing-skills`: evidence before claims, watching the test fail, no fix
  without root cause and escalation after repeated failed fixes, a baseline run before work, reviewers given SHAs and
  the spec but not the session's history, rationalization and red-flag tables, announcing the skill at start, and
  descriptions that state triggers without summarizing the procedure. Adapted, not copied, in `verify`, `tdd`,
  `debug`, `worktree`, `review` and `land`. Deliberate difference: the gates are plain sentences with a reason and,
  where possible, a script or hook behind them (chapter 11, "all-caps rule"), not capitalized iron laws.
- [trailofbits/skills](https://github.com/trailofbits/skills) (CC BY-SA 4.0) — authoring guidelines: a
  "rationalizations to reject" section for audit skills, quoted descriptions when they contain a colon, no hardcoded
  absolute paths. Shaped `audit-repo` and the red-flag tables.
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) and
  [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — surveyed to compare
  structure across popular collections; nothing taken from them.
