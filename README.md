<p align="center">
  <img src="https://res.cloudinary.com/storelocal/image/fetch/q_auto,w_282/https://dr2r4w0s7b8qm.cloudfront.net/image_manager_app/Desktop_-_Store_the_Grove-20250930-150318.svg" alt="STORE Management company logo/banner" />
</p>

# STORE Management — Pro Forma Builder

A Next.js + TypeScript web app for generating storage-facility pro formas from Excel templates. It ingests a standardized workbook, validates structure, applies configurable assumptions (Latest, T12Avg, PercentOfRevenue, Growth), previews monthly series, and exports clean Excel outputs. PDF export and Firebase-backed persistence are planned next.

> Status: **Active development (alpha)** — suitable for internal use and iteration.

---

## Table of Contents

- [Features](#features)
- [How it Works (High Level)](#how-it-works-high-level)
- [Excel Template Contract](#excel-template-contract)
- [Assumptions Engine](#assumptions-engine)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Typical Workflow](#typical-workflow)
- [Validation & Error Handling](#validation--error-handling)
- [Type Safety & Linting](#type-safety--linting)
- [Project Structure (minimal)](#project-structure-minimal)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Excel ingest (ExcelJS)**  
  Upload a workbook and auto-map expected named ranges/headers. No hard-coded cell addresses.

- **Auto-detect Facility & Period**  
  Pulls identifiers and reporting window directly from named ranges.

- **Validation**  
  Schema checks for required named ranges and monthly arrays; clear, actionable error messages.

- **Assumptions Engine**  
  - **Latest** (use most recent month)  
  - **T12Avg** (trailing 12-month average)  
  - **PercentOfRevenue** (Opex as % of revenue)  
  - **Growth** (MoM or YoY patterns)
  
- **Monthly Series Preview**  
  Visual + tabular preview before export.

- **Snapshots**  
  Save a scenario state and re-download results. *(Firebase persistence planned.)*

- **Exports**  
  Export to Excel now. *(PDF export planned.)*

- **Generalization**  
  Designed to work across similarly structured Excels; avoids hard-coded numbers and workbook layouts.

- **UI/UX**  
  Clean, Apple-like interface with iOS-style toggles and a “confidence” slider for assumption sensitivity.

---

## How it Works (High Level)

1. **Upload** a standardized Excel template.
2. **Parse** named ranges and monthly arrays, validate structure.
3. **Select** an assumptions recipe (Latest, T12Avg, PercentOfRevenue, Growth).
4. **Preview** facility-level series (revenue, TOI, TOE, NOI).
5. **Export** an output workbook (and save a **snapshot** of settings + results).

---

## Excel Template Contract

The app expects a template at:

```
/templates/STORE_Proforma_v1.xlsx
```

### Required Named Ranges

- `Facility` — string identifier (e.g., *Tempe - Baseline*).
- `Period` — reporting period label or start/end cells (app resolves to a range of months).
- `TOI` — **T**otal **O**perating **I**ncome (monthly array).
- `TOE` — **T**otal **O**perating **E**xpenses (monthly array).
- `NOI` — **N**et **O**perating **I**ncome (monthly array).

> Arrays should be contiguous by month (e.g., 12 cells for T12). If your workbook uses a different length, keep it consistent across TOI/TOE/NOI.

### Sheet & Header Flexibility

- Headers can vary; mapping is done by **named range** lookups, not header strings.
- Avoid merged cells inside named ranges. Keep each named range contiguous.

### Example (conceptual)

| Name     | Ref            | Meaning                        |
|----------|-----------------|--------------------------------|
| Facility | `Setup!B2`     | “Tempe – Baseline”             |
| Period   | `Setup!B3:B14` | 12 months (MM/YYYY)            |
| TOI      | `P&L!C10:N10`  | income per month               |
| TOE      | `P&L!C20:N20`  | operating expenses per month   |
| NOI      | `P&L!C30:N30`  | computed NOI per month         |

---

## Assumptions Engine

Assumptions are applied **per metric** with guardrails against negative and non-sensical outputs.

- **Latest**  
  Uses the last non-empty month as the forward value.

- **T12Avg**  
  Average of the last 12 months.

- **PercentOfRevenue**  
  Applies a percentage to revenue-derived lines (e.g., operating expenses = X% of TOI).

- **Growth**  
  Applies growth rates (e.g., +Y% YoY or Z% MoM). Growth compounds across the series length.

You can stack strategies: e.g., compute baseline with **T12Avg**, then apply **Growth**.

---

## Getting Started

### Prerequisites
- Node.js LTS  
- pnpm, npm, or yarn

### Install & Run

```bash
# clone
git clone <your-repo-url> store-proforma
cd store-proforma

# install deps
npm install
# or: pnpm install | yarn

# dev
npm run dev

# build
npm run build

# start (prod)
npm run start
```

---

## Configuration

> Firebase is optional and only needed if you want **persistent snapshots** (files & user states).

Create `.env.local` at the project root:

```ini
# --- App ---
NEXT_PUBLIC_APP_NAME=STORE Pro Forma

# --- Optional: Firebase (enable persistence for snapshots/files) ---
# When configured, the app will authenticate users and store snapshots + files.
# These are standard Firebase Web v9+ config keys.
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

If Firebase is **not** configured, the app still runs; snapshots are limited to the current session.

---

## Typical Workflow

1. **Upload Template** → `/templates/STORE_Proforma_v1.xlsx` (or a similarly structured workbook).
2. **Auto-Map** → app resolves `Facility`, `Period`, `TOI`, `TOE`, `NOI`.
3. **Validate** → you’ll see clear checks for missing/invalid named ranges.
4. **Pick Assumptions** → choose strategy per metric; tweak the **confidence** slider if applicable.
5. **Preview** → inspect monthly charts/tables for TOI/TOE/NOI.
6. **Export** → download an output Excel. Optionally **save a snapshot** (persisted if Firebase is set).

---

## Validation & Error Handling

- The validator confirms presence & shape of required named ranges and monthly arrays.
- All data operations favor **named ranges** over A1 references to avoid workbook-layout brittleness.
- **Debug logs** are intentionally verbose to help locate faulty ranges, e.g.:
  - `console.log("[excel] Named range 'TOI' resolved to 12 cells", meta)`  
  - `console.log("[validate] Missing named range: 'NOI'")`

---

## Type Safety & Linting

- **TypeScript first**: strong types across UI and data layers.
- **No `any`**: code adheres to `@typescript-eslint/no-explicit-any`.  
  Use `unknown` + safe narrowing or a named type (e.g., `MonthlySeries`).

---

## Project Structure (minimal)

Only the guaranteed path is the template:

```
/templates
  └─ STORE_Proforma_v1.xlsx
```

App code follows a standard Next.js (App Router) layout with feature-oriented modules (UI, parsing, validation, assumptions, export). All data operations are isolated in pure functions to keep the UI simple and testable.

---

## Roadmap

- **PDF export** (matching Excel output and preview)
- **Firebase persistence** for snapshots/files (auth, Storage)
- **Rules versioning** and scenario diffs (compare two snapshots)
- **Stronger generalization**: intelligent detection of non-standard but similar templates
- **Multi-facility rollups** and portfolio-level previews
- **Role-based access** for internal users
- **CI checks** for template compatibility

---

## Contributing

1. Open a draft PR early for feedback.  
2. Keep functions pure and side-effect free where possible (especially parsing/assumptions).  
3. Maintain verbose `console.log` for ingestion/validation/export paths to aid debugging.  
4. Uphold **no `any`** and meaningful type names.  
5. Add minimal unit tests for:
   - Named range resolution
   - Validation failures (missing ranges, wrong lengths)
   - Assumptions application (Latest, T12Avg, PercentOfRevenue, Growth)

---

## License

Add your license here (e.g., MIT, Apache-2.0, or Private/Proprietary). If this is internal only, note that clearly.

---

**Maintainer:** Alex (STORE Management)  
If you run into template mapping issues, start by checking the named ranges listed above and watch the developer console logs for exact failure points.
