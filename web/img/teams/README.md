# Team logos

Drop a logo here to replace an org's monogram mark on the site.

1. Save the file as `<slug>.<ext>` in this directory, e.g. `team-vitality.svg`.
   The slug is the team name lowercased with punctuation stripped and spaces
   turned into hyphens: "Ninjas in Pyjamas" -> `ninjas-in-pyjamas`.
   Run `node scripts/teamSlugs.mjs` to print the exact slug for every team.

2. Register it in `TEAM_LOGO` in `web/rlpt.js`:

       var TEAM_LOGO={'team-vitality':'svg','nrg':'png'};

Anything not listed there keeps its generated monogram, so partial coverage is
fine - add logos one at a time.

## Format

SVG is preferred (sharp at any size, tiny). Otherwise use a square PNG around
128x128 with a transparent background. Marks are rendered at 32x32 inside a
rounded tile and are `object-fit: contain`, so wordmarks will letterbox - a
square icon or badge version of the logo reads far better than a wide wordmark.

## Sourcing

Most of these came from Wikimedia Commons and are tagged public domain there,
because a mark made only of type and simple shapes falls below the threshold of
originality and carries no copyright. The rest are here on one of two other
bases: supplied directly by the site owner, or published by the org itself once
it has given permission. `sources.json` records which of the three applies to
every file, with the Commons page or the source and date. Keep that file in step
with this directory: it is the answer if anyone ever asks where a crest came
from.

Do not take logos from a wiki or database that hosts them under its own fair
use claim. Fair use is a defence attached to a user and a purpose, not a licence
that travels with the file, so their claim covers them and not this site.

An org whose mark is original artwork rather than plain lettering will not be on
Commons at all, and that is the correct outcome: leave it on a monogram until
either the org's own brand kit can be used or the org says yes. bsk was the
first to say yes, on 7 September 2026, and their crest came from the
organisation's own account rather than from anywhere that reposts logos.


Only add logos you have the right to use. Prefer an org's official press or
brand kit, which usually states the terms; many clear their marks for editorial
use. Team logos are trademarks: using one to identify the team it belongs to is
normal editorial practice, but do not restyle a mark, imply the org endorses
this site, or take assets from a site that is itself reposting them without
rights. If an org publishes no usable kit, leaving the monogram is a fine outcome.
