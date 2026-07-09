# AGENTS.md

This file is the canonical instruction file for agents working in this repository.

General personalization preferences may apply, but this file controls project-specific behavior for this codebase. Follow these instructions before making code, config, test, documentation, or context-file changes.

## Project

You are working on one internal web app: **STORE Internal Platform**.

This repository is a multi-workflow internal operations platform for STORE Management centered on:

- property analysis package generation from Excel to PowerPoint
- historical MSR snapshot ingestion and dashboarding
- owner and investor-facing reporting
- proforma and finance tooling
- accounting and import-prep utilities
- workflow automation and internal document generation

The product goal is operational leverage for internal teams. The app should reduce manual spreadsheet, PowerPoint, PDF, and reporting work while preserving operator trust in the output.

## Core product principles

- Output correctness beats visual cleverness.
- Operator trust beats automation theater.
- Reproducibility beats ad hoc fixes.
- Explicit source mapping beats inferred presentation.
- Internal workflow speed matters, but not at the expense of silent bad output.
- Generated decks, exports, and dashboards must be explainable to a non-engineer who uses them in real work.

## Product scope

This app supports or is intended to support:

- `/pptx-mail` property analysis package generation from uploaded workbooks and templates
- PowerPoint token extraction, normalization, manual fill, image replacement, and export
- historical MSR ingestion, Firebase-backed snapshot storage, and `/dash/t/` dashboard rendering
- investor-facing and internal historical reporting
- finance workflows such as proforma imports, lakehouse-style proforma ingestion, and property package generation
- accounting tooling, statement normalization, and import-prep workflows
- PDF/ZIP-driven automation flows such as `/lsa-automation`
- owner reports, comp sets, automations, and other internal utility workflows exposed from the workflow directory

## Non-negotiable data rules

- Never present derived values as if they were direct workbook, MSR, or uploaded-document truth.
- Never imply a value came from a source file unless the parser or stored snapshot actually produced it.
- If a dashboard value is current month-to-date, say so clearly.
- If a dashboard value is lagged monthly close, say so clearly.
- Never mix MTD and prior-month-close values inside one KPI or ratio unless the UI explicitly describes that mismatch.
- Never silently fall back from extracted data to guessed data without making the fallback path explicit in code.
- PPT token values must preserve clear provenance where possible:
  - extracted from workbook
  - derived from workbook values
  - manual input
  - template/static
- When parsing workbooks or PDFs, prefer direct source cells/labels over custom interpretation.
- If a workbook layout changes, extend the parser deliberately. Do not fake missing values in the UI.

## Architecture rules

- Keep business logic out of React components.
- Put parsing, extraction, mapping, formatting, and token logic in typed utilities under `src/lib/`.
- Keep clear boundaries between:
  - upload/parsing
  - domain transformation
  - dashboard/report formatting
  - file generation/export
  - persistence and API access
- Prefer extending existing utilities for:
  - workbook parsing
  - dashboard snapshot shaping
  - PPT token mapping
  - print/report rendering
  rather than creating parallel one-off paths.
- When a route has both screen and export/print behavior, keep those render paths explicit and separate.
- Avoid duplicating the same extraction rules across routes. Shared source mapping belongs in one typed place.

## System design priorities

### 1. Workbook and document fidelity

Excel, PDF, PowerPoint, and snapshot workflows must prioritize faithful extraction.

Requirements:

- Prefer direct cell or anchored-label extraction over heuristic math.
- Keep workbook-version handling explicit when templates drift.
- Normalize malformed template tokens only in one place.
- Separate extracted values from manual values from derived values.
- Avoid hidden formatting conversions that can erase meaning, signs, or zero values.

### 2. Historical snapshot integrity

Historical dashboard code must preserve month identity and timing semantics.

Requirements:

- Distinguish MTD values from prior-month-close values.
- Keep snapshot models typed and stable.
- When showing comparisons, ensure both sides use the intended time basis.
- Do not let UI formatting conceal lagged data behavior.

### 3. Export and presentation reliability

Generated outputs must be predictable and safe to send externally.

Requirements:

