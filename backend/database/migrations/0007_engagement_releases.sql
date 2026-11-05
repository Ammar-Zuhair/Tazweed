-- Additive phase10. Existing financial facts and migrations remain untouched.
ALTER TABLE push_tokens ADD COLUMN session_id uuid REFERENCES sessions(id),
 ADD COLUMN project_id uuid, ADD COLUMN sound_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE notification_campaigns ADD COLUMN environment text NOT NULL DEFAULT 'staging' CHECK(environment IN ('staging','production')), ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN audience_cursor uuid, ADD COLUMN finished_at timestamptz,
 ADD COLUMN error_code text;
ALTER TABLE notification_inbox ADD COLUMN branch_id uuid REFERENCES branches(id),
 ADD COLUMN permission_code text, ADD COLUMN order_id uuid REFERENCES orders(id),
 ADD COLUMN assignment_id uuid REFERENCES order_assignments(id);
ALTER TABLE notification_deliveries ADD COLUMN token_version integer,
 ADD COLUMN lease_id uuid, ADD COLUMN locked_until timestamptz,
 ADD COLUMN receipt_checks integer NOT NULL DEFAULT 0,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE customer_maintenance ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE app_releases ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN binary_confirmed boolean NOT NULL DEFAULT false;
CREATE INDEX push_active_session ON push_tokens(session_id,app,environment) WHERE active;
CREATE INDEX delivery_due ON notification_deliveries(next_attempt_at,locked_until) WHERE status IN ('pending','sent');
CREATE INDEX campaigns_due ON notification_campaigns(scheduled_at) WHERE status IN ('scheduled','sending');
CREATE INDEX inbox_order_scope ON notification_inbox(order_id,assignment_id);

ALTER TABLE outbox_events ADD COLUMN audience_cursor uuid;
