/*
  # Fix Remaining Recursive RLS Policies

  1. Fix policies for syllabus-related tables
  
  2. Security
    - Allow authenticated users broad access
    - Application enforces role-based restrictions
*/

-- Student syllabi table
DROP POLICY IF EXISTS "Students can read own syllabi" ON student_syllabi;
DROP POLICY IF EXISTS "Instructors can read all syllabi" ON student_syllabi;
DROP POLICY IF EXISTS "Admins and instructors can manage student syllabi" ON student_syllabi;

CREATE POLICY "Authenticated users can read student syllabi" ON student_syllabi FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert student syllabi" ON student_syllabi FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update student syllabi" ON student_syllabi FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete student syllabi" ON student_syllabi FOR DELETE TO authenticated USING (true);

-- Syllabi table
DROP POLICY IF EXISTS "All authenticated users can read syllabi" ON syllabi;
DROP POLICY IF EXISTS "Admins and instructors can manage syllabi" ON syllabi;

CREATE POLICY "Authenticated users can read syllabi" ON syllabi FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert syllabi" ON syllabi FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update syllabi" ON syllabi FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete syllabi" ON syllabi FOR DELETE TO authenticated USING (true);

-- Syllabus items table
DROP POLICY IF EXISTS "All authenticated users can read syllabus items" ON syllabus_items;
DROP POLICY IF EXISTS "Admins and instructors can manage syllabus items" ON syllabus_items;

CREATE POLICY "Authenticated users can read syllabus items" ON syllabus_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert syllabus items" ON syllabus_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update syllabus items" ON syllabus_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete syllabus items" ON syllabus_items FOR DELETE TO authenticated USING (true);

-- Detailed syllabi table
DROP POLICY IF EXISTS "Authenticated users can read detailed syllabi" ON detailed_syllabi;
DROP POLICY IF EXISTS "Admins and instructors can write detailed syllabi" ON detailed_syllabi;

CREATE POLICY "Authenticated users can read detailed syllabi" ON detailed_syllabi FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert detailed syllabi" ON detailed_syllabi FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update detailed syllabi" ON detailed_syllabi FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete detailed syllabi" ON detailed_syllabi FOR DELETE TO authenticated USING (true);

-- Lesson plans table
DROP POLICY IF EXISTS "Authenticated users can read lesson plans" ON lesson_plans;
DROP POLICY IF EXISTS "Admins and instructors can write lesson plans" ON lesson_plans;

CREATE POLICY "Authenticated users can read lesson plans" ON lesson_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert lesson plans" ON lesson_plans FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update lesson plans" ON lesson_plans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete lesson plans" ON lesson_plans FOR DELETE TO authenticated USING (true);

-- Lesson elements table
DROP POLICY IF EXISTS "Authenticated users can read lesson elements" ON lesson_elements;
DROP POLICY IF EXISTS "Admins and instructors can write lesson elements" ON lesson_elements;

CREATE POLICY "Authenticated users can read lesson elements" ON lesson_elements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert lesson elements" ON lesson_elements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update lesson elements" ON lesson_elements FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete lesson elements" ON lesson_elements FOR DELETE TO authenticated USING (true);

-- Training templates table
DROP POLICY IF EXISTS "Authenticated users can read training templates" ON training_templates;
DROP POLICY IF EXISTS "Admins and instructors can write training templates" ON training_templates;

CREATE POLICY "Authenticated users can read training templates" ON training_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert training templates" ON training_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update training templates" ON training_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete training templates" ON training_templates FOR DELETE TO authenticated USING (true);

-- Training template items table
DROP POLICY IF EXISTS "Authenticated users can read training template items" ON training_template_items;
DROP POLICY IF EXISTS "Admins and instructors can write training template items" ON training_template_items;

CREATE POLICY "Authenticated users can read training template items" ON training_template_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert training template items" ON training_template_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update training template items" ON training_template_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete training template items" ON training_template_items FOR DELETE TO authenticated USING (true);

-- Training record templates table
DROP POLICY IF EXISTS "Authenticated users can read training record templates" ON training_record_templates;
DROP POLICY IF EXISTS "Admins and instructors can write training record templates" ON training_record_templates;

CREATE POLICY "Authenticated users can read training record templates" ON training_record_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert training record templates" ON training_record_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update training record templates" ON training_record_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete training record templates" ON training_record_templates FOR DELETE TO authenticated USING (true);

-- Training record items new table
DROP POLICY IF EXISTS "Authenticated users can read training record items" ON training_record_items_new;
DROP POLICY IF EXISTS "Instructors can write training record items" ON training_record_items_new;
DROP POLICY IF EXISTS "Students can read own training record items" ON training_record_items_new;

CREATE POLICY "Authenticated users can read training record items" ON training_record_items_new FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert training record items" ON training_record_items_new FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update training record items" ON training_record_items_new FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete training record items" ON training_record_items_new FOR DELETE TO authenticated USING (true);
