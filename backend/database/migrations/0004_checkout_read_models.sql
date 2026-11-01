-- Phase07 read-only checkout and promotion lookup. No order or reservation writes.
CREATE INDEX promotions_active_scope ON promotions(governorate_id,starts_at,ends_at,id) WHERE active;
CREATE INDEX addresses_owner_live ON addresses(user_id,governorate_id,id) WHERE archived_at IS NULL;
