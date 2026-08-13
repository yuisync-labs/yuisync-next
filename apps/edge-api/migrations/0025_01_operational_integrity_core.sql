-- YuiSync operational integrity v25: core columns and canonical units.

ALTER TABLE client_subscriptions ADD COLUMN benefit_ledger_base_used_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(benefit_ledger_base_used_json));
UPDATE client_subscriptions
SET benefit_ledger_base_used_json = services_used_json
WHERE benefit_ledger_base_used_json = '{}';

ALTER TABLE appointments ADD COLUMN billing_intent_type TEXT NOT NULL DEFAULT 'auto'
  CHECK (billing_intent_type IN ('auto','standalone','subscription'));
ALTER TABLE appointments ADD COLUMN billing_intent_subscription_id TEXT;

ALTER TABLE sales ADD COLUMN origin_type TEXT
  CHECK (origin_type IS NULL OR origin_type IN ('appointment','subscription','pos','whatsapp_order','manual','import'));
ALTER TABLE sales ADD COLUMN origin_id TEXT;
UPDATE sales
SET origin_type = CASE
      WHEN appointment_id IS NOT NULL THEN 'appointment'
      WHEN subscription_id IS NOT NULL THEN 'subscription'
      WHEN source='whatsapp' THEN 'whatsapp_order'
      WHEN source='import' THEN 'import'
      WHEN source='manual' THEN 'manual'
      ELSE 'pos'
    END,
    origin_id = COALESCE(appointment_id, subscription_id, id)
WHERE origin_type IS NULL;
CREATE INDEX IF NOT EXISTS sales_scope_origin_idx
  ON sales(tenant_id,module_id,origin_type,origin_id,status,created_at_ms DESC);

ALTER TABLE services ADD COLUMN min_weight_grams INTEGER CHECK (min_weight_grams IS NULL OR min_weight_grams >= 0);
ALTER TABLE services ADD COLUMN max_weight_grams INTEGER CHECK (max_weight_grams IS NULL OR max_weight_grams >= 0);
UPDATE services
SET min_weight_grams = CASE WHEN min_weight_kg IS NULL THEN NULL ELSE CAST(round(min_weight_kg * 1000.0) AS INTEGER) END,
    max_weight_grams = CASE WHEN max_weight_kg IS NULL THEN NULL ELSE CAST(round(max_weight_kg * 1000.0) AS INTEGER) END;

UPDATE services SET min_weight_grams=0,max_weight_grams=10099,min_weight_kg=0.000,max_weight_kg=10.099
WHERE module_id='petshop' AND group_type='banho_tosa' AND (lower(name) LIKE '%pequeno%' OR lower(code) LIKE '%pequeno%');
UPDATE services SET min_weight_grams=10100,max_weight_grams=22100,min_weight_kg=10.100,max_weight_kg=22.100
WHERE module_id='petshop' AND group_type='banho_tosa' AND (lower(name) LIKE '%medio%' OR lower(name) LIKE '%médio%' OR lower(code) LIKE '%medio%' OR lower(code) LIKE '%médio%');
UPDATE services SET min_weight_grams=22101,max_weight_grams=40000,min_weight_kg=22.101,max_weight_kg=40.000
WHERE module_id='petshop' AND group_type='banho_tosa' AND (lower(name) LIKE '%grande%' OR lower(code) LIKE '%grande%');

ALTER TABLE appointment_services ADD COLUMN min_weight_grams INTEGER CHECK (min_weight_grams IS NULL OR min_weight_grams >= 0);
ALTER TABLE appointment_services ADD COLUMN max_weight_grams INTEGER CHECK (max_weight_grams IS NULL OR max_weight_grams >= 0);
UPDATE appointment_services
SET min_weight_grams = CASE WHEN min_weight_kg IS NULL THEN NULL ELSE CAST(round(min_weight_kg * 1000.0) AS INTEGER) END,
    max_weight_grams = CASE WHEN max_weight_kg IS NULL THEN NULL ELSE CAST(round(max_weight_kg * 1000.0) AS INTEGER) END;
