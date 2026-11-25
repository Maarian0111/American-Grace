-- American Grace — run in Supabase SQL Editor
-- catalog_items already exists (partial). This completes the schema safely.

-- Harden / extend existing catalog_items
alter table if exists catalog_items
  add column if not exists image_url text;

alter table if exists catalog_items
  add column if not exists updated_at timestamptz default now();

-- Unique on referencia (ignore if already present)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_items_referencia_key'
  ) then
    alter table catalog_items add constraint catalog_items_referencia_key unique (referencia);
  end if;
exception
  when duplicate_table then null;
  when duplicate_object then null;
  when unique_violation then null;
  when others then null;
end $$;

create index if not exists idx_catalog_referencia on catalog_items (referencia);
create index if not exists idx_catalog_genero on catalog_items (genero);
create index if not exists idx_catalog_ag on catalog_items (referencia_ag);

-- Sellers
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

-- Sales
create table if not exists sales (
  id serial primary key,
  fecha_venta date not null default current_date,
  seller_id integer references sellers (id),
  vendedor_nombre text,
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
  payment_provider text,
  payment_external_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sales_fecha on sales (fecha_venta);
create index if not exists idx_sales_seller on sales (seller_id);
create index if not exists idx_sales_estado on sales (estado_pago);

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

create table if not exists sale_change_history (
  id serial primary key,
  sale_id integer not null references sales (id) on delete cascade,
  action text not null,
  changed_by text,
  before_data jsonb,
  after_data jsonb,
  context text,
  created_at timestamptz default now()
);

create index if not exists idx_sale_history_sale on sale_change_history (sale_id);
create index if not exists idx_sale_history_action on sale_change_history (action);
