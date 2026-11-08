# Upgrade backlog from Chris's other sessions (collected 2026-10-25)

| # | Upgrade | Source session (claude.ai chat) | Target |
|---|---|---|---|
| 1 | Debate/council orchestrator: proposer/skeptic/judge roles, turn-taking, convergence + termination, repetition-collapse (n-gram) detection, order-swapped judge, heterogeneous models vs sycophancy cascades (Du et al. ICML'24, ChatEval) | "Agentic AI OS Blueprint(!!)" e75dfeae (Consciousness tab) | U5 `96-council.js` |
| 2 | Memory stream: {importance 1-10, created, lastAccessed, embedding}; score = recency decay + relevance + importance; reflections when importance sum crosses threshold; handoff note on long sessions; context-rot cap (Park et al. UIST'23) | e75dfeae | U2 `90-brain.js` |
| 3 | Hybrid retrieval: BM25 + embeddings (Transformers.js) fused by reciprocal-rank fusion, WASM fallback | e75dfeae | U2 |
| 4 | Reasoning memory from trajectories (ReasoningBank: success AND failure strategies), Voyager-style "add only after verification" | "AI harness with monitoring UI" f2bc3fd9 (recursive-harness-kit) | U2 + U7 |
| 5 | Eval + tracing: OTel-GenAI-shaped spans (invoke_agent → chat / execute_tool, tokens, cost, latency, finish reason), golden set, pairwise judge with order-swap, regression drift | e75dfeae | U4 `86-traces.js` |
| 6 | Hash-chained audit ledger, spend caps, kill switch, protected controls | f2bc3fd9 (recursive-harness-kit governance, distill-kit ledger) | U4 + U3 |
| 7 | Injection shield: spotlighting/datamarking of untrusted content, dual-LLM/CaMeL-style quarantine, lethal-trifecta guard (private data + untrusted content + exfil channel) | e75dfeae; Agentic AI OS audit rubric 128fc29f | U3 `85-shield.js` |
| 8 | Autonomy ladder L1→L4 with trust ledger (20 runs / 95% to graduate, auto-demotion) | e75dfeae (Trust Center) | U3 |
| 9 | Secret scanning before data leaves the browser (gitleaks-style rules), redaction | "RIP and replace" c6993148 | U3 |
| 10 | Patch verification before apply (jsdiff), property fuzz (fast-check), acorn AST check | c6993148 | U6 (checkpoint/rewind) + later |
| 11 | Free-provider router: sticky sessions + cooldown from Retry-After (freellmapi), cascade, semantic/exact cache, honest cost-saved accounting (RouteLLM) | f2bc3fd9; e75dfeae §7 | U1 `62-router.js` |
| 12 | Harness-as-files + independent gate before persisting self-edits (harness2, A-Evolve, AHE), strict checkers, held-out acceptance | "Recursive learning harness implementations" 2fd9ac12 | U7 `97-skills.js` (learned-skill approval queue) |
| 13 | Agent Skills format (SKILL.md frontmatter, <500 lines, progressive disclosure, references/) | e75dfeae §8 | U7 |
| 14 | Checkpoints/rewind + branching/forking (Cline, Claude Code, LibreChat/big-AGI), real-folder workspace (File System Access/OPFS) | A11 findings; e75dfeae (real-folder workspace) | U6 `15-checkpoints.js` |
| 15 | Local runtimes on Mac: Ollama (MLX backend), LM Studio, model picks for 24 GB (Gemma 4 26B-A4B, Qwen3.8-27B, Qwen3.5-9B) | "Local AI maximizing on M4 Pro" 36a10f83 | already in 61-free-tiers (local); add presets in U1 |
| 16 | System-1/System-2 split: strong model plans bounded framework, cheap model executes typed choices; loop detection; explainers on every control | "App upgrade with Astra" c3c31f08 (S1 Harness) | U1 (cascade) + U4 (loop detect) |
| 17 | Promotion gate + canary checks for anything that changes behaviour | f2bc3fd9 distill-kit | U7 |
