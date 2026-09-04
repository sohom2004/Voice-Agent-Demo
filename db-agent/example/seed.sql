-- Minimal schema + seed data for exercising the fast path locally.
-- Run against a scratch database — do not point this at anything real.

create table if not exists customers (
  id serial primary key,
  email varchar(255) not null,
  phone varchar(50)
);

create table if not exists orders (
  id serial primary key,
  customer_id integer not null references customers(id),
  status varchar(50) not null default 'pending',
  total_cents integer not null,
  notes text,
  created_at timestamp not null default now()
);

insert into customers (email, phone) values
  ('jane@acme.com', '555-0101'),
  ('marcus@acme.com', '555-0102');

insert into orders (customer_id, status, total_cents) values
  (1, 'pending', 4599),
  (1, 'shipped', 1200),
  (2, 'pending', 8899);
