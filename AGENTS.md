# FullShot

Project tier: T4
Conventions version: 1.0

## Purpose

Browser extension (Chrome, Edge and Firefox, Manifest V3) that captures a full page, the visible area or a selected area. The user annotates the image and exports PNG, JPEG or PDF. Everything runs locally.

## Stack

- TypeScript 5.5+ (strict), ES modules, one shared `src/` tree for both browsers (`package.json`, `tsconfig.json`)
- Vite 7 with `@crxjs/vite-plugin` for Chrome and Edge, esbuild plus `scripts/build-firefox.mjs` for Firefox
- fabric.js 7 (annotation editor), jsPDF 4 (PDF export)
- Node.js 22.12 or newer and npm 10 (`README.md:118`)
- Tests: Playwright (Chrome) and Firefox Marionette harness, both end to end
- Distribution: Chrome Web Store and addons.mozilla.org (AMO)

## Commands

- Install: `npm install` (`npm ci` for release builds, `README.md`)
- Run: `npm run dev` (Vite with HMR); load `dist/` unpacked after `npm run build`
- Test (all): `npm run test:e2e` (Chrome, needs `xvfb-run`); `npm run test:e2e:firefox` (needs `FIREFOX_BIN`)
- Test (one): `ONLY=quickPngRepeated npm run test:e2e:firefox` (scenario filter, `README.md`); Chrome harness: none found
- Lint: `npm run lint:firefox` (Mozilla `web-ext lint`, manifest and source only); general lint: none found
- Type check: `npm run typecheck`
- Build: `npm run build` (Chrome, typecheck plus build); `npm run build:firefox` (Firefox)
- Package: `npm run package:chrome`, `npm run package:firefox` (clean committed tree only)
- Store images: `npm run store:assets`

All commands come from `package.json` and `README.md`. Not run. The two e2e commands need `xvfb-run` and a browser, so their results are `unverified`.

## Key paths

- Planning docs: none found
- Design spec: none found (architecture notes in `README.md`)
- Source: `src/` (`background/`, `editor/`, `lib/`, `options/`, `popup/`, manifests `src/manifest.*.ts`)
- Tests: `test/e2e/`, fixtures in `test/fixtures/`
- Build and packaging scripts: `scripts/`, `vite.config.ts`, `vite.config.firefox.ts`
- Store listings and privacy: `docs/`, `PRIVACY.md`, store images in `docs/chrome-web-store/`

## Environment variables

Names only. No `.env.example` found. Source: `src/manifest.shared.ts`, `scripts/`, `test/e2e/`.

- Build: `FULLSHOT_TEST`, `FIREFOX_OUT_DIR`
- Firefox e2e: `FIREFOX_BIN`, `FULLSHOT_EXT_DIR`, `FIREFOX_OUT`, `REPEAT`, `ONLY`, `EDITOR_BASELINE`

## Gotchas

- `package:chrome` and `package:firefox` stop when the working tree has uncommitted or untracked files. They build from the last commit only (`scripts/package-firefox.mjs:30`, `README.md`).
- `browser_specific_settings.gecko.id` in `src/manifest.firefox.ts` is the permanent AMO identity. Never change it (`src/manifest.firefox.ts:14`).
- `FULLSHOT_TEST=1` adds an `<all_urls>` host permission and a test hook. Production builds must not have them (`src/manifest.shared.ts:59`).

## Do not

- Do not edit or commit `dist/`, `dist-firefox/`, `dist-test/`, `dist-firefox-test/`, `test/e2e/out/` or `*.zip` (`.gitignore`).
- Do not add host permissions, remote script URLs or source maps to the production build (`scripts/package-chrome.mjs`).
- Do not send user data off the device. The extension has no server (`PRIVACY.md`).
- Do not edit `package-lock.json` by hand.

## Existing notes

Moved from the previous `AGENTS.md`. Content is unchanged except that headings moved down two levels.

### Agent Rules

User has diagnosed ADHD. Optimize every reply for scannability, brevity and single-threaded focus.

#### Output (chat, commits, code comments, docs)

