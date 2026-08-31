# Draft Room

Free, and MIT licensed. Built by [@AFantasyKing](https://x.com/AFantasyKing).

A fantasy football draft tool with two modes. **Mock draft** simulates a room
against you: live ADP for your scoring format, any roster shape, your own
ranking file, and dials for how hard the computer teams lean on each position.
**Draft assistant** simulates nothing: it follows your real Sleeper draft as it
happens, mirroring every pick onto the board so your rankings and availability
always face the actual room.

---

## Run it

You need **Node 20.19 or newer**, or **Node 22.12 or newer**, which is the floor
Vite sets. Nothing else: neither data feed asks for an API key, there is no
database, and there is no account to make.

```
npm run install:all
npm run dev
```

Then open **http://localhost:5177**.

`npm run dev` starts both halves at once. The data service listens on 5178 and
the client proxies `/api` to it, so the browser only ever talks to one origin
and never meets a CORS error. Every setting you make is kept in your own
browser, and nothing you set leaves it.

---

## What it does

**Your Sleeper leagues, in one click.** Paste a league ID once and both the
league and its settings are kept. Loading one sets the teams, rounds, roster
shape, scoring and draft order. The league's shape is pulled on first use and
then only when you press Refresh from Sleeper; the parts that move — team
names, declared keepers, the draft order — are read every time.

**Real team names and your real seat.** Once a league draws its draft order,
the board reads "The Waiver Wire Warriors" rather than "Team 4". Say which
manager you are once and your draft slot follows, in mocks as well as live, so
the picks you rehearse are the picks you get.

**Live ADP, per scoring format and per league size.** Standard, half PPR, PPR,
superflex and dynasty boards, each about 600 players, rebuilt on request and
cached for six hours. Rookie drafts are deliberately not offered: neither free
source has usable ADP for them, and a format that runs on nothing is worse than
a missing one.

**Any roster shape.** Counters for QB, RB, WR, TE, FLEX, SUPERFLEX, K, DEF and
bench. The number of rounds follows the roster total until you set it yourself.
Two to sixteen teams, one to thirty rounds, snake or linear or third round
reversal.

**Your own rankings, matched properly.** Upload or paste a CSV. The columns are
detected and the one holding the ranking is shown and can be changed, because
that is the one column that decides whether the board is yours. Six matching
tiers handle the ways two sources write the same player. Anything left over is
listed with the closest players on the board beside it: map it once, and the
mapping is kept and applied to every list you load afterwards. Your file itself
is kept too, so a correction takes effect immediately without re-uploading.

**A tunable room.** A slider per position from &minus;5 to +5, a reach dial, a
roster need dial, and seven presets. Every setting moves players by a number of
picks, and the panel says how many.

**A grade at the end.** Starting points and picks gained against ADP, side by
side, for every team in the room.

**Keepers.** Shown only for a league that actually keeps players, read from the
league's own Sleeper settings. Import the ones declared so far in a click, or
enter them by hand. Both halves apply: the player comes off the board from pick
one, and the pick that paid for him fills itself when it arrives. A league with
no kicker slot drafts no kickers.

Every keeper sits on the board in its own pick from the moment the draft opens,
and on its team's roster from pick one. Both halves matter to the room, not
just to the display: a team keeping a receiver in round eight holds that
receiver in round one, and a room that does not know it drafts the position
again and again until its own keeper finally lands. He counts against that
team's remaining picks too, so sixteen rounds with one keeper is fifteen picks
to make.

Sleeper publishes **who** is kept and **by whom**, and does not publish what a
keeper costs. The round is taken from where that player went in last season's
draft, which is what most leagues charge, and is marked as the guess it is. A
player picked up on waivers was never drafted here, so he gets no suggestion at
all rather than a wrong one, and the import says so.

**Follow a real draft.** In assistant mode the app polls your Sleeper draft
every few seconds and rebuilds the board from the real picks alone. Nothing is
invented; a commissioner undo is picked up because the board is rebuilt, not
appended to. Say which manager you are once and your slot follows automatically
when Sleeper draws the order. A real pick of a player this board does not rank
still owns its slot, so the board never drifts out of line with the room.

**An anonymity toggle.** One button in the masthead replaces league names,
league IDs, team names and every manager's Sleeper name on screen, for
screenshots and streams. It is a display filter: nothing stored changes, and it turns off
again with nothing lost.

---

## Where the numbers come from

| | Source | What it gives | Key |
|---|---|---|---|
| ADP, primary | [Sleeper](https://sleeper.com) | About 530 ranked players, per scoring format | none |
| ADP, fallback and cross check | [Fantasy Football Calculator](https://fantasyfootballcalculator.com) | About 230 players, per league size, **with a standard deviation on every pick** | none |
| Projected points | Rotowire, through Sleeper | Season points in standard, half PPR and PPR | none |

Sleeper leads because it ranks roughly twice as many players, so a twenty round
draft still has a real board in the last rounds instead of a tail of unranked
names. Fantasy Football Calculator fills the gaps and supplies two things
Sleeper does not publish at all: a separate ADP for each league size, and the
standard deviation of every pick measured across thousands of real drafts. That
deviation is what sets how far the room reaches. You can switch the order, or
average the two, in the settings.

**ADP borrows across formats.** The columns are not equally populated: half PPR
carries 529 Sleeper ranks and standard carries 310. A player with a half PPR ADP
and no standard one is not a player who does not exist in standard leagues, so
the number is borrowed and the borrowing is recorded. Without this every board
but half PPR was missing a third of the players, and real, rostered names came
back to the user as names that matched nothing. Every board now holds about 600.

If a league is still deep enough to outrun the board, the settings screen says
so before you start.

The two boards join on normalised name plus position, with team defences joined
on the team abbreviation because the two sources name them differently
("Seattle Defense" against "Seattle Seahawks"). The match rate is reported on
every response. It currently runs at 99.6 per cent.

Fantasy Football Calculator asks only for attribution, which the app carries in
the masthead and the settings footer.

---

## How a computer team picks

Every available player gets a score in units of draft picks. The lowest score
wins the pick.

```
score = biased ADP + a random draw - the roster need bonus + a late position penalty
```

**Position weight, &minus;5 to +5.** The dial moves a player by a share of their
ADP plus a small flat shift:

```
effective ADP = adp * (1 - 0.40 * tilt) - 2.5 * tilt      tilt = level / 5
```

The share is what keeps the dial honest at both ends of the board. At +5 the
back at pick 60 goes near pick 33 and the back at pick 10 goes near pick 3. A
flat shift in picks would be violent at the top and invisible at the bottom.

Measured over a full 12 by 15 draft, with everything else held still:

| RB dial | RB12 goes at pick | RB24 goes at pick |
|---|---|---|
| &minus;5 | 27 | 71 |
| 0 | 23 | 55 |
| +5 | 16 | 37 |

**Reach, 0 to 10.** A normal draw scaled by the player's own measured ADP
spread. At 3 the room reaches exactly as far as the market does, because 3 is
one times the measured spread. At 0 the board goes in exact order. Above 3 a
floor opens so that the top of the board shuffles too, since the market is so
certain about the first few picks that a purely proportional draw would leave
round one untouched at any setting. Two bounds keep the top setting playable: a
ceiling on the draw, and a hard limit on how far ahead of ADP anyone will reach.

**Roster need, 0 to 10.** A bonus for filling a starting slot that is still
open, growing as a team runs out of picks. A team whose remaining picks exactly
equal its open starting slots stops taking depth entirely. Kickers and defences
carry a penalty until the last two rounds. At 0 the room drafts pure board and
finishes with holes, which is a useful thing to watch and a terrible way to
draft.

Nobody ever holds two kickers or two defences. That is a hard cap, not a lean,
because no dial setting should be able to produce it.

Every draft runs off a seed, so the same settings replay the same draft. Change
one dial, run it again, and the difference comes from the dial.

---

## Reading a ranking file

**Which column holds the ranking is the whole ball game.** A real export reads:

```
Player, Position, Team, ETR Rank, ADP, Ranking Diff, ETR Pos Rank,
ADP Pos Rank, Pos Rank Diff, id
```

Six of those ten columns contain the word "rank" and exactly one of them is the
ranking. Looking for a column named `rank` finds none of them and falls through
to `ADP`, which sorts your board into market order and still calls it yours.
Nothing about the result looks wrong, which is what makes it the worst kind of
bug.

So headers are scored rather than matched. An exact name scores full weight, a
name that merely contains the word scores four fifths, and a header carrying
`diff`, `pos rank`, `tier` or `bye` is disqualified from being the rank at all.
`ETR Rank` wins; `ADP` is the last resort it was always meant to be.

The chosen column is then shown on screen with every other header beside it, so
when the scoring is wrong for some file I have not seen, you point at the right
column and the board re-sorts.

---

## Matching a name to a player

A ranking file and an ADP feed rarely spell a player the same way. Six tiers run
in order, and every match records the tier that found it, so anything short of
an exact hit can be reviewed:

| Tier | What it takes | Example |
|---|---|---|
| override | you said so | anything, once you map it |
| exact | name and position, or a defence's team | Pat Freiermuth |
| name | the name alone is unique on the board | a file with no position column |
| team | surname, position and team, one player left | Cameron Ward &rarr; Cam Ward |
| nickname | surname and position, one player left, first names share an opening | Kenneth Gainwell &rarr; Kenny Gainwell |
| loose | no position column and the name is unique | a bare list of names |

Team defences never match on the name, so they never try: "WAS DST",
"Washington D/ST", "Washington Commanders" and "Seattle Defense" all resolve to
a team abbreviation and join on that.

The nickname tier only fires when the surname and the position already agree and
exactly one player is left, so it decides between one player and none, never
between two players.

Anything that clears none of the six is listed for you with its closest matches,
ranked by edit distance on the surname, so a typo like "Jonathin Tayler" is
offered Jonathan Taylor rather than nothing. Choose the player, or choose to
leave the name out for good. Either way the decision is saved in your browser
and applied to every list you load afterwards. A name is never guessed at: a
silent miss drops a player off your board and you never learn which one.

---

## The survival bar

Beside every player is a bar and a percentage: the chance that player is still
there when your next turn comes around.

It reads the pick a player goes at as normal around their ADP, with the spread
Fantasy Football Calculator measured across real drafts, and it conditions on
the player being available right now. That conditioning matters. Without it
anyone falling past their ADP reads as zero per cent, which is the opposite of
the truth.

It does not model this draft's own history. A run on running backs pulls the
real numbers down and the bar will not see it.

---

## Layout

```
draft-room/
├── server/                  the data service. Express, no build step.
│   └── src/
│       ├── index.js         health, board, rankings, sleeper league
│       ├── board.js         joins the two sources into one board
│       ├── names.js         when two records name the same player
│       ├── rankings.js      reads a ranking file from anywhere
│       ├── sleeperLeague.js turns a real league into draft settings
│       ├── sleeperDraft.js  a real draft: seats, keepers, order, live picks
│       ├── cache.js         six hour disk cache, serves stale on failure
│       └── sources/         ffc.js, sleeper.js
└── client/                  React and TypeScript, built with Vite
    └── src/
        ├── config.ts        your leagues and your name, read from the env
        ├── storage.ts       what the browser keeps between visits
        ├── anon.ts          the anonymity filter, for screenshots
        ├── engine/          the draft itself. No React, no DOM.
        │   ├── cpu.ts       how a computer team picks
        │   ├── draft.ts     the state machine
        │   ├── order.ts     snake, linear, third round reversal
        │   ├── roster.ts    slots, flex, caps, best lineup
        │   ├── survival.ts  the odds a player lasts
        │   ├── grade.ts     the two numbers at the end
        │   └── selftest.ts  the checks, run against live data
        └── components/      setup, draft, board, pool, roster, results
```

The draft runs in the browser. A pick has to land the instant you click it, and
nothing about a draft needs a server round trip. The server exists to reach two
feeds a browser cannot call directly, to cache them, and to join them in one
place so the client never has to guess whether two records name the same player.

---

## Commands

| | |
|---|---|
| `npm run install:all` | install both halves |
| `npm run dev` | both halves, with reload |
| `npm run dev:server` | the data service alone, on 5178 |
| `npm run dev:client` | the interface alone, on 5177 |
| `npm start` | the data service, without reload |
| `npm run build` | a production bundle in `client/dist`. Not needed to run it |
| `npm run typecheck` | TypeScript, app and tests |
| `npm run engine:test` | run the draft engine against a live board |

---

## Settings

The app needs no configuration to run. Two optional settings save you typing
your own league in every time:

```
cp client/.env.example client/.env.local
```

| Variable | What it does |
|---|---|
| `VITE_SEED_LEAGUES` | Sleeper leagues the app starts out knowing about, as JSON: `[{"id":"...","name":"..."}]` |
| `VITE_DEFAULT_MANAGER` | Your Sleeper display name, so a league you load knows which seat is yours |
| `VITE_API_TARGET` | Where `npm run dev` sends `/api`. Defaults to `http://localhost:5178` |

Without them the app starts with no leagues and you paste a league ID into the
settings screen, which is the path everybody else takes and so the one that
stays tested.

**A league ID identifies real people.** It is enough to look the league up and
read every manager in it. That is why these two settings live in a git-ignored
file rather than in the source, and why the app has an anonymity toggle at all.
Note that `npm run build` reads `.env.local` too, so a bundle you build holds
whatever you put there. Nothing here needs a build to run.

The data service reads three of its own, and needs none of them:

| Variable | What it does |
|---|---|
| `PORT` | The port the data service binds. Default 5178 |
| `HOST` | The address it binds. Default `127.0.0.1`, the loopback only |
| `DRAFT_YEAR` | Draft a different season. Defaults to the current year |

The default `HOST` means the service answers your own machine and nothing else,
which is what you want for a local run. Set it to `0.0.0.0` only when something
off this machine has to reach it, such as a container.

---

## The checks

`npm run engine:test` needs the data service running. It plays whole drafts and
asserts the things a mock draft has to get right: the snake order is a snake,
every team fields a lineup, nobody holds two kickers, a league with no kicker
slot drafts none at all, the position dials move the board in the direction the
label promises, the same seed replays the same draft, and your own rankings
change the room only when you ask them to.

It also runs against the live feeds: every scoring format returns a full board,
a ranking column beats an ADP column, the awkward names match, a typo is
offered the player it meant, and a saved mapping carries to the next file.

Three blocks need a real Sleeper league to read: importing several leagues,
replaying a finished draft pick by pick, and reading a keeper league that has
traded picks in it. Name your own leagues to run them:

```
cp client/fixtures.example.json client/fixtures.local.json
```

Without that file those three blocks report themselves skipped and every other
check still runs.
