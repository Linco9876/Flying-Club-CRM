/*
  # Initial Schema for Flying Club CRM

  1. New Tables
    - `users` - User accounts with role-based access
    - `students` - Extended student information
    - `aircraft` - Aircraft fleet management
    - `bookings` - Flight bookings and scheduling
    - `training_records` - Training session records
    - `defects` - Aircraft defect reports
    - `invoices` - Billing and invoicing
    - `syllabus_sequences` - Training syllabus structure

  2. Security
    - Enable RLS on all tables
    - Add policies for role-based access control
    - Secure data based on user roles and ownership

  3. Features
    - User authentication with roles (admin, instructor, student)
    - Complete booking system with aircraft and instructor scheduling
    - Training record management with competency tracking
    - Aircraft maintenance and defect reporting
    - Billing and invoice management
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'instructor', 'student')),
  phone text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Students table (additional student-specific information)
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  raaus_id text,
  casa_id text,
  medical_type text,
  medical_expiry date,
  licence_expiry date,
  date_of_birth date,
  prepaid_balance decimal(10,2) DEFAULT 0.00,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Aircraft table
CREATE TABLE IF NOT EXISTS aircraft (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration text UNIQUE NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  type text NOT NULL CHECK (type IN ('single-engine', 'multi-engine', 'helicopter')),
  status text NOT NULL DEFAULT 'serviceable' CHECK (status IN ('serviceable', 'unserviceable', 'maintenance')),
  hourly_rate decimal(8,2) NOT NULL DEFAULT 0.00,
  total_hours decimal(8,1) DEFAULT 0.0,
  last_maintenance date,
  next_maintenance date,
  fuel_capacity decimal(6,1),
  empty_weight decimal(8,1),
  max_weight decimal(8,1),
  seat_capacity integer DEFAULT 2,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  payment_type text NOT NULL CHECK (payment_type IN ('prepaid', 'payg', 'account')),
  notes text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no-show')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Training records table
CREATE TABLE IF NOT EXISTS training_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  aircraft_type text NOT NULL,
  registration text NOT NULL,
  dual_time_min integer DEFAULT 0,
  solo_time_min integer DEFAULT 0,
  comments text NOT NULL,
  formal_briefing boolean DEFAULT false,
  lesson_codes text[] DEFAULT '{}',
  next_lesson text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'locked')),
  instructor_signature_url text,
  student_ack boolean DEFAULT false,
  student_ack_name text,
  instructor_sign_timestamp timestamptz,
  student_ack_timestamp timestamptz,
  attachments text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Syllabus sequences table
CREATE TABLE IF NOT EXISTS syllabus_sequences (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code text UNIQUE NOT NULL,
  title text NOT NULL,
  group_name text NOT NULL,
  order_index integer NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Training sequence results table
CREATE TABLE IF NOT EXISTS training_sequence_results (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  training_record_id uuid NOT NULL REFERENCES training_records(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES syllabus_sequences(id) ON DELETE CASCADE,
  sequence_code text NOT NULL,
  sequence_title text NOT NULL,
  competence text NOT NULL CHECK (competence IN ('NC', 'S', 'C', '-')),
  created_at timestamptz DEFAULT now()
);

-- Endorsements table
CREATE TABLE IF NOT EXISTS endorsements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('PC', 'passenger', 'cross-country', 'radio', 'manual-pitch-prop', 'retractable-gear', 'navigation')),
  date_obtained date NOT NULL,
  expiry_date date,
  instructor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Defects table
CREATE TABLE IF NOT EXISTS defects (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  aircraft_id uuid NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  reported_by text NOT NULL,
  date_reported timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mel', 'fixed', 'deferred')),
  photos text[] DEFAULT '{}',
  mel_notes text,
  severity text CHECK (severity IN ('Minor', 'Major', 'Critical')),
  location text,
  tach_hours decimal(8,1),
  hobbs_hours decimal(8,1),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_number text UNIQUE NOT NULL,
  date date NOT NULL,
  total decimal(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Invoice items table
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity decimal(8,2) NOT NULL,
  rate decimal(8,2) NOT NULL,
  total decimal(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Flight logs table
CREATE TABLE IF NOT EXISTS flight_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  landings integer DEFAULT 0,
  duration decimal(4,2) NOT NULL,
  tach_start decimal(8,1) NOT NULL,
  tach_end decimal(8,1) NOT NULL,
  engine_start decimal(8,1),
  engine_end decimal(8,1),
  total_cost decimal(10,2) NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE aircraft ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE syllabus_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sequence_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE endorsements ENABLE ROW LEVEL SECURITY;
ALTER TABLE defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can read own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Instructors can read students"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    role = 'student' AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for students table
CREATE POLICY "Students can read own data"
  ON students
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Students can update own data"
  ON students
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins and instructors can read all students"
  ON students
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Admins and instructors can manage students"
  ON students
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for aircraft table
CREATE POLICY "All authenticated users can read aircraft"
  ON aircraft
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and instructors can manage aircraft"
  ON aircraft
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for bookings table
CREATE POLICY "Students can read own bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR
    instructor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Students can create own bookings"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Users can update relevant bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid() OR
    instructor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Admins can delete bookings"
  ON bookings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for training records
CREATE POLICY "Students can read own training records"
  ON training_records
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR
    instructor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Instructors can manage training records"
  ON training_records
  FOR ALL
  TO authenticated
  USING (
    instructor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for syllabus sequences
CREATE POLICY "All authenticated users can read syllabus"
  ON syllabus_sequences
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and instructors can manage syllabus"
  ON syllabus_sequences
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for training sequence results
CREATE POLICY "Users can read relevant sequence results"
  ON training_sequence_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM training_records tr
      WHERE tr.id = training_record_id
      AND (
        tr.student_id = auth.uid() OR
        tr.instructor_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      )
    )
  );

CREATE POLICY "Instructors can manage sequence results"
  ON training_sequence_results
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM training_records tr
      WHERE tr.id = training_record_id
      AND (
        tr.instructor_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- RLS Policies for endorsements
CREATE POLICY "Students can read own endorsements"
  ON endorsements
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR
    instructor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Instructors can manage endorsements"
  ON endorsements
  FOR ALL
  TO authenticated
  USING (
    instructor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for defects
CREATE POLICY "All authenticated users can read defects"
  ON defects
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can report defects"
  ON defects
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins and instructors can manage defects"
  ON defects
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

-- RLS Policies for invoices
CREATE POLICY "Students can read own invoices"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE POLICY "Admins can manage invoices"
  ON invoices
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for invoice items
CREATE POLICY "Users can read relevant invoice items"
  ON invoice_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_id
      AND (
        i.student_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      )
    )
  );

CREATE POLICY "Admins can manage invoice items"
  ON invoice_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for flight logs
CREATE POLICY "Users can read relevant flight logs"
  ON flight_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id
      AND (
        b.student_id = auth.uid() OR
        b.instructor_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role IN ('admin', 'instructor')
        )
      )
    )
  );

CREATE POLICY "Instructors can manage flight logs"
  ON flight_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id
      AND (
        b.instructor_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_bookings_student_id ON bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_bookings_instructor_id ON bookings(instructor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_aircraft_id ON bookings(aircraft_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_training_records_student_id ON training_records(student_id);
CREATE INDEX IF NOT EXISTS idx_training_records_instructor_id ON training_records(instructor_id);
CREATE INDEX IF NOT EXISTS idx_training_records_date ON training_records(date);
CREATE INDEX IF NOT EXISTS idx_defects_aircraft_id ON defects(aircraft_id);
CREATE INDEX IF NOT EXISTS idx_defects_status ON defects(status);

-- Insert default syllabus sequences
INSERT INTO syllabus_sequences (code, title, group_name, order_index) VALUES
  ('PS', 'Pre-flight Inspection', 'Pre-Solo', 1),
  ('TC', 'Traffic Circuit', 'Pre-Solo', 2),
  ('TL', 'Touch and Go Landings', 'Pre-Solo', 3),
  ('ST', 'Stalls and Recovery', 'Pre-Solo', 4),
  ('FL', 'Forced Landings', 'Pre-Solo', 5),
  ('NAV', 'Navigation Planning', 'Navigation', 6),
  ('XC', 'Cross Country Flight', 'Navigation', 7),
  ('DR', 'Dead Reckoning', 'Navigation', 8),
  ('RA', 'Radio Procedures', 'Radio', 9),
  ('CTR', 'Controlled Airspace', 'Radio', 10),
  ('EP', 'Emergency Procedures', 'Emergency', 11),
  ('EL', 'Emergency Landing', 'Emergency', 12),
  ('IF', 'Instrument Flying', 'Advanced', 13),
  ('NF', 'Night Flying', 'Advanced', 14),
  ('AER', 'Aerobatics', 'Advanced', 15)
ON CONFLICT (code) DO NOTHING;