- PowerPoint output must resolve tokens deterministically.
- Print/export views must favor lightweight, reliable output over visual parity with the live UI.
- Reports must degrade gracefully when some sections lack data.
- Manual unresolved fields must be visible to the operator before export.

### 4. Internal workflow maintainability

- Favor maintainable internal tools over bespoke page-by-page hacks.
- Reuse the workflow directory and established route patterns.
- Keep admin/dev-only behavior explicit and gated.

## Required engineering discipline

- Always edit the real codebase.
- Never provide pseudocode as a substitute for implementation.
- Do not use `any`.
- `any` is forbidden unless the user explicitly approves a temporary exception or there is a proven external typing gap that cannot be solved cleanly at the boundary.
- Before considering `any`, prefer:
  - stricter model types
  - discriminated unions
  - typed parser outputs
  - `unknown` with narrowing
  - schema validation
  - explicit transform layers
- Never use `any` to paper over parser uncertainty or route mismatches.
- Keep types strict at file, API, parser, and persistence boundaries.
- Do not silently widen types to make compile errors disappear.
- If a route or parser is wrong, fix the source logic instead of adding UI workarounds.
- Do not leave half-migrated extraction paths in place unless there is a deliberate compatibility reason.

## React and hook discipline

- Do not use `useEffect` by default.
- `useEffect` is allowed only for real external side effects, such as:
  - subscriptions
  - timers
  - browser print lifecycle handling
  - client-side network synchronization that truly belongs on the client
  - cleanup tied to component lifecycle
- Do not use `useEffect` for:
  - derived display values
  - parser output reshaping
  - workbook/dashboard calculations
  - KPI comparison math
  - simple prop-to-state sync
- For dashboard and reporting UIs, prefer pure derivation, `useMemo`, or typed helpers in `src/lib/`.

## UI and UX rules

- Keep UI clean, quiet, and readable.
- This is an internal operations product, not a consumer-marketing site.
- Prioritize fast comprehension over decorative complexity.
- If a number is MTD, lagged, unresolved, manual, stale, missing, or derived, label it plainly.
- Avoid duplicate indicators, ambiguous chips, and ornamental visuals that make operational meaning harder to read.
- For print/export screens, prioritize reliability and readability over matching the interactive screen exactly.
- Generated-output workflows should surface unresolved inputs and mismatches before export, not after.

## Parsing, token, and reporting rules

- Token extraction and mapping must be deterministic.
- Token labels, workbook anchors, and parser assumptions must be centralized when possible.
- Do not hard-code workbook layouts if the codebase already supports dynamic detection.
- Do not present a manually entered token as extracted.
- If a template token is malformed, either normalize it centrally or fail clearly.
- Dashboard ratios and comparisons must use the correct time basis on both numerator and denominator.
- Avoid adding UI explanations that contradict the underlying parser logic.

## Excel parsing rules

- Never make up workbook cells, ranges, labels, month mappings, or sheet coordinates.
- Never invent a source cell because the expected value is obvious from the rendered output.
- Never introduce hard-coded workbook cell addresses, row numbers, column indexes, month headers, or token values unless the user explicitly asks for a fixed mapping or the template is truly fixed and documented as such in code.
- Prefer anchored label lookup, detected table structure, explicit sheet-layout parsing, and typed layout helpers over raw positional assumptions.
- If a workbook version changes, extend the existing parser system to detect the new layout instead of creating a second unrelated parsing path for the same workbook family.
- Keep Excel parsing systems uniform across the repo:
  - prefer extending the established parser/utilities in `src/lib/`
  - avoid adding a new one-off parsing style for a workflow that is materially the same kind of Excel extraction task
  - if a new parsing abstraction is needed, it must replace or clearly subsume the old pattern rather than coexist as a parallel system without a good reason
- When multiple workflows parse similar spreadsheets, centralize shared helpers for:
  - label normalization
  - numeric coercion
  - sheet lookup
  - dynamic row/column detection
  - formatting/provenance handling
- If a value cannot be extracted confidently from the workbook, leave it unresolved, manual, or explicitly derived. Do not backfill it with guessed coordinates.
- For Excel-driven outputs, the parser is the source of truth. UI components should not compensate for weak extraction by inventing fallback values.

## Background jobs and automation rules

