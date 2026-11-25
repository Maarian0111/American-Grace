-- American Grace — Supabase schema
-- Run this in the Supabase SQL editor before seeding.

-- Catalog (price list + stock)
create table if not exists catalog_items (
  id serial primary key,
  referencia text not null unique,
  referencia_ag text,
  descripcion text,
  tallas text,
  genero text check (genero in ('Niña', 'Niño/Unisex', 'Accesorios')),
  precio_tienda numeric(12, 0) default 0,
  precio_mayorista numeric(12, 0) default 0,
  precio_consignacion numeric(12, 0) default 0,
  stock integer default 0,
  image_url text, -- nullable; photos deferred (Google Drive / later slice)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_catalog_referencia on catalog_items (referencia);
create index if not exists idx_catalog_genero on catalog_items (genero);
create index if not exists idx_catalog_ag on catalog_items (referencia_ag);

-- Sellers (vendedores)
create table if not exists sellers (
  id serial primary key,
  name text not null unique,
  active boolean default true,
  created_at timestamptz default now()
);

insert into sellers (name) values
  ('Felipe Alvernia'),
  ('Alejandra Rivera'),
  ('Angie Ortiz'),
  ('Mariana Rivera')
on conflict (name) do nothing;

-- Sales header (matches AG INVENTARIO VENTAS sheet)
create table if not exists sales (
  id serial primary key,
  fecha_venta date not null default current_date,
  seller_id integer references sellers (id),
  vendedor_nombre text, -- denormalized for offline / history
  cliente text,
  estado_pago text not null default 'PENDIENTE'
    check (estado_pago in (
      'PENDIENTE',
      'ENTREGADO',
      'ENTREGADO 1° CORTE',
      'PAGADO',
      'PARCIAL',
      'CANCELADO'
    )),
  fecha_pago date,
  notas text,
  total numeric(12, 0) default 0,
  -- EXTENSION POINT: Bancolombia / payment gateway
  -- When integrating live bank status, store provider refs here and
  -- replace manual estado_pago updates with webhook-driven sync.
  payment_provider text,       -- e.g. 'bancolombia' | null (manual)
  payment_external_id text,    -- bank transfer / PSE reference
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sales_fecha on sales (fecha_venta);
create index if not exists idx_sales_seller on sales (seller_id);
create index if not exists idx_sales_estado on sales (estado_pago);

-- Sale line items (prendas)
create table if not exists sale_items (
  id serial primary key,
  sale_id integer not null references sales (id) on delete cascade,
  catalog_item_id integer references catalog_items (id),
  referencia text,
  descripcion text,
  talla text,
  cantidad integer not null default 1,
  precio_unitario numeric(12, 0) default 0,
  tariff text default 'tienda'
    check (tariff in ('tienda', 'mayorista', 'consignacion')),
  created_at timestamptz default now()
);

create index if not exists idx_sale_items_sale on sale_items (sale_id);

-- Full audit trail for edits and garment exchanges (cambios)
create table if not exists sale_change_history (
  id serial primary key,
  sale_id integer not null references sales (id) on delete cascade,
  action text not null, -- 'create' | 'edit' | 'cambio' | 'estado' | 'delete'
  changed_by text,
  before_data jsonb,
  after_data jsonb,
  context text, -- free-form note: reason, exchange details, etc.
  created_at timestamptz default now()
);

create index if not exists idx_sale_history_sale on sale_change_history (sale_id);
create index if not exists idx_sale_history_action on sale_change_history (action);

-- Optional: enable Row Level Security later; for boutique internal use
-- with anon key, you may keep RLS off or add policies for authenticated users.
