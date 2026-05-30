/*
  # Resource settings and rooms

  Adds persisted aircraft form requirements, aircraft document categories,
  and a real room resource register.
*/

CREATE TABLE IF NOT EXISTS resource_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_fields jsonb NOT NULL DEFAULT '[
    {"id":"registration","name":"Registration","required":true,"visible":true,"locked":true},
    {"id":"make","name":"Make","required":true,"visible":true,"locked":true},
    {"id":"model","name":"Model","required":true,"visible":true,"locked":true},
    {"id":"type","name":"Aircraft Type","required":true,"visible":true,"locked":true},
    {"id":"tachStart","name":"Tach Start","required":false,"visible":true},
    {"id":"seatCapacity","name":"Seat Capacity","required":false,"visible":true},
    {"id":"fuelCapacity","name":"Fuel Capacity","required":false,"visible":true},
    {"id":"emptyWeight","name":"Empty Weight","required":false,"visible":true},
    {"id":"maxWeight","name":"Max Weight","required":false,"visible":true}
  ]'::jsonb,
  aircraft_document_types jsonb NOT NULL DEFAULT '[
    {"id":"poh","name":"Pilot Operating Handbook (POH)","required":true},
    {"id":"insurance","name":"Insurance Certificate","required":true},
    {"id":"airworthiness","name":"Certificate of Airworthiness","required":true},
    {"id":"weight-balance","name":"Weight & Balance Sheet","required":false},
    {"id":"maintenance-log","name":"Maintenance Log","required":false}
  ]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

ALTER TABLE resource_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view resource settings"
  ON resource_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert resource settings"
  ON resource_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update resource settings"
  ON resource_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

INSERT INTO resource_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM resource_settings);

ALTER TABLE aircraft_documents
  ADD COLUMN IF NOT EXISTS document_type text;

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  location text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'unavailable', 'maintenance')),
  is_bookable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON resource_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rooms TO authenticated;

CREATE POLICY "Authenticated users can view rooms"
  ON rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert rooms"
  ON rooms FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update rooms"
  ON rooms FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete rooms"
  ON rooms FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
