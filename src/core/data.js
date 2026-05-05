/**
 * Core data access logic.
 */
import { evaluate, evaluateAsync, KNOWN_PATHS } from '../connection.js';

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

function buildGraphicsJS(collectionName, mapKey, filter) {
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var filter = '${filter}';
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            } catch(e) {}
          }
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

export async function getOhlcv({ count, summary } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: Math.round((Math.max(...highs) - Math.min(...lows)) * 100) / 100,
      change: Math.round((last.close - first.open) * 100) / 100,
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

export async function getIndicator({ entity_id }) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById('${entity_id}');
      if (!study) return { error: 'Study not found: ${entity_id}' };
      var result = { name: null, inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      try { result.inputs = study.getInputValues(); } catch(e) { result.inputs_error = e.message; }
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

// Keys we pick out of metrics.performance.all (TradingView's strategy report shape)
const PERF_ALL_KEYS = [
  'netProfit', 'netProfitPercent',
  'grossProfit', 'grossProfitPercent',
  'grossLoss', 'grossLossPercent',
  'profitFactor',
  'totalTrades', 'totalOpenTrades',
  'numberOfWiningTrades', 'numberOfLosingTrades',
  'percentProfitable',
  'avgTrade', 'avgTradePercent',
  'avgWinTrade', 'avgWinTradePercent',
  'avgLosTrade', 'avgLosTradePercent',
  'largestWinTrade', 'largestLosTrade',
  'avgBarsInTrade', 'avgBarsInWinTrade', 'avgBarsInLossTrade',
  'commissionPaid',
  'ratioAvgWinAvgLoss',
  'maxContractsHeld',
];

// Keys we pick from metrics.performance (top-level, not in .all)
const PERF_TOP_KEYS = [
  'sharpeRatio', 'sortinoRatio',
  'maxStrategyDrawDown', 'maxStrategyDrawDownPercent',
  'maxStrategyRunUp', 'maxStrategyRunUpPercent',
  'buyHoldReturn', 'buyHoldReturnPercent', 'buyHoldGainPercent',
  'avgMarginUsed', 'maxMarginUsed',
  'openPL', 'openPLPercent',
];

export async function getStrategyResults({ verbose } = {}) {
  const results = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        // Score-based strategy detection. Cannot rely on is_price_study (some strategies
        // overlay price and report is_price_study === true) and cannot rely on 'performance'
        // alone (Volume / EMA / Earnings all expose it). Trust the strong signals:
        // ordersData, _strategyOrdersPaneView, _reportData, is_strategy meta.
        var strat = null, bestScore = 0;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (!s.metaInfo) continue;
          var meta;
          try { meta = s.metaInfo(); } catch(e) { continue; }
          if (!meta) continue;
          var score = 0;
          if (meta.is_strategy === true) score += 100;
          if (s.ordersData) score += 50;
          if (s._strategyOrdersPaneView) score += 50;
          if (s._reportData) score += 30;
          if (s.tradesData) score += 20;
          if (s.equityData) score += 10;
          if (s.reportData) score += 5;
          if (score > bestScore) { bestScore = score; strat = s; }
        }
        if (!strat || bestScore < 30) return {error: 'No strategy found on chart. Add a strategy indicator first.'};

        var stratName = '';
        try { var meta = strat.metaInfo(); stratName = meta.description || meta.shortDescription || ''; } catch(e) {}

        var metrics = {};
        if (strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd === 'object') {
            if (typeof rd.value === 'function') rd = rd.value();
            if (rd) {
              var keys = Object.keys(rd);
              for (var k = 0; k < keys.length; k++) {
                var val = rd[keys[k]];
                if (val !== null && val !== undefined && typeof val !== 'function') metrics[keys[k]] = val;
              }
            }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.performance) {
          var perf = strat.performance();
          if (perf && typeof perf.value === 'function') perf = perf.value();
          if (perf && typeof perf === 'object') {
            var pkeys = Object.keys(perf);
            for (var p = 0; p < pkeys.length; p++) {
              var pval = perf[pkeys[p]];
              if (pval !== null && pval !== undefined && typeof pval !== 'function') metrics[pkeys[p]] = pval;
            }
          }
        }

        // Compute trade-derived aggregates server-side (inside TradingView runtime).
        // Trade objects from metrics.trades / strat.tradesData() have shape:
        //   { e: {entry}, x: {exit}, q: qty, tp: {v: profit$, p: profitPct}, cp:{...}, rn:{...}, dd:{...} }
        // Filled orders from ordersData() are individual fills (entry/exit), not closed trades.
        var tradeStats = null;
        try {
          var trades = null;
          // Prefer the closed-trade list (already paired entry+exit with profit)
          if (metrics && Array.isArray(metrics.trades)) trades = metrics.trades;
          if (!Array.isArray(trades) && strat.tradesData) {
            trades = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData;
            if (trades && typeof trades.value === 'function') trades = trades.value();
          }
          if (Array.isArray(trades) && trades.length > 0) {
            var n = 0, wins = 0, losses = 0, scratches = 0;
            var grossProfit = 0, grossLoss = 0;
            var equityRun = 0, peak = 0, maxDD = 0;
            var firstTime = null, lastTime = null;
            for (var t = 0; t < trades.length; t++) {
              var tr = trades[t];
              if (!tr || typeof tr !== 'object') continue;
              var pnl = null;
              if (tr.tp && typeof tr.tp === 'object' && typeof tr.tp.v === 'number') pnl = tr.tp.v;
              else if (typeof tr.profit === 'number') pnl = tr.profit;
              else if (tr.profit && typeof tr.profit.value === 'number') pnl = tr.profit.value;
              if (typeof pnl !== 'number' || isNaN(pnl)) continue;
              n++;
              if (pnl > 0) { wins++; grossProfit += pnl; }
              else if (pnl < 0) { losses++; grossLoss += pnl; }
              else scratches++;
              equityRun += pnl;
              if (equityRun > peak) peak = equityRun;
              var dd = peak - equityRun;
              if (dd > maxDD) maxDD = dd;
              var entryTm = tr.e && tr.e.tm;
              var exitTm = tr.x && tr.x.tm;
              if (typeof entryTm === 'number') {
                if (firstTime == null || entryTm < firstTime) firstTime = entryTm;
              }
              if (typeof exitTm === 'number') {
                if (lastTime == null || exitTm > lastTime) lastTime = exitTm;
              }
            }
            if (n > 0) {
              tradeStats = {
                trade_count: n,
                wins: wins,
                losses: losses,
                scratches: scratches,
                win_rate: wins / n,
                net_profit: grossProfit + grossLoss,
                gross_profit: grossProfit,
                gross_loss: grossLoss,
                profit_factor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : null,
                avg_win: wins ? grossProfit / wins : 0,
                avg_loss: losses ? grossLoss / losses : 0,
                expectancy: (grossProfit + grossLoss) / n,
                max_drawdown_running: maxDD,
                first_trade_time: firstTime,
                last_trade_time: lastTime,
                raw_trade_count: trades.length,
              };
            } else {
              tradeStats = { raw_trade_count: trades.length, note: 'Could not parse pnl from any trade.' };
            }
          }
        } catch(e) { tradeStats = { error: e.message }; }

        return {strategy_name: stratName, metrics: metrics, trade_stats: tradeStats, source: 'internal_api'};
      } catch(e) { return {error: e.message}; }
    })()
  `);

  if (results?.error) {
    return { success: false, error: results.error };
  }

  const allMetrics = results?.metrics || {};
  const tradeStats = results?.trade_stats;

  if (verbose) {
    return {
      success: true,
      strategy_name: results?.strategy_name,
      source: results?.source,
      metric_count: Object.keys(allMetrics).length,
      metrics: allMetrics,
      trade_stats: tradeStats,
    };
  }

  // TradingView nests its real metrics inside metrics.performance.{all, long, short}.
  // Pull from .all for the headline numbers, plus a few from .performance top-level.
  const perf = allMetrics.performance || {};
  const perfAll = perf.all || {};
  const summary = {};
  for (const key of PERF_ALL_KEYS) {
    if (perfAll[key] !== undefined) summary[key] = normalizeMetric(perfAll[key]);
  }
  for (const key of PERF_TOP_KEYS) {
    if (perf[key] !== undefined) summary[key] = normalizeMetric(perf[key]);
  }

  // Backfill / cross-check from the in-browser trade aggregate
  if (tradeStats && !tradeStats.error) {
    summary.expectancy = round4(tradeStats.expectancy);
    if (summary.totalTrades == null) summary.totalTrades = tradeStats.trade_count;
    if (summary.profitFactor == null && tradeStats.profit_factor != null) {
      summary.profitFactor = round4(tradeStats.profit_factor);
    }
    if (tradeStats.first_trade_time && tradeStats.last_trade_time) {
      summary.first_trade_time = tradeStats.first_trade_time;
      summary.last_trade_time = tradeStats.last_trade_time;
    }
  }

  // Surface what's NOT in the summary so the user knows verbose has more
  const omitted = {
    perf_all_keys: Math.max(Object.keys(perfAll).length - PERF_ALL_KEYS.filter(k => perfAll[k] !== undefined).length, 0),
    trades: Array.isArray(allMetrics.trades) ? allMetrics.trades.length : 0,
    filled_orders: Array.isArray(allMetrics.filledOrders) ? allMetrics.filledOrders.length : 0,
    has_long_partition: !!perf.long,
    has_short_partition: !!perf.short,
  };

  return {
    success: true,
    strategy_name: results?.strategy_name,
    source: results?.source,
    summary,
    omitted_in_verbose: omitted,
    hint: 'Pass verbose: true for full reportData (includes individual trades + filled orders + long/short partitions — large).',
  };
}

function normalizeMetric(v) {
  if (v == null) return v;
  if (typeof v === 'number') return round4(v);
  if (typeof v === 'object') {
    // TradingView often returns {value, all, long, short} or {p, pAll}
    if (typeof v.value === 'number') return round4(v.value);
    if (typeof v.all === 'number') return round4(v.all);
    if (typeof v.pAll === 'number') return round4(v.pAll);
    return v;
  }
  return v;
}

function round4(n) {
  if (typeof n !== 'number' || !isFinite(n)) return n;
  return Math.round(n * 10000) / 10000;
}

export async function getTrades({ max_trades } = {}) {
  const limit = Math.min(max_trades || 20, MAX_TRADES);
  const trades = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.ordersData || s.reportData)) { strat = s; break; }
        }
        if (!strat) return {trades: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var orders = null;
        if (strat.ordersData) { orders = typeof strat.ordersData === 'function' ? strat.ordersData() : strat.ordersData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        if (!orders || !Array.isArray(orders)) {
          if (strat._orders) orders = strat._orders;
          else if (strat.tradesData) { orders = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        }
        if (!orders || !Array.isArray(orders)) return {trades: [], source: 'internal_api', error: 'ordersData() returned non-array.'};
        var result = [];
        for (var t = 0; t < Math.min(orders.length, ${limit}); t++) {
          var o = orders[t];
          if (typeof o === 'object' && o !== null) {
            var trade = {};
            var okeys = Object.keys(o);
            for (var k = 0; k < okeys.length; k++) { var v = o[okeys[k]]; if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') trade[okeys[k]] = v; }
            result.push(trade);
          }
        }
        return {trades: result, source: 'internal_api'};
      } catch(e) { return {trades: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, trade_count: trades?.trades?.length || 0, source: trades?.source, trades: trades?.trades || [], error: trades?.error };
}

export async function getEquity({ points, verbose } = {}) {
  const targetPoints = Math.max(2, Math.min(points || 50, 500));

  const result = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        // Same score-based detector as getStrategyResults
        var strat = null, bestScore = 0;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (!s.metaInfo) continue;
          var meta;
          try { meta = s.metaInfo(); } catch(e) { continue; }
          if (!meta) continue;
          var score = 0;
          if (meta.is_strategy === true) score += 100;
          if (s.ordersData) score += 50;
          if (s._strategyOrdersPaneView) score += 50;
          if (s._reportData) score += 30;
          if (s.tradesData) score += 20;
          if (s.equityData) score += 10;
          if (s.reportData) score += 5;
          if (score > bestScore) { bestScore = score; strat = s; }
        }
        if (!strat || bestScore < 30) return {error: 'No strategy found on chart. Add a strategy indicator first.'};

        // Build per-trade equity points from cumulative profit
        var trades = null;
        if (strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd.value === 'function') rd = rd.value();
          if (rd && Array.isArray(rd.trades)) trades = rd.trades;
        }
        if (!Array.isArray(trades) && strat.tradesData) {
          trades = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData;
          if (trades && typeof trades.value === 'function') trades = trades.value();
        }

        var pts = [];
        if (Array.isArray(trades) && trades.length > 0) {
          var equity = 0;
          for (var t = 0; t < trades.length; t++) {
            var tr = trades[t];
            if (!tr || typeof tr !== 'object') continue;
            var pnl = null;
            if (tr.tp && typeof tr.tp === 'object' && typeof tr.tp.v === 'number') pnl = tr.tp.v;
            else if (typeof tr.profit === 'number') pnl = tr.profit;
            if (typeof pnl !== 'number' || isNaN(pnl)) continue;
            equity += pnl;
            var time = (tr.x && tr.x.tm) || (tr.e && tr.e.tm) || null;
            var dd = (tr.dd && typeof tr.dd === 'object' && typeof tr.dd.v === 'number') ? tr.dd.v : null;
            pts.push({ time: time, equity: equity, dd: dd });
          }
          return { points: pts, source_path: 'computed_from_trades', source: 'internal_api' };
        }

        // Fallback: native strat.equityData (rare on user strategies)
        if (strat.equityData) {
          var eq = typeof strat.equityData === 'function' ? strat.equityData() : strat.equityData;
          if (eq && typeof eq.value === 'function') eq = eq.value();
          if (Array.isArray(eq)) {
            return { points: eq, source_path: 'native_equityData', source: 'internal_api' };
          }
        }

        return { points: [], source: 'internal_api', note: 'No trades or equityData found.' };
      } catch(e) { return { error: e.message }; }
    })()
  `);

  if (result?.error) return { success: false, error: result.error };

  const all = result?.points || [];
  if (all.length === 0) {
    return { success: true, point_count: 0, points: [], note: result?.note || 'No equity data.' };
  }

  if (verbose) {
    return {
      success: true,
      point_count: all.length,
      source: result.source,
      source_path: result.source_path,
      points: all,
    };
  }

  // Locate peak, trough, max drawdown
  let peakEq = -Infinity, peakIdx = 0;
  let troughEq = Infinity, troughIdx = 0;
  let maxDD = 0, maxDDIdx = 0;
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (typeof p.equity === 'number' && p.equity > peakEq) { peakEq = p.equity; peakIdx = i; }
    if (typeof p.equity === 'number' && p.equity < troughEq) { troughEq = p.equity; troughIdx = i; }
    if (typeof p.dd === 'number' && p.dd > maxDD) { maxDD = p.dd; maxDDIdx = i; }
  }

  // Uniform downsample to ~targetPoints buckets, always including first/last
  const step = Math.max(1, Math.floor(all.length / targetPoints));
  const sampled = [];
  for (let i = 0; i < all.length; i += step) {
    const p = all[i];
    sampled.push({
      i,
      time: p.time,
      equity: typeof p.equity === 'number' ? round4(p.equity) : p.equity,
      dd: typeof p.dd === 'number' ? round4(p.dd) : p.dd,
    });
  }
  const lastSampled = sampled[sampled.length - 1];
  const last = all[all.length - 1];
  if (!lastSampled || lastSampled.i !== all.length - 1) {
    sampled.push({
      i: all.length - 1,
      time: last.time,
      equity: typeof last.equity === 'number' ? round4(last.equity) : last.equity,
      dd: typeof last.dd === 'number' ? round4(last.dd) : last.dd,
    });
  }

  return {
    success: true,
    point_count: all.length,
    sample_count: sampled.length,
    source: result.source,
    source_path: result.source_path,
    final_equity: typeof last.equity === 'number' ? round4(last.equity) : last.equity,
    peak: { trade_index: peakIdx, time: all[peakIdx].time, equity: round4(peakEq) },
    trough: { trade_index: troughIdx, time: all[troughIdx].time, equity: round4(troughEq) },
    max_drawdown: { trade_index: maxDDIdx, time: all[maxDDIdx].time, dd: round4(maxDD) },
    points: sampled,
    hint: 'Pass verbose: true for one point per trade (no downsampling).',
  };
}

