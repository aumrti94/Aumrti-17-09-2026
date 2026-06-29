
-- Step 0: Add auth_user_id column if it doesn't exist yet (fresh DB path)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 1: Drop the problematic FK constraint on users.id → auth.users
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- Step 2: Backfill auth_user_id for existing users whose id matches an auth user
UPDATE public.users SET auth_user_id = id WHERE auth_user_id IS NULL;

-- Step 3: Update get_user_hospital_id to use auth_user_id
CREATE OR REPLACE FUNCTION public.get_user_hospital_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
$$;

-- Step 4: Update has_role to use auth_user_id
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE auth_user_id = _user_id AND role = _role
  )
$$;

-- Step 5: Index on auth_user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);
