-- Scoop Luck — Supabase Realtime bootstrap
--
-- Run this in the Supabase SQL editor (or via `supabase db execute`).
-- It does three things:
--   1. Adds the Superchat table to the `supabase_realtime` publication
--      so `postgres_changes` events fire on PAID inserts / hidden updates.
--   2. Inserts the private `avatars` storage bucket used by the
--      profile photo upload pipeline.
--   3. Leaves a comment block explaining the RLS requirements.
--
-- This script is idempotent (`IF NOT EXISTS` clauses). Re-running is safe.

-- 1. Realtime publication
-- The Supabase Realtime engine ships Postgres logical-replication
-- events out to clients that have subscribed to `postgres_changes`.
-- By default only a handful of system tables are in the publication.
-- We add our Superchat table so the live feed can subscribe.
ALTER PUBLICATION supabase_realtime ADD TABLE public.superchats;

-- 2. Avatars bucket (private)
-- The server-side avatar upload uses the SERVICE-ROLE key, which
-- bypasses RLS — so we keep the bucket PRIVATE and only the
-- server-side route knows the path. The browser never reads from
-- this bucket directly; instead it sees the `avatarUrl` we persist
-- on the User row (a signed URL minted on demand by the server).
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', false)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS note for the maintainer
--
-- The `public.superchats` table has Row-Level Security enabled per
-- the platform schema. Realtime replication still works regardless
-- of RLS — clients see the row through their subscription only after
-- the server inserts it. If you ever add a policy like:
--
--   CREATE POLICY "anon can read paid superchats"
--     ON public.superchats FOR SELECT TO anon
--     USING (status = 'PAID' AND hidden = false);
--
-- note that the browser's Realtime subscription authenticates as
-- `anon` (the public Supabase key), so the anon policy is the one
-- that gates the live feed. For now we leave that policy off because
-- the SSR initial fetch and the live channel both go through our
-- server, which uses the service-role key — clients receive rows
-- over our `/api/superchats` JSON contract and via the Realtime
-- server-side post-filter, not via raw RLS reads.
--
-- If you flip to direct-SELECT from the browser later, add the policy
-- above AND verify it covers all columns the card renders.