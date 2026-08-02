-- ══════════════════════════════════════════════════════════════════════════
-- grn-invoices: actually make the bucket private
--
-- 20260327072255 created it public=true. 20260613140000 (lines 26-28) tried to
-- correct that with:
--     INSERT INTO storage.buckets (id, name, public)
--     VALUES ('grn-invoices', 'grn-invoices', false)
--     ON CONFLICT (id) DO NOTHING;
-- which is a no-op wherever the bucket already existed — i.e. every environment
-- that ran the earlier migration. The bucket has been public ever since, and
-- GRNPanel.tsx's getPublicUrl call working is the proof.
--
-- The four hospital-scoped RLS policies from 20260613140000 are correct and
-- already in place; only the bucket flag needs fixing.
-- ══════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets SET public = false WHERE id = 'grn-invoices';