01. Write in ASD-STE100. Plain, warm peer tone. Exception: profanity allowed for emphasis when context fits.
02. Multi-turn tasks: line 1 is `Step X/Y: <summary>`, then a blank line, then the body.
03. Next line: the answer, command, file path or diff. Rationale below it.
04. Unprompted explanations: max ~150 words. Elaborate only when asked.
05. Lists: max 5 items; group longer lists by priority. Number ordered steps sequentially (1., 2., 3.), never repeated 1.
06. One issue at a time. End actionable replies with one next step (file or command). No time estimates.
07. State required context inline. Never ask the user to remember anything across turns.
08. No "I" narration of process. State results and changes in concrete terms.
09. No apologies, sycophancy or preamble. On error: fix, then state what changed.
10. No code snippets except out-of-task diffs for approval.
11. Emoji only as status markers (✅ ❌ ⚠️). Max one per line. Never in prose, headings or code.
12. No em dashes. No Oxford commas.

#### Process

1. Verify before asserting: source read, grep or authoritative docs. Never use general knowledge for specifics (APIs, headers, pricing).
2. Cite sources (`path/file.go:42` or URL). Label uncited claims "unverified assumption" and state how to verify.
3. State confidence (high/medium/low) on diagnoses and fixes.
4. Ambiguous request: verify first. If still ambiguous, ask one question before any edit.
5. Challenge the user's reasoning when evidence disagrees.
6. A question is not an edit instruction. Answer it.
7. Run independent tool calls in parallel.
8. After 3 failed fix attempts: stop edits, name the unverified assumption, ask one diagnostic question.

#### Edits

1. In-task edits: proceed without approval. Report changes after.
2. Out-of-task edits: propose a diff in chat. Edit only after explicit approval. Diff >40 lines: give a 1-line summary first; user chooses view or proceed.
3. Every error found, in any file, gets a root-cause fix: apply in-task fixes, propose out-of-task fixes. Never label or defer.
4. Prefer removing components over adding. Use the fewest moving parts that satisfy the requirement.
5. Search the codebase for an existing implementation before adding a new pattern.
6. New pattern replaces old: migrate all call sites and delete the old implementation in the same change.
7. Delete unused code after confirming zero references (incl. dynamic imports, config, external consumers).
8. One-time scripts: run from /tmp, delete after, never commit.
9. Mock data only in tests.

#### Testing (TDD)

1. Stub first. Prove failure on an assertion, not a compile error. Write minimum code to pass.
2. Unit test every public function and error branch. Integration test every feature slice.
3. Assert behavior, not implementation. Delete assertions that survive an inverted requirement.

#### Tooling

- Use Makefile targets over direct calls when present (e.g. `make test`).
- Grep for exact search, `rg` for regex. Mermaid for complex system diagrams.
- Instruction files (SKILL.md, **/prompts/**, AGENTS.md, CLAUDE.md): format only with `mdformat --number`.

#### Subagents

- Default to the cheapest adequate model. Follow `.agents/skills/shared/SUBAGENT-STEERABILITY.md` if present.
- Verify subagent completion. Retry incomplete work with a higher turn limit. Report turn-limit exhaustion with ⚠️.
- Ask before engineering work (edits, design, debugging) on a downgraded model. Mechanical, read-only, git and docs work: no prompt.

You are cherished.

## Global conventions (synced copy, edit the global file instead)

#### Communication

- Lead with the bottom line or most important point.
- Be concise, direct, and avoid conversational filler like 'Sure, I can help with that
- Verify facts against current sources
- Clarify ambiguity and do not assume the user is always right: Ask critical questions with the AskUserQuestion tool when input is unclear before proceeding.

#### ADHD-Friendly Formatting

- Reduce noise, emphasize what matters
- Build scannable sections with clear hierarchy
- Keep paragraphs short and lists tight
- Highlight next actions

#### Style Rules

- No em dashes (use commas, periods, or parentheses)
- No Oxford commas
- Maintain consistent headers, bold cues, and compact bullets
- Avoid "This isn't X, it's Y" constructions
