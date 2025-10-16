import { supabase } from './src/lib/supabase';

async function fixPolicies() {
  console.log('Fixing bookings insert policies...');

  try {
    // Drop existing policy
    const { error: dropError } = await supabase.rpc('exec_sql', {
      sql: 'DROP POLICY IF EXISTS "Students can create own bookings" ON bookings;'
    });

    if (dropError) {
      console.error('Error dropping policy:', dropError);
    }

    // Create new policy for students
    const { error: studentPolicyError } = await supabase.rpc('exec_sql', {
      sql: `CREATE POLICY "Students can insert own bookings"
        ON bookings
        FOR INSERT
        TO authenticated
        WITH CHECK (student_id = auth.uid());`
    });

    if (studentPolicyError) {
      console.error('Error creating student policy:', studentPolicyError);
    }

    // Create policy for admins/instructors
    const { error: adminPolicyError } = await supabase.rpc('exec_sql', {
      sql: `CREATE POLICY "Admins and instructors can insert any booking"
        ON bookings
        FOR INSERT
        TO authenticated
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'instructor')
          )
        );`
    });

    if (adminPolicyError) {
      console.error('Error creating admin policy:', adminPolicyError);
    }

    console.log('Policies updated successfully!');
  } catch (error) {
    console.error('Error:', error);
  }
}

fixPolicies();
