# Changelog

What changed, and why. Dates are the day the change landed on `main`.

This project follows [semantic versioning](https://semver.org): the middle
number moves when something is added, the last one when something is only
fixed.

---

## 1.1.0 — 2026-09-01

### Added

**Notes on a player, shown under him in the pool.** Everything else on that row
is measured — ADP, projected points, the odds he lasts. A note is the one thing
you wrote, so it reads in your own words next to the numbers everybody else
has. Long notes clamp to a line and open on a tap; short ones just sit there.

A note reaches the board two ways and both are optional:

- A `Notes`, `Note` or `Comment` column in the ranking file you already upload.
  Costs nothing if the export you use happens to carry one.
- A notes file of your own, under **Your notes** on the settings screen. This
  one wins, because a ranking export is replaced every time its publisher
  updates and should not quietly undo something you wrote.

A notes file is a ranking file with the ranking left out, so it runs through the
same six matching tiers as your rankings and honours the name mappings you have
already saved. `POST /api/notes` refuses a file with no notes column rather than
succeeding silently and showing you nothing.

### Fixed

**A note keeps its commas.** Prose has commas, so an unquoted note splits into
several cells and the row ends up wider than its header. When the notes column
is last, the note is now cut from the raw line instead of rejoined from the
split pieces — the splitter trims every field, so rejoining returned
`him,because` for a note that said `him, because`.

**The Node version the README asks for is the one the build needs.** It said
"Node 20 or newer", which wrongly admits Node 21 and Node 22 before 22.12.
Vite's range is `^20.19.0 || >=22.12.0` and it has a hole in the middle, so the
README now says so.

### Note if you deploy this

Serve `client/dist` so that a request for a hashed asset which no longer exists
returns **404**, not `index.html`. A single-page fallback that catches
`/assets/*` hands back HTML under a `.js` URL, and if you also cache those
immutably a browser holding a stale page breaks until a hard refresh. Route
everything else to `index.html` as normal.

---

## 1.0.0 — 2026-08-31

First public release. A fantasy football draft tool with two modes: a mock
draft against a room you can tune, and an assistant that follows your real
Sleeper draft pick by pick.

The draft runs in the browser. The data service exists to reach two free feeds
a browser cannot call directly, to cache them, and to join them in one place so
the client never has to guess whether two records name the same player. Neither
feed asks for an API key.

Notable in this first release, because they are the parts that took the longest
to get right:

- **A ranking column is scored, not matched.** A real export can carry six
  columns with "rank" in the name and only one of them is the ranking. Guessing
  wrong sorts your board into market order and still calls it yours, which is
  the worst kind of bug because nothing about the result looks broken.
- **Six matching tiers**, so "Cameron Ward" reaches Cam Ward and every team
  defence resolves to a team abbreviation. Anything that clears none of them is
  listed with its closest matches rather than silently dropped.
- **ADP borrows across formats.** The columns are not equally populated, and
  without borrowing every board but half PPR was missing a third of its players.
- **Keepers apply at both ends** — the player leaves the board at pick one and
  the pick that paid for him fills itself when it arrives.
- **An anonymity toggle** that masks league names, league IDs, team names and
  every manager's display name together, because masking the name while showing
  the ID masks nothing.

Your own leagues and Sleeper name are read from the environment rather than
written into the source. A league ID is enough to look a league up and read
every manager in it, so a fresh checkout starts empty and asks for one.
