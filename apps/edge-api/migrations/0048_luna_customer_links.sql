-- A phone that is not on the client record but whose owner confirmed, by CPF,
-- that they are that client (a relative's or a second number). Luna treats the
-- phone as that client's instead of creating a second account.
CREATE TABLE luna_customer_links (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,phone TEXT NOT NULL,client_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,module_id,phone),FOREIGN KEY(tenant_id) REFERENCES tenants(id)
) STRICT;
CREATE INDEX luna_customer_links_client ON luna_customer_links(tenant_id,module_id,client_id);
