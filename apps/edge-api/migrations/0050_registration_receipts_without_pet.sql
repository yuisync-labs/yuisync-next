-- A customer who only buys products is registered without a pet, so the
-- registration receipt's pet is optional.
CREATE TABLE luna_registration_receipts_next (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, pet_id TEXT, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,proposal_id),
  FOREIGN KEY(tenant_id,module_id,proposal_id) REFERENCES luna_proposals(tenant_id,module_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,module_id,customer_id) REFERENCES clients(tenant_id,module_id,id),
  FOREIGN KEY(tenant_id,module_id,pet_id) REFERENCES pets(tenant_id,module_id,id)
) STRICT;
INSERT INTO luna_registration_receipts_next SELECT tenant_id,module_id,proposal_id,customer_id,pet_id,created_at_ms FROM luna_registration_receipts;
DROP TABLE luna_registration_receipts;
ALTER TABLE luna_registration_receipts_next RENAME TO luna_registration_receipts;
