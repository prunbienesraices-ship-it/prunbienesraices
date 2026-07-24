create table if not exists developments (
  id bigint generated always as identity primary key,
  name text not null,
  type text default 'edificio', 
  city text default '',
  address text default '',
  units int default 1,
  status text default 'terminado', 
  expenses numeric default 0, 
  amenities jsonb not null default '[]',
  description text default '',
  created_at timestamptz not null default now()
);
alter table properties add column if not exists development_id bigint references developments(id) on delete set null;
alter table properties add column if not exists floor text default '';
alter table properties add column if not exists door text default '';
alter table properties add column if not exists coefficient numeric default 0;
create table if not exists owners (
  id bigint generated always as identity primary key,
  name text not null,
  dni text default '',
  cuit text default '',
  birthdate date,
  marital text default '',
  address text default '',
  phone text default '',
  email text default '',
  cbu text default '',
  alias text default '',
  bank text default '',
  account text default '',
  payment_method text default 'transferencia',
  iva text default '',
  monotributo text default '',
  commission_withholding numeric default 0,
  notes text default '',
  created_at timestamptz not null default now()
);
create table if not exists repairs (
  id bigint generated always as identity primary key,
  property_id bigint references properties(id) on delete set null,
  type text default 'incidencia', 
  status text default 'reportado', 
  title text not null,
  date_reported date,
  date_resolved date,
  budgets jsonb not null default '[]', 
  provider text default '',
  provider_phone text default '',
  cost numeric default 0,
  payer text default 'propietario', 
  warranty text default '',
  invoice_number text default '',
  notes text default '',
  created_at timestamptz not null default now()
);
create table if not exists providers (
  id bigint generated always as identity primary key,
  category text not null, 
  name text not null,
  phone text default '',
  email text default '',
  address text default '',
  notes text default '',
  favorite boolean default false,
  created_at timestamptz not null default now()
);
create table if not exists deals (
  id bigint generated always as identity primary key,
  property_id bigint references properties(id) on delete set null,
  name text not null,
  phone text default '',
  email text default '',
  amount numeric default 0,
  agent text default '',
  stage text default 'lead', 
  notes text default '',
  history jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists collections_charges (
  id bigint generated always as identity primary key,
  tenant_id bigint references tenants(id) on delete cascade,
  concept text not null,
  label text default '',
  amount numeric not null default 0,
  payments jsonb not null default '[]', 
  created_at timestamptz not null default now()
);
create table if not exists settlements (
  id bigint generated always as identity primary key,
  tenant_id bigint references tenants(id) on delete cascade,
  period text not null,
  rent numeric default 0,
  commission numeric default 0,
  expensas numeric default 0,
  repairs numeric default 0,
  repairs_desc text default '',
  fees numeric default 0,
  fees_desc text default '',
  net numeric default 0,
  transferred boolean default false,
  transfer_date date,
  notes text default '',
  created_at timestamptz not null default now()
);
create table if not exists agenda_events (
  id bigint generated always as identity primary key,
  type text not null, 
  title text not null,
  date date not null,
  time text default '',
  property_id bigint references properties(id) on delete set null,
  notes text default '',
  status text default 'pendiente',
  created_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  user_name text default '',
  action text not null,
  old_value text default '',
  new_value text default '',
  created_at timestamptz not null default now()
);
alter table developments enable row level security;
alter table owners enable row level security;
alter table repairs enable row level security;
alter table providers enable row level security;
alter table deals enable row level security;
alter table collections_charges enable row level security;
alter table settlements enable row level security;
alter table agenda_events enable row level security;
alter table audit_log enable row level security;
