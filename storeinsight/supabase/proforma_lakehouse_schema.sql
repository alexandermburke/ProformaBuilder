create extension if not exists pgcrypto;

create table if not exists public.proforma_uploads (
  id uuid primary key default gen_random_uuid(),
  template_type text not null,
  property_name text,
  report_month date,
  normalized_family text,
  original_file_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  source_format text not null,
  raw_row_count integer not null default 0,
  normalized_row_count integer not null default 0,
  status text not null default 'profiled',
  sheet_names jsonb not null default '[]'::jsonb,
  detected_sections jsonb not null default '[]'::jsonb,
  preview_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.proforma_uploads add column if not exists normalized_family text;
alter table public.proforma_uploads add column if not exists sheet_names jsonb not null default '[]'::jsonb;
alter table public.proforma_uploads add column if not exists detected_sections jsonb not null default '[]'::jsonb;
alter table public.proforma_uploads add column if not exists preview_payload jsonb not null default '{}'::jsonb;

create table if not exists public.proforma_workbook_sections (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.proforma_uploads(id) on delete cascade,
  sheet_name text not null,
  section_key text not null,
  sheet_order integer not null default 0,
  non_empty_row_count integer not null default 0,
  preview_rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists proforma_uploads_template_idx
  on public.proforma_uploads (template_type, created_at desc);

create index if not exists proforma_workbook_sections_upload_idx
  on public.proforma_workbook_sections (upload_id, sheet_order);

create table if not exists public.proforma_runs (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references public.proforma_uploads(id) on delete set null,
  operator_type text not null,
  status text not null default 'draft',
  original_file_name text not null,
  workbook_title text,
  entity text,
  property_name text,
  property_address text,
  report_month date,
  storage_path text not null default 'disabled',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.proforma_property_inputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.proforma_runs(id) on delete cascade,
  input_key text not null,
  input_label text not null,
  value_type text not null default 'text',
  text_value text,
  numeric_value numeric,
  date_value date,
  source text not null default 'manual',
  is_required boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (run_id, input_key)
);

create table if not exists public.proforma_fact_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.proforma_runs(id) on delete cascade,
  actual_budget text not null default 'Actual',
  entity text not null,
  operator_account text not null,
  standardized_coa_name text,
  top_tier text,
  header text,
  account_type text,
  month integer not null,
  year integer not null,
  period_date date not null,
  amount numeric not null,
  source_sheet text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.proforma_coa_mappings (
  id uuid primary key default gen_random_uuid(),
  operator_type text not null,
  operator_account_name text not null,
  standardized_coa_name text not null,
  top_tier text,
  header text,
  account_type text,
  source text not null default 'analyst',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (operator_type, operator_account_name)
);

create table if not exists public.proforma_run_warnings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.proforma_runs(id) on delete cascade,
  warning_code text,
  warning_message text not null,
  severity text not null default 'warning',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists proforma_runs_operator_idx
  on public.proforma_runs (operator_type, created_at desc);

create index if not exists proforma_property_inputs_run_idx
  on public.proforma_property_inputs (run_id, input_key);

create index if not exists proforma_fact_rows_run_idx
  on public.proforma_fact_rows (run_id, year, month);

create index if not exists proforma_fact_rows_account_idx
  on public.proforma_fact_rows (run_id, operator_account);

create index if not exists proforma_coa_mappings_operator_idx
  on public.proforma_coa_mappings (operator_type, operator_account_name);

create index if not exists proforma_run_warnings_run_idx
  on public.proforma_run_warnings (run_id);

create or replace view public.proforma_excel_inputs_v1 as
select
  r.id as run_id,
  max(case when i.input_key = 'PROPERTY_NAME' then coalesce(i.text_value, i.numeric_value::text, i.date_value::text) end) as property_name,
  max(case when i.input_key = 'PROPERTY_TYPE' then coalesce(i.text_value, i.numeric_value::text, i.date_value::text) end) as property_type,
  max(case when i.input_key = 'PROPERTY_ADDRESS' then coalesce(i.text_value, i.numeric_value::text, i.date_value::text) end) as property_address,
  max(case when i.input_key = 'UNITS_AVAILABLE' then i.numeric_value end) as units_available,
  max(case when i.input_key = 'UNITS_OCCUPIED' then i.numeric_value end) as units_occupied,
  max(case when i.input_key = 'NRSF' then i.numeric_value end) as nrsf,
  max(case when i.input_key = 'ACQUISITION_DATE' then i.date_value end) as acquisition_date,
  max(case when i.input_key = 'HOLD_PERIOD_YEARS' then i.numeric_value end) as hold_period_years,
  max(case when i.input_key = 'PURCHASE_PRICE' then i.numeric_value end) as purchase_price,
  max(case when i.input_key = 'ACQUISITION_CLOSING_COST_PCT' then i.numeric_value end) as acquisition_closing_cost_pct,
  max(case when i.input_key = 'LOAN_TO_COST' then i.numeric_value end) as loan_to_cost,
  max(case when i.input_key = 'SOFR_RATE' then i.numeric_value end) as sofr_rate,
  max(case when i.input_key = 'SPREAD_RATE' then i.numeric_value end) as spread_rate,
  max(case when i.input_key = 'ALL_IN_RATE' then i.numeric_value end) as all_in_rate,
  max(case when i.input_key = 'AMORTIZATION_YEARS' then i.numeric_value end) as amortization_years,
  max(case when i.input_key = 'LOAN_TERM_YEARS' then i.numeric_value end) as loan_term_years,
  max(case when i.input_key = 'LOAN_AMOUNT' then i.numeric_value end) as loan_amount,
  max(case when i.input_key = 'INTEREST_ONLY_PERIOD_MONTHS' then i.numeric_value end) as interest_only_period_months,
  max(case when i.input_key = 'UPFRONT_CAPEX' then i.numeric_value end) as upfront_capex,
  max(case when i.input_key = 'YEAR_ONE_CAPEX' then i.numeric_value end) as year_one_capex,
  max(case when i.input_key = 'TOTAL_CAPEX' then i.numeric_value end) as total_capex,
  max(case when i.input_key = 'ANNUAL_CAPEX_RESERVE' then i.numeric_value end) as annual_capex_reserve,
  max(case when i.input_key = 'EXIT_CAP_RATE' then i.numeric_value end) as exit_cap_rate,
  max(case when i.input_key = 'DISPOSITION_COST_PCT' then i.numeric_value end) as disposition_cost_pct,
  max(case when i.input_key = 'GOING_IN_CAP_RATE' then i.numeric_value end) as going_in_cap_rate,
  max(case when i.input_key = 'ASSET_MANAGEMENT_FEE' then i.numeric_value end) as asset_management_fee,
  max(case when i.input_key = 'OCCUPANCY_RATE' then i.numeric_value end) as occupancy_rate,
  max(case when i.input_key = 'ENTITY' then coalesce(i.text_value, i.numeric_value::text, i.date_value::text) end) as entity
from public.proforma_runs r
left join public.proforma_property_inputs i
  on i.run_id = r.id
group by r.id;

create or replace view public.proforma_excel_data_drop_v1 as
select
  run_id,
  actual_budget as "Actual/Budget",
  entity as "Entity",
  operator_account as "Account",
  month as "Month",
  year as "Year",
  period_date as "Period",
  amount as "Amount ($)",
  coalesce(standardized_coa_name, '') as "COA"
from public.proforma_fact_rows
order by run_id, period_date, operator_account;

create or replace view public.proforma_excel_coa_translation_v1 as
select distinct
  run_id,
  operator_account as "Account",
  coalesce(standardized_coa_name, '') as "COA",
  coalesce(top_tier, '') as "Top Tier",
  coalesce(header, '') as "Header",
  coalesce(account_type, '') as "Type"
from public.proforma_fact_rows
order by run_id, "Account";
