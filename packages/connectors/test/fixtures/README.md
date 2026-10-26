# Fixtures

**Hand-built, in ESPN's shape, not captured.** Megacast's fixtures are all draft-room
wire captures; none covers rosters, injuries, schedules or lineup writes (see
docs/MEGACAST-AUDIT.md). Replace these with real captures, cookies stripped, the first
time a session can reach ESPN. `free-agents.json` is the player pool (view
`kona_player_info`) as community clients describe it: `players[]` with `onTeamId`,
`status` (`FREEAGENT` / `WAIVERS` / `ONTEAM`), `ownership.percentOwned` and the season
projection as the `scoringPeriodId: 0` stat; never seen from this code.
