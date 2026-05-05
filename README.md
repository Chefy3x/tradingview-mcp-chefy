# tradingview-mcp-chefy

**Token-efficient TradingView MCP for traders who actually backtest.**

This is a fork built specifically for strategy testing. The existing TradingView MCPs work well for chart reading and morning workflows, but they burn tokens hard when you're iterating on Pine strategies — every backtest read dumps the full trade list, equity curve, and console output into your context. This fork rewrites those reads to aggregate **inside TradingView's runtime** before the data crosses the wire, returning summaries by default and detail on demand.

> [!WARNING]
> **Not affiliated with TradingView Inc. or Anthropic.** This tool connects to your locally running TradingView Desktop app via Chrome DevTools Protocol. Review the [Disclaimer](#disclaimer) before use.

> [!IMPORTANT]
> **Requires a valid TradingView subscription.** This tool does not bypass any TradingView paywall. It reads from and controls the TradingView Desktop app already running on your machine.

> [!NOTE]
> **All processing is local.** Nothing is sent anywhere. No TradingView data leaves your machine.

---

## Credits

This project stands on two pieces of prior work:

- **[tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp)** — the original CDP bridge and tool surface. The hard scraping work is theirs.
- **[LewisWJackson/tradingview-mcp-jackson](https://github.com/LewisWJackson/tradingview-mcp-jackson)** — fork that added the morning-brief workflow, rules config, and a v2.14+ launch fix. This fork forks his.

If those repos help you, go star them.

---

## What's Different in This Fork

| Area | Upstream behavior | This fork | Status |
|------|------------------|-----------|--------|
| `data_get_strategy_results` | Returns full strategy tester payload (~67K tokens) | In-browser aggregation: returns ~40 curated metrics + computed `expectancy` + first/last trade timestamps. `verbose: true` for the full raw payload | **shipped (v0.1)** |
| `data_get_trades` | `max_trades` cap only | Cursor-paginated. Default `limit: 20`. `all: true` for full list | planned |
| `data_get_equity` | Full curve point-by-point | Downsampled to N buckets (default 50). `verbose: true` for raw | planned |
| `pine_get_console` | All console output | New `pine_console_errors` filters server-side | planned |
| Strategy detector | Stops at first `is_price_study === false` source — latches onto Volume / EMA | Score-based: scans all sources and picks the one with strongest strategy signals (`ordersData`, `_strategyOrdersPaneView`, `_reportData`, `is_strategy` meta) | **shipped (v0.1)** |

### Measured token cost — `data_get_strategy_results`

Real numbers from a 121-week (255-trade) backtest of a Pine strategy on COMEX:GC1! 1H:

| Mode | Output size | Approx tokens |
|------|-------------|---------------|
| Default (summary) | ~1.7 KB | ~425 |
| `verbose: true` | 268,792 chars | ~67,000 |

**~99% reduction per call** in default mode. On a heavy iteration session (20+ runs), this is the difference between burning ~$20 of tokens on result reads alone vs ~$0.10.

The aggregation runs **inside TradingView's Electron runtime** — same CDP round-trip, ~150× less data crossing the wire.

---

## Status

**v0.1** — first aggregation tool (`data_get_strategy_results`) shipped, with hardened strategy detector and trade-aggregate computation in-browser. Other tools still match upstream behavior.

Roadmap:

- [x] Fork repo, set up structure
- [x] `data_get_strategy_results` summary mode + `verbose` escape hatch
- [x] Strategy detector hardening (score-based, no `is_price_study` gate)
- [x] In-browser trade-derived aggregates (win rate, PF, max DD, expectancy)
- [ ] `data_get_equity` downsampling
- [ ] `data_get_trades` cursor pagination
- [ ] `pine_console_errors` filtered tool
- [ ] Token-cost benchmark video
- [ ] PR uncontroversial fixes back to LewisWJackson upstream
- [ ] v0.2 release

---

## Quick Start

> **Same setup as upstream for now.** When the new tools land in v0.2, the install path stays identical — only the `mcpServers` config name might change.

### Prerequisites

- TradingView Desktop app (paid subscription required for real-time / strategy data)
- Node.js 18+
- Claude Code (or any MCP client)
- macOS, Windows, or Linux

### Install

```bash
git clone https://github.com/Chefy3x/tradingview-mcp-chefy.git ~/tradingview-mcp-chefy
cd ~/tradingview-mcp-chefy
npm install
```

### Launch TradingView with debug port

**Mac:**
```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows:**
```bash
scripts\launch_tv_debug.bat
```

**Linux:**
```bash
./scripts/launch_tv_debug_linux.sh
```

### Add to Claude Code

Add to `~/.claude/.mcp.json` (merge with existing servers):

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/tradingview-mcp-chefy/src/server.js"]
    }
  }
}
```

Replace `YOUR_USERNAME` with your actual username (`echo $USER` on Mac/Linux).

### Verify

Restart Claude Code and ask: *"Use tv_health_check to verify TradingView is connected."*

---

## Architecture

```
Claude Code  ←→  MCP stdio  ←→  src/server.js  ←→  CDP :9222  ←→  TradingView Desktop (Electron)
```

- **Connection:** Chrome DevTools Protocol on `localhost:9222`
- **Aggregation:** for backtest reads, the JS expression sent over CDP performs the reduction *inside TradingView's runtime* before returning. Same network hop, ~200x less data crossing the boundary.
- **No external network calls** — everything runs locally
- **Zero added dependencies** beyond what upstream uses

---

## Contributing

Two-way street with upstream:

- **Token efficiency improvements** to existing tools → I'll PR these back to LewisWJackson upstream so everyone benefits
- **New `backtest_*` family of tools** → stays in this fork (changes the mental model of how the MCP is used)

If you spot a bug in shared code paths, open an issue here and I'll route it.

---

## Disclaimer

This project is provided **for personal, educational, and research purposes only**.

This tool uses the Chrome DevTools Protocol (CDP), a standard debugging interface built into all Chromium-based applications. It does not reverse engineer any proprietary TradingView protocol, connect to TradingView's servers, or bypass any access controls. The debug port must be explicitly enabled by the user via a standard Chromium command-line flag.

By using this software you agree that:

1. You are solely responsible for ensuring your use complies with [TradingView's Terms of Use](https://www.tradingview.com/policies/) and all applicable laws.
2. This tool accesses undocumented internal TradingView APIs that may change at any time.
3. This tool must not be used to redistribute, resell, or commercially exploit TradingView's market data.
4. The authors are not responsible for any account bans, suspensions, or other consequences.

**Use at your own risk.**

## License

MIT — see [LICENSE](LICENSE). Inherited from upstream. Applies to source code only, not to TradingView's software, data, or trademarks.
