-- Create inbox_messages table
CREATE TABLE public.inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id),
  channel text NOT NULL,
  direction text DEFAULT 'inbound',
  subject text,
  message_body text NOT NULL,
  sender_name text,
  sender_phone text,
  is_read boolean DEFAULT false,
  is_starred boolean DEFAULT false,
  assigned_to uuid,
  priority text DEFAULT 'normal',
  tags text[] DEFAULT '{}',
  parent_id uuid REFERENCES public.inbox_messages(id),
  status text DEFAULT 'open',
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz DEFAULT now()
);

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_inbox_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.channel NOT IN ('whatsapp','in_app','feedback','grievance','portal') THEN
    RAISE EXCEPTION 'Invalid channel: %', NEW.channel;
  END IF;
  IF NEW.direction NOT IN ('inbound','outbound') THEN
    RAISE EXCEPTION 'Invalid direction: %', NEW.direction;
  END IF;
  IF NEW.priority NOT IN ('low','normal','high','urgent') THEN
    RAISE EXCEPTION 'Invalid priority: %', NEW.priority;
  END IF;
  IF NEW.status NOT IN ('open','in_progress','resolved','closed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_inbox_message
  BEFORE INSERT OR UPDATE ON public.inbox_messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_inbox_message();

-- RLS
ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital inbox"
  ON public.inbox_messages FOR SELECT
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can manage own hospital inbox"
  ON public.inbox_messages FOR ALL
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.inbox_messages;