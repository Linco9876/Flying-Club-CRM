/*
  # Create Instructor Availability System

  1. New Tables
    - `instructor_weekly_schedules`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users) - The instructor
      - `day_of_week` (integer, 0-6 where 0 is Sunday)
      - `start_time` (time) - Start time for that day
      - `end_time` (time) - End time for that day
      - `is_available` (boolean) - Whether they work on this day
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `instructor_absences`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users) - The instructor
      - `start_date` (date) - Start date of absence
      - `end_date` (date) - End date of absence
      - `reason` (text) - Optional reason for absence
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `instructor_schedule_changes`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users) - The instructor
      - `effective_from` (date) - Date when new schedule starts
      - `day_of_week` (integer, 0-6 where 0 is Sunday)
      - `start_time` (time)
      - `end_time` (time)
      - `is_available` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Admins can manage all schedules
    - Instructors can view and manage their own schedules
    - Students can view instructor availability (read-only)

  3. Functions
    - Function to get instructor availability for a specific date range
    - Function to check if an instructor is available at a specific time
*/

-- Create instructor_weekly_schedules table
CREATE TABLE IF NOT EXISTS instructor_weekly_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);

ALTER TABLE instructor_weekly_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all weekly schedules"
  ON instructor_weekly_schedules FOR ALL
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Instructors can manage own weekly schedules"
  ON instructor_weekly_schedules FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid() AND 
    has_role('instructor')
  )
  WITH CHECK (
    user_id = auth.uid() AND 
    has_role('instructor')
  );

CREATE POLICY "All authenticated users can view weekly schedules"
  ON instructor_weekly_schedules FOR SELECT
  TO authenticated
  USING (true);

-- Create instructor_absences table
CREATE TABLE IF NOT EXISTS instructor_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (end_date >= start_date)
);

ALTER TABLE instructor_absences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all absences"
  ON instructor_absences FOR ALL
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Instructors can manage own absences"
  ON instructor_absences FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid() AND 
    has_role('instructor')
  )
  WITH CHECK (
    user_id = auth.uid() AND 
    has_role('instructor')
  );

CREATE POLICY "All authenticated users can view absences"
  ON instructor_absences FOR SELECT
  TO authenticated
  USING (true);

-- Create instructor_schedule_changes table
CREATE TABLE IF NOT EXISTS instructor_schedule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  effective_from date NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE instructor_schedule_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all schedule changes"
  ON instructor_schedule_changes FOR ALL
  TO authenticated
  USING (has_role('admin'))
  WITH CHECK (has_role('admin'));

CREATE POLICY "Instructors can manage own schedule changes"
  ON instructor_schedule_changes FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid() AND 
    has_role('instructor')
  )
  WITH CHECK (
    user_id = auth.uid() AND 
    has_role('instructor')
  );

CREATE POLICY "All authenticated users can view schedule changes"
  ON instructor_schedule_changes FOR SELECT
  TO authenticated
  USING (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_user_id ON instructor_weekly_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_day ON instructor_weekly_schedules(day_of_week);
CREATE INDEX IF NOT EXISTS idx_absences_user_id ON instructor_absences(user_id);
CREATE INDEX IF NOT EXISTS idx_absences_dates ON instructor_absences(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_id ON instructor_schedule_changes(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_changes_effective ON instructor_schedule_changes(effective_from);

-- Function to check if instructor is available at a specific date and time
CREATE OR REPLACE FUNCTION is_instructor_available(
  p_user_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_day_of_week integer;
  v_is_absent boolean;
  v_schedule record;
BEGIN
  -- Get day of week (0 = Sunday)
  v_day_of_week := EXTRACT(DOW FROM p_date);

  -- Check if instructor is on absence
  SELECT EXISTS(
    SELECT 1 FROM instructor_absences
    WHERE user_id = p_user_id
    AND p_date >= start_date
    AND p_date <= end_date
  ) INTO v_is_absent;

  IF v_is_absent THEN
    RETURN false;
  END IF;

  -- Check for schedule changes effective from this date or earlier
  SELECT * INTO v_schedule
  FROM instructor_schedule_changes
  WHERE user_id = p_user_id
  AND day_of_week = v_day_of_week
  AND effective_from <= p_date
  ORDER BY effective_from DESC
  LIMIT 1;

  -- If schedule change exists, use it
  IF FOUND THEN
    IF NOT v_schedule.is_available THEN
      RETURN false;
    END IF;
    RETURN p_start_time >= v_schedule.start_time 
      AND p_end_time <= v_schedule.end_time;
  END IF;

  -- Otherwise, check weekly schedule
  SELECT * INTO v_schedule
  FROM instructor_weekly_schedules
  WHERE user_id = p_user_id
  AND day_of_week = v_day_of_week;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT v_schedule.is_available THEN
    RETURN false;
  END IF;

  RETURN p_start_time >= v_schedule.start_time 
    AND p_end_time <= v_schedule.end_time;
END;
$$;

-- Function to get instructor availability for a date range
CREATE OR REPLACE FUNCTION get_instructor_availability(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  availability_date date,
  day_of_week integer,
  start_time time,
  end_time time,
  is_available boolean,
  is_absence boolean,
  absence_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_date date;
  v_day_of_week integer;
  v_schedule record;
  v_absence record;
BEGIN
  v_current_date := p_start_date;

  WHILE v_current_date <= p_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);

    -- Check for absence
    SELECT * INTO v_absence
    FROM instructor_absences
    WHERE user_id = p_user_id
    AND v_current_date >= start_date
    AND v_current_date <= end_date
    LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT 
        v_current_date,
        v_day_of_week,
        '00:00:00'::time,
        '00:00:00'::time,
        false,
        true,
        v_absence.reason;
    ELSE
      -- Check for schedule change
      SELECT * INTO v_schedule
      FROM instructor_schedule_changes
      WHERE user_id = p_user_id
      AND day_of_week = v_day_of_week
      AND effective_from <= v_current_date
      ORDER BY effective_from DESC
      LIMIT 1;

      IF FOUND THEN
        RETURN QUERY SELECT 
          v_current_date,
          v_day_of_week,
          v_schedule.start_time,
          v_schedule.end_time,
          v_schedule.is_available,
          false,
          null::text;
      ELSE
        -- Use weekly schedule
        SELECT * INTO v_schedule
        FROM instructor_weekly_schedules
        WHERE user_id = p_user_id
        AND day_of_week = v_day_of_week;

        IF FOUND THEN
          RETURN QUERY SELECT 
            v_current_date,
            v_day_of_week,
            v_schedule.start_time,
            v_schedule.end_time,
            v_schedule.is_available,
            false,
            null::text;
        ELSE
          RETURN QUERY SELECT 
            v_current_date,
            v_day_of_week,
            '00:00:00'::time,
            '00:00:00'::time,
            false,
            false,
            null::text;
        END IF;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;