- PDF processing, workbook parsing, export generation, scraping, and normalization flows must run through clear server-side paths.
- Avoid fire-and-forget behavior for important export or automation workflows.
- Long-running or failure-prone flows should expose enough state to explain what happened to the operator.
- If a workflow stalls or appears stuck, improve visibility first and reduce output complexity if needed.

## Testing and reliability expectations

- Add or update tests for non-trivial:
  - workbook parsing
  - token mapping
  - dashboard calculations
  - print/export behavior
  - normalization utilities
  - PDF/statement extraction
- Do not rely on manual UI inspection alone for parser or token correctness.
- When fixing workbook-template drift, add a regression test if the repo already has parser tests nearby.
- When changing dashboard timing semantics, verify the label and the underlying number use the same basis.

## Code quality standards

- Keep files cohesive.
- Split mixed-responsibility files when they become difficult to reason about.
- Prefer explicit names over generic names.
- Avoid hidden fallback logic.
- Avoid copy-pasted parser branches for near-identical workbook sections.
- Centralize repeated token IDs, sheet labels, or extraction paths when they are true project-wide rules.
- Do not add convenience shortcuts that hide whether a value is extracted, derived, or manual.

## Comments

Comments should be rare but useful.

Use comments to capture things another engineer could easily miss or accidentally break, including:

- workbook layout assumptions
- why a token fallback exists
- print/export lifecycle constraints
- month-basis rules for dashboard metrics
- parser invariants
- integration or file-format edge cases
- operator-trust constraints

## Output behavior

- Do not send code in chat unless the user asks for it.
- Make changes directly in the real codebase when tools allow it.
- If tools do not allow direct edits, provide precise file-level instructions or patches.
- Never claim a file was changed unless it was actually changed.

## Decision rule

When choosing between a faster-looking UI and a more trustworthy extraction/reporting path, choose the more trustworthy path.

When choosing between preserving a flashy export visual and producing a reliable printable output, choose the more reliable output.

## Final implementation bias

Prefer:

- direct extraction over interpretive math
- explicit source mapping over UI guessing
- strict typing over escape hatches
- lightweight print/export output over heavyweight preview failures
- deterministic utilities over inline component logic
- clear labeling over compressed but ambiguous KPI wording

## Context and logs

- If `src/context/agent-update-log.txt` exists, review it before making changes.
- If a task materially changes architecture or data-flow decisions, document the change or create the log file if it is missing.
- For every material agent-made code, config, test, documentation, or context-file update, append a concise factual entry to `src/context/agent-update-log.txt` with:
  - date
  - agent/session
  - files touched
  - summary
  - validation run
  - known follow-ups
- Keep the log factual and brief.
- For the same material update, increment the app version in `package.json` and `package-lock.json` as part of the change.
- Use conservative semver-style sizing:
  - patch for bug fixes, small workflow adjustments, safe config changes, internal process changes, and other low-risk maintenance updates
  - minor for new user-facing features, new workflows, material enhancements, and new integrations
  - major only for breaking changes, large overhauls, or data/model migrations with compatibility impact
- Do not add multiple version bumps for one task. Choose one bump that matches the net impact of the completed change.
- Tiny copy, label, text, formatting, or no-op cleanup changes do not need an update-log entry or version bump unless they are part of a larger material change.
- When a version is bumped, mention the new version in the update-log entry summary or follow-ups.

### Update log page (`/updatelog`)

- The `/updatelog` route at `src/app/updatelog/page.tsx` reads `src/context/agent-update-log.txt` directly at request time and renders every entry as a video-game-style scrollable patch-notes list (newest first).
- Every entry appended to `src/context/agent-update-log.txt` automatically appears on `/updatelog`. Do not maintain a parallel hardcoded list in the page file.
- Preserve the established line format exactly so the parser keeps working:
  - one entry per line, fields separated by ` | ` (space, pipe, space)
  - field order: `date | session | files | summary | validation | follow-ups`
  - within the `files` field, separate paths with `; ` (semicolon, space)
  - do not introduce additional pipes inside a field; rephrase summaries that would need them
- If the log line format must change, update both the parser in `src/app/updatelog/page.tsx` and this section together.
