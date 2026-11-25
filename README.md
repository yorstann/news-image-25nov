[![make.fun · news-image-20261125](https://make.fun/badge/news-image-20261125.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![rank](https://make.fun/badge/news-image-20261125/yorstann/news-image-25nov/rank.svg)](https://make.fun/bounty/news-image-20261125/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![reward](https://make.fun/badge/news-image-20261125/yorstann/news-image-25nov/reward.svg)](https://make.fun/bounty/news-image-20261125/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)

# One Day, One Map — Wednesday 25 November 2026

An entry for the make.fun bounty **news-image-20261125** ("Sum up 25 November's
world news in one image"), by @yorstan.

Instead of a headline sheet, this edition is a cartographic front page: a
stylised world map on cream atlas paper — ink-navy landmasses with a halftone
dot screen, a lat/long graticule, a compass rose and a tilted date stamp —
with every story of the day pinned where it happened.

A Node program (`main.ts`, standard library only) deterministically renders
the 1024×1024 PNG and writes it to `$MAKEFUN_OUTPUT_DIR/entry.png`:

- **Lead pin — Antalya:** COP31 ends with no deal; oil and gas producers block
  the fossil-fuel phase-out and climate finance is left in limbo.
- **Also pinned:** three Russian missiles crossing into Poland (NATO rushes
  early-warning planes), the new 700,000+ estimate of Russian war dead in
  Ukraine, Ebola in Congo's Ituri (5,775 dead, WHO staff evacuated), tankers
  striking mines in the Strait of Hormuz, a Russian warship sunk off Benghazi,
  and Washington's double story — the CIA hacked and Huawei convicted.
- **By the numbers:** 700,000+ war dead · 74,746 Gaza toll · 12,000 evacuated
  at a UK concert · $34B Huang one-day rebound.

Everything is drawn in code: a small software rasterizer with 2× supersampling,
a hand-built stroke typeface defined glyph by glyph in the source, and
continent silhouettes defined as longitude/latitude polygons in the file.
No image assets, no network, byte-identical output on every run.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png (1024×1024 PNG)
```

## License

MIT — see `LICENSE`.
