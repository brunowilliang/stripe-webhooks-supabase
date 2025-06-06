import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabase = createClient<Database>(
  Bun.env.SUPABASE_URL as string,
  Bun.env.SUPABASE_ANON_KEY as string
)

// Service client for webhooks (bypasses RLS)
export const supabaseService = createClient<Database>(
  Bun.env.SUPABASE_URL as string,
  Bun.env.SUPABASE_SERVICE_ROLE_KEY as string
)