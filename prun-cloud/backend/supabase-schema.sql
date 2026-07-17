-- ============================================================
-- Prun Bienes Raices - Esquema inicial para Supabase (PostgreSQL)
-- ============================================================
-- Como usar: entra a tu proyecto de Supabase -> SQL Editor -> pega
-- todo este archivo -> "Run". Se crean las tablas y el primer admin.
-- ============================================================

-- Cuentas del panel de administracion
create table if not exists admin_accounts (
  id bigint generated always as identity primary key,
  email text unique not null,
  password_hash text not null,
  role text not null default 'secretaria', -- superadmin | secretaria
  name text not null,
  created_at timestamptz not null default now()
);

-- Propiedades
create table if not exists properties (
  id bigint generated always as identity primary key,
  title text not null,
  description text default '',
  operation text not null,        -- venta | alquiler
  category text not null,         -- casa | departamento | ph | terreno | local | oficina
  price numeric not null,
  currency text not null default 'USD',
  address text default '',
  neighborhood text default '',
  city text default '',
  province text default '',
  bedrooms int default 0,
  bathrooms int default 0,
  area_total numeric,
  area_covered numeric,
  garage int default 0,
  status text not null default 'disponible', -- disponible | reservado | vendido | alquilado
  featured boolean not null default false,
  agent text default '',
  commission numeric default 0,
  photos jsonb not null default '[]', -- array de URLs (Supabase Storage)
  amenities jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consultas del formulario de contacto / propiedad puntual
create table if not exists inquiries (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text default '',
  message text default '',
  property_id bigint references properties(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Usuarios registrados desde el sitio publico
create table if not exists site_users (
  id bigint generated always as identity primary key,
  name text not null,
  email text unique not null,
  password_hash text not null,
  phone text default '',
  role text not null default 'client', -- client | owner | agent
  created_at timestamptz not null default now()
);

-- Se activa Row Level Security: el acceso real lo controla el backend
-- (con la service_role key), no el navegador directamente.
alter table properties enable row level security;
alter table inquiries enable row level security;
alter table admin_accounts enable row level security;
alter table site_users enable row level security;

-- Politica de solo lectura publica para propiedades disponibles
-- (para cuando en el futuro el frontend consulte Supabase directo, si hiciera falta).
drop policy if exists "Propiedades visibles publicamente" on properties;
create policy "Propiedades visibles publicamente" on properties
  for select using (true);

-- ============================================================
-- Bucket de Storage para fotos (ejecutar tambien, o crearlo a mano
-- desde Supabase -> Storage -> "New bucket" -> nombre: "property-photos" -> Public bucket: SI)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;
