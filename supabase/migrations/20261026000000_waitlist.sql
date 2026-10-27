-- The waitlist on www.rosterbots.com (Oct 26 2026): everything is "coming soon", so the site
-- collects an email and a phone (Android or iPhone) for RosterBots, or an email for MegaCast.
-- The site posts straight to the REST API with the publishable key. Anyone may add a row;
-- nobody can read, change or delete one through the API. The owner reads the list in the
-- dashboard (Table Editor), and the Android emails become Play closed-test testers.

create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null
    check (char_length(email) between 3 and 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  product text not null default 'rosterbots' check (product in ('rosterbots', 'megacast')),
  platform text check (platform in ('android', 'iphone')),
  source text check (source is null or char_length(source) <= 40),
  created_at timestamptz not null default now(),
  constraint waitlist_platform_for_rosterbots check (product <> 'rosterbots' or platform is not null)
);

-- One row per email, product and phone; a second sign-up answers 409, which the site reads as
-- "already on the list".
create unique index waitlist_once on public.waitlist (lower(email), product, coalesce(platform, ''));

alter table public.waitlist enable row level security;

create policy "anyone can join the waitlist" on public.waitlist
  for insert to anon, authenticated with check (true);

revoke all on public.waitlist from anon, authenticated;
grant insert (email, product, platform, source) on public.waitlist to anon, authenticated;
