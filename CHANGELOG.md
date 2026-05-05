# Changelog

All notable changes to this fork. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses date-stamped releases until v1.0.

## [Unreleased]

## [0.1.0] — 2026-05-05

First release of the fork. Focus: token-efficient strategy testing via in-browser
aggregation. Other tools still match upstream behavior.

### Added

- **`data_get_strategy_results`** — in-browser aggregation. Default mode returns a
  curated ~40-key summary (~1.7 KB / ~425 tokens) drilled from
  `metrics.performance.all` plus computed `expectancy` and first/last trade
  timestamps. `verbose: true` returns the full reportData payload (was the only
  mode upstream — ~268 KB / ~67 K tokens on a 255-trade backtest).
- **`data_get_equity`** — in-browser equity-curve construction from per-trade
  cumulative profit. Default returns ~50 downsampled points plus `final_equity`,
  `peak`, `trough`, `max_drawdown` markers (each with trade index + timestamp).
  `verbose: true` returns one point per trade. New `points` param controls
  sample density (clamped 2–500). Works even when `strat.equityData()` is not
  exposed by the strategy.
- **`pine_console_errors`** — new tool: read Pine console output filtered to
  errors and warnings only. Useful while iterating on a script when log/info
  noise is irrelevant.
- **`pine_get_console`** — gained an `errors_only` param for the same effect
  without switching tool name.
- **`NOTICE.md`** — trademark and upstream-credit notices, split out so the
  `LICENSE` file matches the canonical MIT template (GitHub now reports the
  repo license as MIT instead of "Other").

### Changed

- **Strategy detector** is now score-based across all data sources rather than
  breaking at the first `is_price_study === false` match. Scores on
  `is_strategy` meta, `ordersData`, `_strategyOrdersPaneView`, `_reportData`,
  `tradesData`, `equityData`, `reportData`. Picks the highest scorer with a
  threshold of 30 to keep Volume / EMAs / Earnings out. Fixes the case where
  the previous detector latched onto Volume on a typical chart, and the case
  where strategies that overlay price (`is_price_study === true`) were being
  skipped entirely.
- **Trade pnl parser** now reads `t.tp.v` (TradingView's actual shape:
  `{e, x, q, tp:{v,p}, cp, rn, dd}`) in addition to `profit`/`pnl`/`pl`. The
  upstream parser couldn't extract pnl from any TradingView-shaped trade.
- **`LICENSE`** — adds Chefy copyright alongside upstream tradesdontlie. Body
  is now byte-for-byte canonical MIT.
- **README** — replaces the "coming soon" table with measured before/after
  token costs from a real 121-week 255-trade backtest, and marks shipped vs.
  planned features per row.

### Credits

This project is a fork of [LewisWJackson/tradingview-mcp-jackson][lewis], which
itself is a fork of [tradesdontlie/tradingview-mcp][tdl]. The CDP probing and
known-paths discovery work is from tradesdontlie; Lewis Jackson added the
morning-brief workflow and Pine tooling. This fork adds in-browser aggregation
for backtest reads.

[lewis]: https://github.com/LewisWJackson/tradingview-mcp-jackson
[tdl]: https://github.com/tradesdontlie/tradingview-mcp
[Unreleased]: https://github.com/Chefy3x/tradingview-mcp-chefy/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Chefy3x/tradingview-mcp-chefy/releases/tag/v0.1.0
