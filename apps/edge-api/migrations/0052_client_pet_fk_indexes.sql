-- Indexes for foreign keys to clients/pets that had none. Without them every
-- client or pet delete scans these tables to check the foreign key.
CREATE INDEX IF NOT EXISTS appointments_scope_client_idx ON appointments(tenant_id,module_id,client_id);
CREATE INDEX IF NOT EXISTS sales_scope_client_idx ON sales(tenant_id,module_id,client_id);
CREATE INDEX IF NOT EXISTS chat_threads_scope_client_idx ON chat_threads(tenant_id,module_id,client_id);
CREATE INDEX IF NOT EXISTS chat_threads_scope_pet_idx ON chat_threads(tenant_id,module_id,pet_id);
CREATE INDEX IF NOT EXISTS luna_registration_receipts_scope_customer_idx ON luna_registration_receipts(tenant_id,module_id,customer_id);
CREATE INDEX IF NOT EXISTS luna_registration_receipts_scope_pet_idx ON luna_registration_receipts(tenant_id,module_id,pet_id);
