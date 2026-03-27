# Public Proforma Excel Connection

Use the exported workbook copy after the app has created a proforma run and downloaded the file with the hidden `run_id` already stamped.

## 1. Create a read-only database user

In Supabase, create a dedicated Postgres user for Excel refreshes. Do not use the service role.

Grant read access only to:

- `public.proforma_excel_inputs_v1`
- `public.proforma_excel_data_drop_v1`
- `public.proforma_excel_coa_translation_v1`

## 2. Use the master workbook template

Open `templates/PublicProformaTemplate3.18.master.xlsx` in Excel Desktop.

The workbook includes:

- a hidden `DB Config` sheet
- cell `B2` with the `run_id` placeholder
- the workbook-level name `proforma_run_id`

The app export route replaces that placeholder for each run before download.

## 3. Create the Power Query parameter

In Excel Power Query:

1. Create a new blank query.
2. Read the named cell from the workbook:

```powerquery
let
  RunIdTable = Excel.CurrentWorkbook(){[Name="proforma_run_id"]}[Content],
  RunId = Text.From(RunIdTable{0}[Column1])
in
  RunId
```

Name this query `RunId`.

## 4. Connect to Supabase Postgres

Use Excel's PostgreSQL connector with:

- Server: your Supabase Postgres host
- Database: `postgres`
- Authentication: the read-only user created for Excel
- SSL: required

## 5. Build the three workbook queries

Create these Power Query objects:

- `ProformaInputs`
- `ProformaDataDrop`
- `ProformaCoaTranslation`

Example pattern:

```powerquery
let
  Source = PostgreSQL.Database("YOUR_HOST", "postgres"),
  RunInputs = Value.NativeQuery(
    Source,
    "select * from public.proforma_excel_inputs_v1 where run_id = ?",
    { RunId }
  )
in
  RunInputs
```

Repeat for:

- `public.proforma_excel_data_drop_v1`
- `public.proforma_excel_coa_translation_v1`

## 6. Load into the workbook

- Load `ProformaDataDrop` into the `Data Drop` tab.
- Load `ProformaCoaTranslation` into the `COA Translation` tab.
- Load `ProformaInputs` into a hidden staging tab, then link the visible `Inputs & Drivers` cells to that table.

Recommended visible cell links:

- `Inputs & Drivers!E5` -> property name
- `Inputs & Drivers!E6` -> property type
- `Inputs & Drivers!E7` -> property address
- `Inputs & Drivers!E8` -> units available
- `Inputs & Drivers!E9` -> units occupied
- `Inputs & Drivers!E10` -> NRSF
- financing and exit assumptions -> the corresponding fields from `proforma_excel_inputs_v1`

## 7. Refresh behavior

V1 is manual refresh.

After downloading a workbook from the app:

1. Open the file in Excel Desktop.
2. Confirm the `run_id` in the hidden config sheet was populated.
3. Click `Refresh All`.

The workbook should then pull the normalized rows and reviewed inputs for that run.
