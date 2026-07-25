import { createClient } from '@supabase/supabase-js';

export const publicSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
export const publicSupabaseKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!publicSupabaseUrl || !publicSupabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(publicSupabaseUrl, publicSupabaseKey);
