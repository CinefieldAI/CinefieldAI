-- RLS grant hardening: TRUNCATE removal + server-only table lockdown
revoke truncate on all tables in schema public from anon, authenticated;

revoke all on public.credit_wallets, public.credit_ledger, public.credit_reservations,
              public.plan_limits, public.model_pricing, public.model_routes,
              public.models, public.model_versions, public.providers, public.provider_models,
              public.outbox_events, public.outbox_tx_proof, public.workflow_start_outbox,
              public.security_events, public.media_safety_audit, public.media_release_approvals,
              public.generation_attempts
       from anon, authenticated;

drop policy if exists credit_wallets_select_own on public.credit_wallets;
drop policy if exists credit_ledger_select_own  on public.credit_ledger;
drop policy if exists plan_limits_select_all    on public.plan_limits;

alter table public.profiles      force row level security;
alter table public.projects      force row level security;
alter table public.generations   force row level security;
alter table public.media_assets  force row level security;
