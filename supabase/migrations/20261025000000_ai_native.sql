-- AI Native (docs/AI-NATIVE.md): the Droppable switches, Roster Advice, and the add/drop
-- an action carries. Runs after 20261003000000_beta.sql; nothing here changes a row.

-- The players the user switched to Droppable (ids), and when Roster Advice last ran.
alter table public.connections
  add column droppable text[] not null default '{}',
  add column advised_at timestamptz;

-- The client flips the Droppable switches; advised_at is the checker's alone.
grant update (droppable) on public.connections to authenticated;

-- An action may now be a piece of advice, and may carry the add and drop that come before
-- its moves (AI Native's T-15 step, or an advice item), plus where advice came from.
alter table public.actions
  drop constraint actions_kind_check,
  add constraint actions_kind_check check (kind in ('notify', 'wait', 'propose', 'ask_user', 'execute', 'advise')),
  add column "transaction" jsonb,
  add column sources jsonb;

-- Two new notices: the T-3 all-clear, and new advice waiting.
alter table public.activity
  drop constraint activity_type_check,
  add constraint activity_type_check check (type in (
    'STATUS_CHANGED', 'ACTION_REQUIRED', 'ACTION_RECOMMENDED', 'ACTION_COMPLETED', 'ACTION_FAILED', 'PREGAME_WARNING', 'ALL_CLEAR', 'ADVICE'
  ));

-- RosterBots' adds and drops, for the no-churn rule; this period's landed moves, for the T-15 step.
create index actions_transactions on public.actions (connection_id) where "transaction" is not null and status in ('approved', 'done', 'failed');
create index actions_done_executes on public.actions (connection_id, period) where kind = 'execute' and status = 'done';
