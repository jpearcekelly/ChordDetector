End-of-session ship routine. Run this before ending a conversation to ensure everything is saved and deployed.

## Steps

1. **Type-check**: Run `cd web && npx tsc --noEmit` — fix any errors before proceeding.

2. **Deploy**: Run `npx vercel --prod` from the `web/` directory. Confirm the deployment succeeds.

3. **Update README roadmap**: Read `web/README.md` and update the roadmap checklist to reflect what was completed this session. Mark items as `[x]` and add new items if needed. Keep descriptions concise.

4. **Commit**: Stage all changed and new files (exclude `.playwright-mcp/`, `.env`, credentials). Write a commit message summarizing the session's work. Push to origin.

5. **Save memories**: Check if any new information was learned about the user's preferences, the project, or feedback that should persist to future conversations. Save to the memory system if so.

6. **Summary**: Report what was shipped, what's next on the roadmap, and any known issues.
