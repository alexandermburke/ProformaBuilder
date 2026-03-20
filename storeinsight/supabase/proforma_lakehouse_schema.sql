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

