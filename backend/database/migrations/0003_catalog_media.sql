-- Expand only: original immutable business facts/guards remain unchanged.
ALTER TABLE media_objects ADD COLUMN upload_expires_at timestamptz;
ALTER TABLE media_objects ADD COLUMN staging_key text;
ALTER TABLE media_objects ADD COLUMN thumbnail_key text;
ALTER TABLE media_objects ADD COLUMN width integer;
ALTER TABLE media_objects ADD COLUMN height integer;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX catalog_name_search ON products USING gin(name_ar gin_trgm_ops);
CREATE INDEX catalog_sku_search ON products USING gin(sku gin_trgm_ops);
CREATE INDEX category_sort_cursor ON categories(sort_order,id) WHERE active;
CREATE INDEX media_pending_expiry ON media_objects(upload_expires_at) WHERE status='pending';
CREATE INDEX movement_branch_cursor ON stock_movements(branch_id,id);
CREATE INDEX reservations_branch_product ON stock_reservations(branch_id,product_id) WHERE state='active';
