-- Catalog taxonomy already used by the local Think prototype. Additive and idempotent.
-- Draft additive schema. Local file only; not applied remotely.
CREATE TABLE IF NOT EXISTS catalog_product_attributes (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK(product_type IN ('feed','treat')),
  brand_code TEXT,
  brand_label TEXT,
  life_stage TEXT CHECK(life_stage IN ('puppy','adult','senior')),
  sale_form TEXT CHECK(sale_form IN ('bulk','packaged')),
  package_weight_grams INTEGER CHECK(package_weight_grams > 0),
  food_form TEXT CHECK(food_form IN ('dry','wet')),
  search_enabled INTEGER NOT NULL CHECK(search_enabled IN (0,1)),
  canonical_product_id TEXT,
  review_state TEXT NOT NULL CHECK(review_state IN ('suggested','reviewed','excluded')),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  revision TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,product_id),
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_products(tenant_id,module_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,module_id,canonical_product_id) REFERENCES catalog_products(tenant_id,module_id,id) ON DELETE RESTRICT,
  CHECK(sale_form IS NOT 'bulk' OR package_weight_grams IS NULL),
  CHECK(canonical_product_id IS NULL OR (canonical_product_id<>product_id AND search_enabled=0))
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_attributes_search_idx ON catalog_product_attributes(tenant_id,module_id,search_enabled,product_type,life_stage,sale_form,brand_code,package_weight_grams);

CREATE TABLE IF NOT EXISTS catalog_product_species (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, product_id TEXT NOT NULL,
  species TEXT NOT NULL CHECK(species IN ('dog','cat','bird','rabbit','rodent','fish')),
  PRIMARY KEY(tenant_id,module_id,product_id,species),
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_product_attributes(tenant_id,module_id,product_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_species_search_idx ON catalog_product_species(tenant_id,module_id,species,product_id);

CREATE TABLE IF NOT EXISTS catalog_product_sizes (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, product_id TEXT NOT NULL,
  animal_size TEXT NOT NULL CHECK(animal_size IN ('small','medium','large','giant')),
  PRIMARY KEY(tenant_id,module_id,product_id,animal_size),
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_product_attributes(tenant_id,module_id,product_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_sizes_search_idx ON catalog_product_sizes(tenant_id,module_id,animal_size,product_id);

CREATE TABLE IF NOT EXISTS catalog_product_tags (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, product_id TEXT NOT NULL,
  tag_kind TEXT NOT NULL CHECK(tag_kind IN ('feature','breed')),
  tag_value TEXT NOT NULL CHECK(length(trim(tag_value)) BETWEEN 1 AND 100),
  PRIMARY KEY(tenant_id,module_id,product_id,tag_kind,tag_value),
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_product_attributes(tenant_id,module_id,product_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_tags_search_idx ON catalog_product_tags(tenant_id,module_id,tag_kind,tag_value,product_id);

CREATE TABLE IF NOT EXISTS catalog_product_attribute_audit (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, product_id TEXT NOT NULL,
  revision TEXT NOT NULL, before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)), created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,product_id,revision),
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_products(tenant_id,module_id,id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_product_profiles (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,product_id TEXT NOT NULL,
 entity_kind TEXT NOT NULL CHECK(entity_kind IN ('product','service','bundle')),
 domain TEXT NOT NULL CHECK(domain IN ('petshop','garden','human_beverage','household')),
 product_type TEXT NOT NULL CHECK(product_type IN ('feed','treat','accessory','toy','hygiene','medicine','aquarium','garden','beverage','other','service','bundle')),
 subtype TEXT,brand_code TEXT,brand_label TEXT,
 life_stage TEXT CHECK(life_stage IN ('puppy','adult','senior')),
 sale_unit TEXT,net_weight_grams INTEGER CHECK(net_weight_grams>0),net_volume_ml REAL CHECK(net_volume_ml>0),capacity_ml REAL CHECK(capacity_ml>0),
 size_label TEXT,size_number INTEGER CHECK(size_number>=0),pack_count INTEGER CHECK(pack_count>0),
 pet_weight_min_grams INTEGER CHECK(pet_weight_min_grams>=0),pet_weight_max_grams INTEGER CHECK(pet_weight_max_grams>=0),
 food_form TEXT CHECK(food_form IN ('dry','wet')),requires_professional_guidance INTEGER NOT NULL CHECK(requires_professional_guidance IN(0,1)),
 review_state TEXT NOT NULL CHECK(review_state IN('classified','partial')),
 source_name TEXT NOT NULL,source_category TEXT,attributes_json TEXT NOT NULL CHECK(json_valid(attributes_json)),evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),revision TEXT NOT NULL,created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,module_id,product_id),
 FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_products(tenant_id,module_id,id) ON DELETE RESTRICT,
 CHECK(pet_weight_min_grams IS NULL OR pet_weight_max_grams IS NULL OR pet_weight_min_grams<=pet_weight_max_grams)
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_profiles_type_idx ON catalog_product_profiles(tenant_id,module_id,entity_kind,product_type,subtype,brand_code);
CREATE INDEX IF NOT EXISTS catalog_profiles_size_idx ON catalog_product_profiles(tenant_id,module_id,product_type,size_label,size_number);
CREATE INDEX IF NOT EXISTS catalog_profiles_volume_idx ON catalog_product_profiles(tenant_id,module_id,product_type,net_volume_ml,net_weight_grams);
CREATE TABLE IF NOT EXISTS catalog_product_profile_species (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,product_id TEXT NOT NULL,species TEXT NOT NULL CHECK(species IN('dog','cat','bird','rodent','rabbit','fish')),
 PRIMARY KEY(tenant_id,module_id,product_id,species),
 FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_product_profiles(tenant_id,module_id,product_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_profile_species_idx ON catalog_product_profile_species(tenant_id,module_id,species,product_id);
CREATE TABLE IF NOT EXISTS catalog_product_profile_values (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,product_id TEXT NOT NULL,
 facet TEXT NOT NULL CHECK(facet IN('material','color','flavor','presentation','coat','breed','fit_sex','strength_label','size_measurement','dimension','feature')),
 ordinal INTEGER NOT NULL CHECK(ordinal>=0),value_text TEXT,value_number REAL,unit TEXT,
 PRIMARY KEY(tenant_id,module_id,product_id,facet,ordinal),
 FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES catalog_product_profiles(tenant_id,module_id,product_id) ON DELETE RESTRICT,
 CHECK(value_text IS NOT NULL OR value_number IS NOT NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_profile_values_text_idx ON catalog_product_profile_values(tenant_id,module_id,facet,value_text,product_id);
CREATE INDEX IF NOT EXISTS catalog_profile_values_number_idx ON catalog_product_profile_values(tenant_id,module_id,facet,unit,value_number,product_id);
