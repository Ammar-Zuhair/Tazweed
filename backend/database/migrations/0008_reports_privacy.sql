ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE deletion_requests ADD COLUMN challenge_id uuid UNIQUE,
 ADD COLUMN proof_digest text, ADD COLUMN receipt_digest text,
 ADD COLUMN policy_snapshot jsonb, ADD COLUMN account_erased_at timestamptz,
 ADD COLUMN retained_until timestamptz, ADD COLUMN review_code text,
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX deletion_one_active ON deletion_requests(user_id) WHERE status<>'completed';
CREATE INDEX deletion_work_due ON deletion_requests(next_attempt_at) WHERE status<>'completed';
ALTER TABLE report_jobs ADD COLUMN pdf_bytes bytea, ADD COLUMN summary jsonb,
 ADD COLUMN completed_at timestamptz, ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day';
CREATE TABLE privacy_file_deletions (
 media_id uuid PRIMARY KEY REFERENCES media_objects(id), request_id uuid NOT NULL REFERENCES deletion_requests(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','deleted')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
-- Only this capability runs as the existing NOLOGIN privacy role. No application membership.
-- It cannot mutate monetary facts, stock, receipts, proof references or immutable audit rows.
CREATE FUNCTION privacy_erase_account(request_uuid uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.deletion_requests; u public.users; blocked boolean; deadline timestamptz;
BEGIN
 SELECT * INTO r FROM public.deletion_requests WHERE id=request_uuid FOR UPDATE;
 IF r.id IS NULL OR r.verified_at IS NULL OR r.status='completed' THEN RETURN 'ineligible'; END IF;
 IF r.policy_snapshot IS NULL OR (r.policy_snapshot->>'approved') IS DISTINCT FROM 'true' THEN RETURN 'policy_required'; END IF;
 IF r.account_erased_at IS NOT NULL THEN RETURN 'erased'; END IF;
 SELECT * INTO u FROM public.users WHERE id=r.user_id FOR UPDATE;
 IF u.id IS NULL THEN RETURN 'ineligible'; END IF;
 -- Submission holds the same user row; deletion blocks every future new order.
 -- Terminal orders cannot reopen; the user lock serializes every new submission.
 SELECT EXISTS(SELECT 1 FROM public.orders o WHERE o.customer_id=u.id AND
   (o.status NOT IN ('delivered','cancelled','rejected') OR EXISTS(SELECT 1 FROM public.financial_exceptions e WHERE e.order_id=o.id AND e.status='open')
    OR EXISTS(SELECT 1 FROM public.payments p WHERE p.order_id=o.id AND p.status='pending')
    OR EXISTS(SELECT 1 FROM public.stock_reservations s WHERE s.order_id=o.id AND s.state='active')))
   OR EXISTS(SELECT 1 FROM public.complaints c WHERE c.customer_id=u.id AND c.status<>'closed')
   OR EXISTS(SELECT 1 FROM public.order_assignments a JOIN public.orders o ON o.id=a.order_id WHERE a.courier_id=u.id AND a.ended_at IS NULL AND o.status IN ('confirmed','on_the_way'))
 INTO blocked;
 IF blocked THEN RETURN 'open_obligations'; END IF;
 IF EXISTS(WITH refs AS(SELECT attachment_id,customer_id FROM public.customer_flags WHERE attachment_id IS NOT NULL UNION ALL SELECT attachment_id,customer_id FROM public.complaints WHERE attachment_id IS NOT NULL)
 SELECT 1 FROM refs own_ref JOIN refs other_ref ON own_ref.attachment_id=other_ref.attachment_id AND other_ref.customer_id<>u.id WHERE own_ref.customer_id=u.id)
 THEN RETURN 'shared_attachment_review'; END IF;

 IF u.kind='courier' AND (
   (SELECT coalesce(sum(amount_yer),0) FROM public.cash_collections WHERE courier_id=u.id)
   +(SELECT coalesce(sum(amount_yer),0) FROM public.cash_remittance_reversals WHERE courier_id=u.id)
   -(SELECT coalesce(sum(total_yer),0) FROM public.cash_remittances WHERE courier_id=u.id) <> 0 OR
   (SELECT coalesce(sum(amount_yer),0) FROM public.courier_earnings WHERE courier_id=u.id)
   +(SELECT coalesce(sum(amount_yer),0) FROM public.courier_settlement_reversals WHERE courier_id=u.id)
   -(SELECT coalesce(sum(total_yer),0) FROM public.courier_settlements WHERE courier_id=u.id) <> 0
 ) THEN RETURN 'courier_balance'; END IF;
 IF u.kind='staff' AND EXISTS(SELECT 1 FROM public.staff_grants g JOIN public.roles x ON x.id=g.role_id WHERE g.user_id=u.id AND x.code='general_admin' AND g.global_scope)
 AND NOT EXISTS(SELECT 1 FROM public.staff_grants g JOIN public.roles x ON x.id=g.role_id JOIN public.users other ON other.id=g.user_id WHERE other.id<>u.id AND other.status='active' AND x.code='general_admin' AND g.global_scope)
 THEN RETURN 'last_admin'; END IF;
 DELETE FROM public.addresses WHERE user_id=u.id;
 DELETE FROM public.notification_deliveries WHERE notification_id IN(SELECT id FROM public.notification_inbox WHERE user_id=u.id) OR push_token_id IN(SELECT id FROM public.push_tokens WHERE user_id=u.id);
 DELETE FROM public.push_tokens WHERE user_id=u.id;
 DELETE FROM public.notification_inbox WHERE user_id=u.id;
 DELETE FROM public.session_refresh_tokens WHERE session_id IN(SELECT id FROM public.sessions WHERE user_id=u.id);
 DELETE FROM public.sessions WHERE user_id=u.id;
 DELETE FROM public.otp_challenges WHERE phone_e164=u.phone_e164 OR user_id=u.id;
 DELETE FROM public.idempotency_records WHERE actor_id=u.id;
 -- Attachments about this customer may have been uploaded by staff/couriers.
 INSERT INTO public.privacy_file_deletions(media_id,request_id,next_attempt_at)
 SELECT m.id,r.id,greatest(now(),coalesce(m.upload_expires_at,now())) FROM public.media_objects m
 WHERE m.visibility='private' AND m.status<>'deleted' AND (
 EXISTS(SELECT 1 FROM public.customer_flags f WHERE f.customer_id=u.id AND f.attachment_id=m.id)
 OR EXISTS(SELECT 1 FROM public.complaints c WHERE c.customer_id=u.id AND c.attachment_id=m.id))
 AND NOT EXISTS(SELECT 1 FROM public.customer_flags f WHERE f.customer_id<>u.id AND f.attachment_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM public.complaints c WHERE c.customer_id<>u.id AND c.attachment_id=m.id)
 ON CONFLICT(media_id) DO NOTHING;
 DELETE FROM public.order_reviews WHERE customer_id=u.id;
 DELETE FROM public.complaints WHERE customer_id=u.id;
 DELETE FROM public.customer_flags WHERE customer_id=u.id;
 UPDATE public.courier_profiles SET active=false WHERE user_id=u.id;
 UPDATE public.users SET status='deleted',name_ar='حساب محذوف',phone_e164=NULL,password_hash=NULL,phone_verified_at=NULL,deleted_at=coalesce(deleted_at,now()) WHERE id=u.id;
 UPDATE public.deletion_requests SET account_erased_at=coalesce(account_erased_at,now()),status='processing',review_code=NULL WHERE id=r.id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,request_id) VALUES(u.id,'privacy.account_erased','deletion_request',r.id,r.id::text);
 RETURN 'erased';
END; $$;
REVOKE ALL ON FUNCTION privacy_erase_account(uuid) FROM PUBLIC;
CREATE FUNCTION privacy_redact_retained(request_uuid uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.deletion_requests; personal_days integer; finance_days integer;
BEGIN
 SELECT * INTO r FROM public.deletion_requests WHERE id=request_uuid FOR UPDATE;
 IF r.account_erased_at IS NULL OR (r.policy_snapshot->>'approved') IS DISTINCT FROM 'true' THEN RETURN 'ineligible'; END IF;
 personal_days:=(r.policy_snapshot->>'personalDays')::integer;
 finance_days:=(r.policy_snapshot->>'transactionDays')::integer;
 UPDATE public.order_private_details d SET address_snapshot='{}',contact_snapshot='{}',redacted_at=now(),redacted_by=r.user_id,redaction_reason='Verified deletion request under policy '||(r.policy_snapshot->>'version')
 FROM public.orders o WHERE o.id=d.order_id AND o.customer_id=r.user_id AND d.redacted_at IS NULL
 AND greatest(o.created_at,coalesce(o.delivered_at,o.created_at),coalesce((SELECT max(created_at) FROM public.order_events ev WHERE ev.order_id=o.id),o.created_at)) + make_interval(days=>personal_days)<=now();
 -- All private account media remains inaccessible once queued. Keep proof rows/IDs intact.
 INSERT INTO public.privacy_file_deletions(media_id,request_id,next_attempt_at)
 SELECT m.id,r.id,CASE WHEN EXISTS(SELECT 1 FROM public.payment_receipt_attempts a WHERE a.media_id=m.id)
 OR m.purpose='financial_proof' THEN greatest(m.created_at,r.account_erased_at)+make_interval(days=>finance_days) ELSE greatest(now(),coalesce(m.upload_expires_at,now())) END
 FROM public.media_objects m WHERE m.owner_id=r.user_id AND m.visibility='private' AND m.status<>'deleted'
 ON CONFLICT(media_id) DO NOTHING;
 UPDATE public.deletion_requests SET retained_until=greatest(
 (SELECT max(greatest(o.created_at,coalesce(o.delivered_at,o.created_at),coalesce((SELECT max(ev.created_at) FROM public.order_events ev WHERE ev.order_id=o.id),o.created_at))+make_interval(days=>personal_days)) FROM public.orders o WHERE o.customer_id=r.user_id),
 (SELECT max(next_attempt_at) FROM public.privacy_file_deletions f WHERE f.request_id=r.id AND f.state='pending')) WHERE id=r.id;
 RETURN 'processed';
END; $$;
REVOKE ALL ON FUNCTION privacy_redact_retained(uuid) FROM PUBLIC;
-- Only expired authentication artifacts, after a configured security retention interval.
CREATE FUNCTION privacy_prune_security(keep_days integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF keep_days IS NULL OR keep_days<0 OR keep_days>36500 THEN RAISE EXCEPTION 'Invalid security retention'; END IF;
 DELETE FROM public.otp_challenges WHERE expires_at<now()-make_interval(days=>keep_days);
 DELETE FROM public.auth_rate_buckets WHERE expires_at<=now();
END; $$;
REVOKE ALL ON FUNCTION privacy_prune_security(integer) FROM PUBLIC;
-- Serialize new private references with erasure. A stale checked upload must not become a new proof.
CREATE FUNCTION privacy_guard_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file_uuid uuid;
BEGIN
 IF TG_TABLE_NAME='payment_receipt_attempts' THEN file_uuid:=NEW.media_id;
 ELSIF TG_TABLE_NAME IN ('complaints','customer_flags') THEN file_uuid:=NEW.attachment_id;
 ELSE file_uuid:=NEW.proof_media_id; END IF;
 IF file_uuid IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.media_objects m WHERE m.id=file_uuid AND m.status='verified'
 AND NOT EXISTS(SELECT 1 FROM public.privacy_file_deletions f WHERE f.media_id=m.id)
 FOR KEY SHARE OF m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private media unavailable for a new reference'; END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['payment_receipt_attempts','financial_exception_resolutions','courier_settlement_reversals','cash_remittance_reversals','complaints','customer_flags'] LOOP
 EXECUTE format('CREATE TRIGGER privacy_media_reference BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION privacy_guard_media_reference()',name);
 END LOOP;
END; $$;