export async function getQuote({ symbol } = {}) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var sym = '${symbol || ''}';
      if (!sym) { try { sym = api.symbol(); } catch(e) {} }
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        var bidEl = document.querySelector('[class*="bid"] [class*="price"], [class*="dom-"] [class*="bid"]');
        var askEl = document.querySelector('[class*="ask"] [class*="price"], [class*="dom-"] [class*="ask"]');
        if (bidEl) quote.bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
        if (askEl) quote.ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (!data.last && !data.close)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  return { success: true, ...data };
}

export async function getDepth() {
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else if (i < rows.length / 2) asks.push({ price, size });
        else bids.push({ price, size });
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (item._value && item._value !== '∅' && item._title) values[item._title] = item._value;
                }
              }
            }
          } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ name: name, values: values });
        } catch(e) {}
      }
      return results;
    })()
  `);
  return { success: true, study_count: data?.length || 0, studies: data || [] };
}

export async function getPineLines({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglines', 'lines', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    for (const item of s.items) {
      const v = item.raw;
      const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
      const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
      if (verbose) allLines.push({ id: item.id, y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci });
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (verbose) result.all_lines = allLines;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineLabels({ study_filter, max_labels, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglabels', 'labels', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const limit = max_labels || 50;
  const studies = raw.map(s => {
    let labels = s.items.map(item => {
      const v = item.raw;
      const text = v.t || '';
      const price = v.y != null ? Math.round(v.y * 100) / 100 : null;
      if (verbose) return { id: item.id, text, price, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price };
    }).filter(l => l.text || l.price != null);
    if (labels.length > limit) labels = labels.slice(-limit);
    return { name: s.name, total_labels: s.count, showing: labels.length, labels };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineTables({ study_filter } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgtablecells', 'tableCells', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineBoxes({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
      const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}
