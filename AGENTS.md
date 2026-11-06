# Kappal Rewind working instructions

- Read the complete assignment before implementation. The private source is
  `/home/gr00t/Downloads/Assignment_Lohinth_M.pdf`; do not commit it.
  If unavailable, ask for access. Requirements are summarized in PLAN.md.
- Follow the React/TypeScript/Vite → Nginx → FastAPI architecture in docs/DECISIONS.md.
- Work in small, testable phases. Stop at the current user-authorized phase.
- Preserve data/tracks.csv byte for byte; audit before introducing normalization.
- Run meaningful tests after behavior changes and record actual outcomes.
- Group BUILD_LOG by phase and actual IST date, with 4–7 concise evidence-based bullets.
  Preserve significant failures/fixes/results; append factual corrections. The Phase 1
  condensation is a one-time authorized edit whose original remains in Git history.
- Update DATA_AUDIT, DECISIONS, LEARNING_NOTES and AI_USAGE when relevant.
- Use independent data_reviewer for ingestion/audit, replay_reviewer for replay,
  and release_reviewer before delivery. Read their .codex/agents instructions.
  Reviews report evidence and never edit implementation files.
- Prefer explicit data flow and readable functions over unnecessary abstractions.
- Explain significant decisions and how the user can verify each phase.
- Never fabricate features, successful checks, screenshots, or human verification.
- Never commit, push, publish, or send submission email without explicit permission.
