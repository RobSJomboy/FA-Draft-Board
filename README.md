# Free Agent Draft — Talkin' Baseball

Draft board + pick reveal for the free agent draft. Four contestants (Jake, Trev, Jolly, Rose by default — rename any time), snake order 1-2-3-4-4-3-2-1, 8 rounds.

## Files
- `index.html` — control page. Open it anywhere.
- `display.html?room=<room>` — the OBS Browser Source, 1920×1080, transparent.
  - `&view=board` always shows the board (a follow-along screen)
  - `&bg=paper` cream background instead of transparent
- `fad.js`, `fad.css` — shared by both.

Sync runs over the Jomboy relay (`jomboy-relay.jomboymedia.workers.dev`), same as the 5-Tool and bracket tools. Hit **Copy OBS link** on the control page and paste it into the Browser Source.

## Running a pick
1. Click a player in the pool (live MLB free agent list, best 2026 WAR first; "Search all MLB players" adds anyone else).
2. Click the team and the contract length. The player's last team is marked STAYS.
3. Reveal in three steps: **1** player + arrow, **2** team logo, **3** contract stamp. Keys `1` `2` `3`, `H` hides, `B` toggles the board.
4. **Lock in pick** — the board updates and the next contestant goes on the clock.

Picks save in the browser and on the relay. **Save backup** downloads a JSON file. **Pull from relay** loads the draft on a second computer.

## Rules (the **Rules** button on the control page)
- 10 — correct player/team match, new team
- 5 — correct player/team match, re-signing
- 5 — correct contract length (team doesn't need to be right)
- Bonus +5 — player has won a major award (Cy Young, MVP, ROY), needs the right team
- Bonus +5 — player was an All-Star this past season, needs the right team
- Max 2 re-signings per person (max 1 of them a QO player returning)
- Max 2 one-year deals per person

The control page tracks each person's re-signings, QO returns and one-year deals, and warns before a pick breaks a limit.
Scoring isn't automatic yet; picks keep the team, years and award tags so it can be added once players sign.
