export async function getHospitalId(): Promise<string | null> {
  const { supabase } = await import('@/integrations/supabase/client')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('users')
    .select('hospital_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return data?.hospital_id || null
}
