CREATE TABLE IF NOT EXISTS service_delivery_orders (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  sale_id TEXT, appointment_id TEXT, client_id TEXT, session_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual', order_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', scheduled_for_ms INTEGER,
  contact_phone TEXT, payment_status TEXT, notes TEXT,
  delivery_address TEXT, delivery_neighborhood TEXT, delivery_city TEXT, delivery_reference TEXT,
  transport_mode TEXT, transport_label TEXT, assigned_staff_key TEXT, assigned_staff_name TEXT,
  delivery_value_cents INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (order_type IN ('entrega','servico','retirada')),
  CHECK (delivery_value_cents >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS service_delivery_orders_scope_status_idx
  ON service_delivery_orders(tenant_id,module_id,order_type,status,updated_at_ms DESC,id);
CREATE INDEX IF NOT EXISTS service_delivery_orders_scope_sale_idx
  ON service_delivery_orders(tenant_id,module_id,sale_id,id);

DROP VIEW IF EXISTS compat_clients;
CREATE VIEW compat_clients AS
SELECT
  p.tenant_id,
  p.module_id,
  p.id,
  'pet' AS type,
  c.name,
  c.document,
  c.phone,
  c.email,
  c.address,
  c.neighborhood,
  c.city,
  c.notes,
  CASE WHEN c.status='active' AND p.status='active' THEN 1 ELSE 0 END AS active,
  json_object(
    'pet_name',p.name,
    'species',p.species,
    'breed',p.breed,
    'birth_date',p.birth_date,
    'weight_kg',p.weight_kg,
    'color',p.color,
    'pet_notes',p.notes,
    'tutor_birth_date',c.birth_date,
    'zip_code',c.postal_code,
    'address_number',c.address_number,
    'address_complement',c.address_complement,
    'address_reference',c.address_reference,
    'tutor_group_id',c.id
  ) AS details,
  datetime(p.created_at_ms/1000,'unixepoch') AS created_at,
  datetime(p.updated_at_ms/1000,'unixepoch') AS updated_at
FROM pets p
JOIN clients c ON c.tenant_id=p.tenant_id AND c.module_id=p.module_id AND c.id=p.client_id;

DROP VIEW IF EXISTS compat_pets;
CREATE VIEW compat_pets AS
SELECT
  p.tenant_id,p.module_id,p.id,p.client_id,
  c.name AS owner_name,c.document AS owner_cpf,c.phone,c.email,
  c.address AS owner_address,c.neighborhood AS owner_neighborhood,c.city AS owner_city,
  p.name AS pet_name,p.species,p.breed,p.birth_date,p.weight_kg,p.color,p.notes,
  datetime(p.created_at_ms/1000,'unixepoch') AS created_at,
  datetime(p.updated_at_ms/1000,'unixepoch') AS updated_at
FROM pets p
JOIN clients c ON c.tenant_id=p.tenant_id AND c.module_id=p.module_id AND c.id=p.client_id;

DROP VIEW IF EXISTS compat_products;
CREATE VIEW compat_products AS
SELECT
  p.tenant_id,p.module_id,p.id,p.name,p.barcode,p.category,p.description,
  p.price_cents/100.0 AS price,p.cost_cents/100.0 AS cost_price,
  COALESCE(i.on_hand_milliunits,0)/1000.0 AS stock_quantity,
  COALESCE(i.reorder_milliunits,0)/1000.0 AS min_stock,
  p.species_target,p.upsell_product_id,p.image_url,json(p.bot_metadata_json) AS bot_metadata,
  CASE WHEN p.status='active' THEN 1 ELSE 0 END AS active,
  datetime(p.created_at_ms/1000,'unixepoch') AS created_at,
  datetime(p.updated_at_ms/1000,'unixepoch') AS updated_at
FROM catalog_products p
LEFT JOIN inventory_balances i ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id;

DROP VIEW IF EXISTS compat_petshop_services;
CREATE VIEW compat_petshop_services AS
SELECT
  tenant_id,module_id,id,code,name,category,description,group_type,
  default_price_cents/100.0 AS default_price,default_duration_min,
  commission_type,commission_basis_points/100.0 AS commission_rate,
  CASE WHEN status='active' THEN 1 ELSE 0 END AS active,
  sort_order,icon,source_product_id,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,
  datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM services;

DROP VIEW IF EXISTS compat_appointments;
CREATE VIEW compat_appointments AS
SELECT
  a.tenant_id,a.module_id,a.id,a.client_id,a.pet_id,
  (SELECT s.service_code FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id ORDER BY s.position LIMIT 1) AS service_type,
  a.service_group,
  COALESCE((SELECT json_group_array(json_object(
    'code',s.service_code,'service_id',s.service_id,'name',s.service_name,'group_type',s.service_group,
    'unit_price',s.unit_price_cents/100.0,'duration_min',s.duration_min,'benefit_used',s.benefit_used
  )) FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id),'[]') AS service_items,
  datetime(a.scheduled_at_ms/1000,'unixepoch') AS scheduled_at,a.duration_min,a.subtotal_cents/100.0 AS price,
  CASE a.status WHEN 'scheduled' THEN 'agendado' WHEN 'confirmed' THEN 'confirmado' WHEN 'in_progress' THEN 'em_andamento'
    WHEN 'completed' THEN 'concluido' WHEN 'cancelled' THEN 'cancelado' WHEN 'blocked' THEN 'bloqueado'
    WHEN 'available' THEN 'disponivel' ELSE a.status END AS status,
  a.notes,a.source,
  a.employee_id,a.groomer_id,a.responsible_staff_key,a.responsible_staff_name,a.delivery_staff_key,a.delivery_staff_name,
  t.option_id AS transport_mode,o.label AS transport_label,t.pickup_address AS transport_address,
  NULL AS transport_neighborhood,NULL AS transport_city,t.pickup_reference AS transport_reference,
  a.live_status,CASE WHEN a.checkin_at_ms IS NULL THEN NULL ELSE datetime(a.checkin_at_ms/1000,'unixepoch') END AS checkin_at,
  CASE WHEN a.ready_at_ms IS NULL THEN NULL ELSE datetime(a.ready_at_ms/1000,'unixepoch') END AS ready_at,
  a.subscription_id,a.subscription_benefit_used,a.subscription_benefit_status,json(a.subscription_benefits_json) AS subscription_benefits,
  a.subscription_label,a.subscription_discount_cents/100.0 AS subscription_discount,
  datetime(a.created_at_ms/1000,'unixepoch') AS created_at,datetime(a.updated_at_ms/1000,'unixepoch') AS updated_at
FROM appointments a
LEFT JOIN appointment_transport t ON t.tenant_id=a.tenant_id AND t.module_id=a.module_id AND t.appointment_id=a.id
LEFT JOIN transport_options o ON o.tenant_id=t.tenant_id AND o.module_id=t.module_id AND o.id=t.option_id;

DROP VIEW IF EXISTS compat_sales;
CREATE VIEW compat_sales AS
SELECT
  s.tenant_id,s.module_id,s.id,s.client_id,s.appointment_id,s.subscription_id,
  NULL AS customer_name,NULL AS customer_phone,
  s.subtotal_cents/100.0 AS subtotal,s.discount_cents/100.0 AS discount,
  s.transport_fee_cents/100.0 AS delivery_fee,s.total_cents/100.0 AS total_price,
  CASE s.status WHEN 'pending' THEN 'pendente' WHEN 'confirmed' THEN 'confirmado' WHEN 'completed' THEN 'concluido'
    WHEN 'cancelled' THEN 'cancelado' WHEN 'refunded' THEN 'reembolsado' ELSE s.status END AS status,
  (SELECT p.method FROM payments p WHERE p.tenant_id=s.tenant_id AND p.module_id=s.module_id AND p.sale_id=s.id ORDER BY p.created_at_ms,p.id LIMIT 1) AS payment_method,
  (SELECT p.status FROM payments p WHERE p.tenant_id=s.tenant_id AND p.module_id=s.module_id AND p.sale_id=s.id ORDER BY p.created_at_ms,p.id LIMIT 1) AS payment_status,
  s.source,CASE s.fulfillment_type WHEN 'counter' THEN 'balcao' WHEN 'delivery' THEN 'entrega' WHEN 'service' THEN 'servico' ELSE s.fulfillment_type END AS fulfillment_type,
  s.notes,datetime(s.created_at_ms/1000,'unixepoch') AS created_at,datetime(s.updated_at_ms/1000,'unixepoch') AS updated_at
FROM sales s;

DROP VIEW IF EXISTS compat_sale_items;
CREATE VIEW compat_sale_items AS
SELECT tenant_id,module_id,sale_id,position,product_id,service_id,item_name,
  quantity_milliunits/1000.0 AS quantity,unit_price_cents/100.0 AS unit_price,subtotal_cents/100.0 AS subtotal,upsell
FROM sale_items;

DROP VIEW IF EXISTS compat_sale_payment_splits;
CREATE VIEW compat_sale_payment_splits AS
SELECT tenant_id,module_id,sale_id,id AS payment_id,method AS payment_method,amount_cents/100.0 AS amount,
  ROW_NUMBER() OVER (PARTITION BY tenant_id,module_id,sale_id ORDER BY created_at_ms,id)-1 AS position,
  status,datetime(created_at_ms/1000,'unixepoch') AS created_at
FROM payments;

DROP VIEW IF EXISTS compat_subscription_plans;
CREATE VIEW compat_subscription_plans AS
SELECT tenant_id,module_id,id,name,price_cents/100.0 AS price,billing_cycle,json(services_json) AS services,
  CASE WHEN status='active' THEN 1 ELSE 0 END AS active,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM subscription_plans;

DROP VIEW IF EXISTS compat_client_subscriptions;
CREATE VIEW compat_client_subscriptions AS
SELECT tenant_id,module_id,id,plan_id,client_id,status,
  date(started_at_ms/1000,'unixepoch') AS started_at,next_billing_date,json(services_used_json) AS services_used,
  CASE WHEN cancelled_at_ms IS NULL THEN NULL ELSE datetime(cancelled_at_ms/1000,'unixepoch') END AS cancelled_at,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM client_subscriptions;

DROP VIEW IF EXISTS compat_cash_register;
CREATE VIEW compat_cash_register AS
SELECT tenant_id,module_id,id,opened_by,closed_by,opening_balance_cents/100.0 AS opening_balance,
  closing_balance_cents/100.0 AS closing_balance,expected_balance_cents/100.0 AS expected_balance,difference_cents/100.0 AS difference,
  datetime(opened_at_ms/1000,'unixepoch') AS opened_at,
  CASE WHEN closed_at_ms IS NULL THEN NULL ELSE datetime(closed_at_ms/1000,'unixepoch') END AS closed_at,notes
FROM cash_register;

DROP VIEW IF EXISTS compat_invoices;
CREATE VIEW compat_invoices AS
SELECT tenant_id,module_id,id,sale_id,client_id,amount_cents/100.0 AS amount,status,due_date,
  CASE WHEN paid_at_ms IS NULL THEN NULL ELSE datetime(paid_at_ms/1000,'unixepoch') END AS paid_at,
  customer_phone,notes,invoice_nfe_url,datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM invoices;

DROP VIEW IF EXISTS compat_service_delivery_orders;
CREATE VIEW compat_service_delivery_orders AS
SELECT tenant_id,module_id,id,sale_id,appointment_id,client_id,session_id,source,order_type,status,
  CASE WHEN scheduled_for_ms IS NULL THEN NULL ELSE datetime(scheduled_for_ms/1000,'unixepoch') END AS scheduled_for,
  contact_phone,payment_status,notes,delivery_address,delivery_neighborhood,delivery_city,delivery_reference,
  transport_mode,transport_label,assigned_staff_key,assigned_staff_name,delivery_value_cents/100.0 AS delivery_value,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM service_delivery_orders;

DROP VIEW IF EXISTS compat_chat_sessions;
CREATE VIEW compat_chat_sessions AS
SELECT tenant_id,module_id,id,client_id,pet_id,external_thread_id AS phone,
  CASE status WHEN 'open' THEN 'open' WHEN 'handoff' THEN 'handoff' ELSE status END AS status,
  CASE WHEN last_message_at_ms IS NULL THEN NULL ELSE datetime(last_message_at_ms/1000,'unixepoch') END AS last_message_at,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM chat_threads;

DROP VIEW IF EXISTS compat_chat_messages;
CREATE VIEW compat_chat_messages AS
SELECT tenant_id,module_id,id,thread_id AS session_id,external_message_id,direction,
  CASE actor_type WHEN 'customer' THEN 'user' WHEN 'assistant' THEN 'assistant' WHEN 'human' THEN 'assistant' ELSE actor_type END AS role,
  content_text AS content,content_json,datetime(created_at_ms/1000,'unixepoch') AS created_at
FROM chat_messages;

UPDATE _yuisync_system_metadata SET value='18',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
