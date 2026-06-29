import { supabase } from '@/integrations/supabase/client';

export async function logAudit(params: {
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, any>;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from('users')
      .select('id, full_name, role, hospital_id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!userData) return;

    await (supabase as any).from('audit_log').insert({
      hospital_id: userData.hospital_id,
      user_id: userData.id,
      user_name: userData.full_name,
      user_role: userData.role,
      action: params.action,
      module: params.module,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      details: params.details || {},
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}
