import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Read migration file
const migrationPath = join(__dirname, 'supabase/migrations/20251016070900_fix_bookings_insert_policy.sql');
const migrationSQL = readFileSync(migrationPath, 'utf8');

// Execute migration
async function applyMigration() {
  try {
    console.log('Applying migration...');

    // Split by semicolon and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('/*') && !s.startsWith('--'));

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 50)}...`);
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      if (error) {
        console.error('Error:', error);
        throw error;
      }
    }

    console.log('Migration applied successfully!');
  } catch (error) {
    console.error('Failed to apply migration:', error);
    process.exit(1);
  }
}

applyMigration();
