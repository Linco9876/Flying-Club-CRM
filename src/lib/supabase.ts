import { createClient } from '@supabase/supabase-js';
import { markPasswordSetupFromCurrentUrl } from '../utils/invitationSetup';

export const publicSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
export const publicSupabaseKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!publicSupabaseUrl || !publicSupabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

// Preserve setup intent before the Auth client consumes one-time URL details.
markPasswordSetupFromCurrentUrl();

export const supabase = createClient(publicSupabaseUrl, publicSupabaseKey);
