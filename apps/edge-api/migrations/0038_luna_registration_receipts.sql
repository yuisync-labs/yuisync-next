CREATE TABLE luna_registration_receipts (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, pet_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,proposal_id),
  FOREIGN KEY(tenant_id,module_id,proposal_id) REFERENCES luna_proposals(tenant_id,module_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,module_id,customer_id) REFERENCES clients(tenant_id,module_id,id),
  FOREIGN KEY(tenant_id,module_id,pet_id) REFERENCES pets(tenant_id,module_id,id)
) STRICT;
