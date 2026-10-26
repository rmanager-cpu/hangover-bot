# Sleeper, MyFantasyLeague and Yahoo: what it takes to connect

Research brief, Oct 25 2026. Three research passes, one per host. The deciding claims were
then checked against each host's own pages the same night: Yahoo's access page, Sleeper's
Terms of Use (dated Oct 6 2026), and MFL's API page. Anything not confirmed is marked
**unconfirmed**. Nothing here changes the rule in `CLAUDE.md`: ESPN only at launch, the rest
"coming soon".

## Bottom line

- **Yahoo blocks what we need most.** Since 2026 its API is read-only ("write access is not
  available at this time"). Every app needs a hand-reviewed approval and a signed agreement.
  Yahoo also sells its own auto-lineup feature (Assistant GM, in Fantasy Plus).
- **Sleeper can be read with no login, but its terms forbid automatic moves.** Since July
  2026 the terms ban giving your Sleeper token to an unapproved app, and Sleeper can suspend
  the user's account for it. The only allowed route is a written partner agreement with
  Sleeper.
- **MyFantasyLeague is the only one with an official way to change a lineup.** The price:
  - users give us their MFL password, which we store encrypted;
  - some leagues lock every lineup before Sunday, which rules out a Sunday swap;
  - MFL's site terms say "noncommercial", so we need its written permission to charge.

## Side by side

| | **Sleeper** | **MyFantasyLeague** | **Yahoo** |
|---|---|---|---|
| Official API | Yes, read-only | Yes, reads and writes | Yes, but read-only now |
| How the user connects | Their username, no password (reads); their app token (writes) | MFL username and password | Yahoo sign-in page (OAuth), after Yahoo approves our app |
| Alerts (read-only) | **Easy**, but a paid app needs a Sleeper licence | **Easy** | **Only if Yahoo approves us** |
| Automatic bench swap | Works only through Sleeper's private API, **against its terms** | **Yes, officially** | **No** |
| Add/drop a free agent | Private API only, against its terms; unproven | Yes, but only in first-come leagues and windows | No |
| Injury status | Yes | Yes (updated daily) | Yes |
| Projections | Yes, from an undocumented endpoint | Yes, scored for each league | **No per-player projections** |
| Kickoff times | Yes | Yes | No (we'd use our own feed) |
| Percent rostered (No-Cray rule 5) | No | Only across all MFL, for players above 2% | Yes |
| Paid apps allowed? | Only with a licence from Sleeper | Unclear: ask MFL in writing | Private agreement; old terms banned commercial and competing apps |
| Rough build effort (our estimate) | 1 to 2 weeks for read-only | 2 to 3 weeks with writes | 1.5 to 3 weeks for read-only, if approved |

## Sleeper

**What works.**
- **Finding leagues:** anyone's leagues come from their username (`api.sleeper.app/v1`), with no login.
- **Data:** rosters, injury tags, projections and kickoff times are all readable.
- **Limits:** stay under 1,000 calls a minute. Cache the player list once a day; it is now 15 MB, not the 5 MB the docs say.

**What's blocked.** The official API cannot write.
- **The private route:** lineups and add/drops go through Sleeper's own private API, using the user's token. Open-source tools have changed lineups this way.
- **The terms:** since July 24 2026 Sleeper's terms forbid exactly this. A user may not "use, share, disclose, or provide your login credentials, access tokens, session identifiers … to any third-party", or connect their account to a third-party product for its "commercial or business purposes", without Sleeper's written consent (§11.1). Sleeper may "immediately suspend or terminate your account, revoke any active sessions … and/or take technical measures to block" the app (§11.2).
- **No loophole:** a user handing us a token "does not constitute authorization from Sleeper" (§11.3).
- **The official API is "free to use for non-commercial purposes"**; commercial use needs a licence.

**Already built into Sleeper:** "Player AutoSubs" moves a bench player in when a starter is inactive. The user sets it up in Sleeper's app, and the commissioner must enable it.

**What it would take:**
1. Email **api@sleeper.app**: ask for a commercial licence for reads, and ask about becoming an "Approved Integration Partner" (§2.9), the only route to automatic moves.
2. Until there's an agreement: a **read-only** Sleeper connector at most. It would send alerts and point the user to swap in Sleeper or set an AutoSub.

**Data quirks:**
- **Defences:** a defence's id is its team code ("DET"), not a negative number as on ESPN.
- **Projections:** players who are out or on bye have no projection at all, rather than zero.
- **Our rules:** the status has to decide, which the engine already allows for.

## MyFantasyLeague (MFL)

**What works.** Everything we need is official and documented.
- **Reads:** the user's leagues, rosters, starters, injuries, projections scored for that league, and kickoff times.
- **Lineup write:** a documented call sets the lineup.
- **Add/drop:** a documented call adds and drops at once, in first-come leagues.
- **Terms:** MFL's API terms say the data is "provided free to anyone to use in almost any way". Apps built on it already set lineups, and one charges $1.99.

**The catches.**
1. **The password.** The user gives us their MFL username and password. Writes need a session that only a login can produce; the read-only API key can't write. We'd keep the password encrypted, as we do the ESPN session, so the server can sign in again when the session expires. That is more sensitive than anything we hold today.
2. **Lineup deadlines vary by league.**
   - "Gametime" leagues lock each player at his kickoff, which works for us.
   - "Kickoff" leagues lock the whole lineup at the first game of the week, usually Thursday.
   - "Early" leagues lock everything at 1 PM ET Sunday.
   - In the last two, a late Sunday fix is impossible, and we couldn't confirm the API says which rule a league uses.
3. **Each write replaces the whole lineup, and mistakes return "OK".** A write that does nothing can still answer OK. Our rule that a fresh read must confirm every write is essential here.
4. **Commissioners can switch abilities off**, team by team: submitting lineups, add/drops, IR moves. Best Ball leagues can't submit lineups at all.
5. **Game-day throttling.** MFL limits traffic per internet address and lowers the limits while games are on. Our checks run from Supabase's servers, so every user's traffic shares a few addresses.
6. **Terms and owner.** MFL's site terms grant "noncommercial and personal use only", and its rules bar reselling the service without permission. The docs have barely changed since 2022, and the company changed hands in 2024.

**What it would take:**
1. Email **support@myfantasyleague.com** for written permission to offer an MFL feature in a paid app.
2. Register our app with MFL for higher traffic limits.
3. Get a real MFL league to test in. The free trial only covers the preseason.

## Yahoo

**What's blocked.**
- **Writes:** Yahoo's access page says: "The Yahoo Fantasy Sports API currently provides read access only. Write access is not available at this time."
- **Approval:** every app is now "reviewed by the Yahoo Fantasy Sports team", followed by a private "API Access and Use Agreement" whose text isn't public.
- **Old apps cut off:** apps registered the old way lost access in July 2026, without notice.
- **Turnaround:** developers report 3 to 8 weeks, or no answer.
- **A refusal:** one fantasy-assistant app was refused on Oct 19 2026 as not aligned with Yahoo's policies (US and Canada only).

**Also against us:**
- **Data:** no per-player projections and no kickoff times in the API.
- **Rate limits:** none published.
- **Terms:** the old Yahoo terms banned commercial apps and apps that compete with Yahoo, and its general terms say Yahoo user data must be deleted within 24 hours. Whether either carries into the new agreement is **unconfirmed**.
- **Competition:** Yahoo sells the same feature: Assistant GM makes moves automatically for Fantasy Plus subscribers.

**What it would take:** apply at sports.yahoo.com/developer/access for read access (alerts only). Describe automatic swaps in the notes, as the page invites.
- **Without written permission, plan no automatic Yahoo moves.**
- **Unofficial route:** a Yahoo browser session works technically, but the terms forbid it.

## How this compares with ESPN

ESPN is in the same legal category as Sleeper's private route, and we already live with it.
- **No official API:** we use the session the user's own sign-in produces.
- **Disney's terms** forbid automated and commercial access without written permission (`TERMS-AND-CONSENT-2026-10-03.md` §4.1).

The differences are enforcement and clarity:
- **Yahoo** has technically switched writes off.
- **Sleeper** names third-party token sharing and account suspension in plain words, and its users would be the ones at risk.
- **ESPN** is the risk the lawyer is reviewing now.

## Recommended order

1. **Keep ESPN as the launch host**, as planned.
2. **Send three emails now.** They cost nothing, and the answers decide everything else:
   - **Sleeper:** licence and partner programme.
   - **MFL:** written permission for a paid app.
   - **Yahoo:** apply for read access, ask about writes in the notes.
3. **Sleeper alerts next** if Sleeper licenses it. It has the largest audience of the three among younger players, and alerts need no login. Automatic Sleeper moves only with a partner agreement.
4. **MFL with automatic swaps** if MFL says yes in writing. It's the only official write path, but the audience is smaller (serious, often paid leagues), and it means holding passwords.
5. **Yahoo last**, read-only, if approved.

I can draft the three emails whenever you want them.

## Sources

- Yahoo access page: https://sports.yahoo.com/developer/access/
- Yahoo API docs: https://sports.yahoo.com/developer/docs/
- Assistant GM: https://help.yahoo.com/kb/assistant-gm-sln37119.html
- Developers cut off in July 2026: https://github.com/uberfastman/yfpy/issues/84
- Refusal on Oct 19 2026: https://github.com/Allen930311/fantasy-hoops-decision-assistant/issues/7
- Sleeper API: https://docs.sleeper.com/
- Sleeper Terms of Use, Oct 6 2026 (§2.9, §9.2, §11.1 to 11.3): https://support.sleeper.com/en/articles/5486620-general-terms-of-use
- Sleeper terms before and after the July 2026 change: https://tostracker.app/document/sleeper-fantasy/version/939886 and https://tostracker.app/document/sleeper-fantasy/version/956526
- Player AutoSubs: https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work
- Sleeper private API, as mapped by others: https://github.com/Filip-Kin/sleeper-graphql
- MFL API: https://api.myfantasyleague.com/2026/api_info (details: `?STATE=details`)
- MFL Terms: http://home.myfantasyleague.com/terms.html
- MFL Acceptable Use: http://home.myfantasyleague.com/use.html
- MFL lineup deadlines: https://www.myfantasyleague.com/2026/support?L=&CATEGORY=Players%20%26%20Lineups&SUBCATEGORY=Lineup%20Setup
- MFL sale, 2024: https://www.prnewswire.com/news-releases/first-pick-labs-inc-owner-of-draft-hero-llc-acquires-sideline-software-inc-the-company-behind-myfantasyleaguecom-302058047.html
