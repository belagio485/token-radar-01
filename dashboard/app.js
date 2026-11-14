// Token Radar dashboard: renders the board written by main.ts, with sorting,
// filtering, search, and a detail view per protocol. Runs with no network:
// all data arrives in window.RADAR_DATA from the data file beside the page.
(function () {
  "use strict";

  var DATA = typeof window.RADAR_DATA !== "undefined" ? window.RADAR_DATA : null;
  var viewEl = document.getElementById("view");
  var statsEl = document.getElementById("stats");
  var controlsEl = document.getElementById("controls");
  var calibrationEl = document.getElementById("calibration");
  var asofBadge = document.getElementById("asof-badge");

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(v) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v);
  }

  function fmtMoneyFull(v) {
    return "$" + Math.round(v).toLocaleString("en-US");
  }

  function fmtPct(c) {
    if (c === null || c === undefined || !isFinite(c)) return "—";
    var sign = c > 0 ? "+" : "";
    return sign + c.toFixed(1) + "%";
  }

  function pctClass(c) {
    if (c === null || c === undefined || !isFinite(c) || c === 0) return "flat";
    return c > 0 ? "up" : "down";
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return "—";
    if (days <= 0) return "new";
    if (days < 31) return days + "d";
    if (days < 365) return Math.round(days / 30.4) + "mo";
    return (days / 365).toFixed(1) + "y";
  }

  function fmtFactor(f) {
    return "×" + f.toFixed(2);
  }

  function chainLabel(chains) {
    if (!chains || chains.length === 0) return "—";
    if (chains.length <= 2) return chains.join(", ");
    return chains.slice(0, 2).join(", ") + " +" + (chains.length - 2);
  }

  var state = {
    q: "",
    category: "all",
    chain: "all",
    watchlist: false,
    early: false,
    sortKey: "implied_value_usd",
    sortDir: -1,
    detailSlug: null,
  };

  function parseHash() {
    var h = window.location.hash || "";
    var detail = /^#detail=(.+)$/.exec(h);
    if (detail) {
      state.detailSlug = decodeURIComponent(detail[1]);
      return;
    }
    state.detailSlug = null;
    var preset = /^#preset=(early|watchlist)$/.exec(h);
    if (preset) {
      state.early = preset[1] === "early";
      state.watchlist = preset[1] === "watchlist";
      syncControls();
    }
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlist && !r.on_watchlist) return false;
      if (state.early && !r.is_early) return false;
      if (state.category !== "all" && (r.category || "Uncategorized") !== state.category) return false;
      if (state.chain !== "all" && r.chains.indexOf(state.chain) === -1) return false;
      if (q) {
        var hay = (r.name + " " + r.slug + " " + (r.category || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    rows.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") {
        var c = av.toLowerCase() < bv.toLowerCase() ? -1 : av.toLowerCase() > bv.toLowerCase() ? 1 : 0;
        return c * dir || a.rank - b.rank;
      }
      if (av !== bv) return (av - bv) * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderStats() {
    var watch = DATA.rows.filter(function (r) { return r.on_watchlist; }).length;
    var early = DATA.rows.filter(function (r) { return r.is_early; }).length;
    statsEl.innerHTML =
      '<div class="stat"><p class="label">Protocols on the board</p><p class="value">' + DATA.rows.length + '</p><p class="note">of ' + DATA.total_protocols + ' in the snapshot</p></div>' +
      '<div class="stat"><p class="label">Watchlist covered</p><p class="value">' + watch + " / " + DATA.watchlist_count + '</p><p class="note">every watchlist protocol is ranked</p></div>' +
      '<div class="stat"><p class="label">Early finds</p><p class="value">' + early + '</p><p class="note">listed within a year and growing</p></div>' +
      '<div class="stat"><p class="label">Total implied value</p><p class="value">' + fmtMoney(DATA.total_implied_value_usd) + '</p><p class="note">sum of the board\u2019s implied values</p></div>';
  }

  function renderCalibration() {
    var cats = Object.keys(DATA.category_multiples || {}).sort();
    var rows = cats.map(function (c) {
      return "<tr><td>" + esc(c) + "</td><td class=\"num\">×" + DATA.category_multiples[c].toFixed(2) + "</td></tr>";
    }).join("");
    var refs = (DATA.traded_reference || []).map(function (t) {
      return "<tr><td>" + esc(t.name) + "</td><td>" + esc(t.category || "—") + "</td><td class=\"num\">" + fmtMoney(t.tvl_usd) + "</td><td class=\"num\">" + fmtMoney(t.mcap_usd) + "</td><td class=\"num\">×" + t.ratio.toFixed(2) + "</td></tr>";
    }).join("");
    calibrationEl.innerHTML =
      '<div class="calibration"><h3>Category multiples in this snapshot (median traded market-cap / TVL)</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Multiple</th></tr></thead><tbody>' + rows +
      '<tr><td>Global fallback</td><td class="num">×' + DATA.global_multiple.toFixed(2) + "</td></tr></tbody></table></div>" +
      "<h3>Largest traded-token comparables (calibration only — never on the board)</h3>" +
      '<div class="table-wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Ratio</th></tr></thead><tbody>' + refs + "</tbody></table></div></div>";
  }

  function renderControls() {
    var categories = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || "Uncategorized";
      if (categories.indexOf(c) === -1) categories.push(c);
      r.chains.forEach(function (ch) {
        if (chains.indexOf(ch) === -1) chains.push(ch);
      });
    });
    categories.sort();
    chains.sort();
    var catOpts = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? " selected" : "") + ">" + esc(c) + "</option>";
    }).join("");
    var chainOpts = '<option value="all">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? " selected" : "") + ">" + esc(c) + "</option>";
    }).join("");
    controlsEl.innerHTML =
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Name, slug, or category…" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat">' + catOpts + "</select></div>" +
      '<div class="field"><label for="chain">Chain</label><select id="chain">' + chainOpts + "</select></div>" +
      '<label class="check"><input type="checkbox" id="wonly"' + (state.watchlist ? " checked" : "") + "> Watchlist only</label>" +
      '<label class="check"><input type="checkbox" id="eonly"' + (state.early ? " checked" : "") + "> Early finds only</label>" +
      '<span class="result-count" id="count"></span>';
    document.getElementById("q").addEventListener("input", function (e) {
      state.q = e.target.value;
      renderView();
    });
    document.getElementById("cat").addEventListener("change", function (e) {
      state.category = e.target.value;
      renderView();
    });
    document.getElementById("chain").addEventListener("change", function (e) {
      state.chain = e.target.value;
      renderView();
    });
    document.getElementById("wonly").addEventListener("change", function (e) {
      state.watchlist = e.target.checked;
      renderView();
    });
    document.getElementById("eonly").addEventListener("change", function (e) {
      state.early = e.target.checked;
      renderView();
    });
  }

  function syncControls() {
    var w = document.getElementById("wonly");
    var e = document.getElementById("eonly");
    if (w) w.checked = state.watchlist;
    if (e) e.checked = state.early;
  }

  var COLUMNS = [
    { key: "rank", label: "Rank", num: true },
    { key: "name", label: "Protocol", num: false },
    { key: "category", label: "Category", num: false },
    { key: null, label: "Chains", num: false },
    { key: "tvl_usd", label: "TVL", num: true },
    { key: "change_7d", label: "7d", num: true },
    { key: "days_listed", label: "Age", num: true },
    { key: "implied_value_usd", label: "Implied value", num: true },
  ];

  function renderBoard() {
    var rows = filteredRows();
    var countEl = document.getElementById("count");
    if (countEl) countEl.textContent = "Showing " + rows.length + " of " + DATA.rows.length + " protocols";
    if (rows.length === 0) {
      viewEl.innerHTML = '<div class="table-wrap"><p class="empty">No protocols match these filters. Clear the search or widen the filters.</p></div>';
      return;
    }
    var head = COLUMNS.map(function (c) {
      if (!c.key) return '<th class="' + (c.num ? "num" : "") + '">' + c.label + "</th>";
      var arrow = state.sortKey === c.key ? (state.sortDir === -1 ? " ▼" : " ▲") : "";
      return '<th class="sortable ' + (c.num ? "num" : "") + '" data-sort="' + c.key + '">' + c.label + arrow + "</th>";
    }).join("");
    var body = rows.map(function (r) {
      var pills = "";
      if (r.on_watchlist) pills += '<span class="pill pill-watch">WATCHLIST</span>';
      if (r.is_early) pills += '<span class="pill pill-early">EARLY</span>';
      return '<tr class="row" data-slug="' + esc(r.slug) + '">' +
        '<td class="rank num">' + r.rank + "</td>" +
        '<td><span class="proto-name">' + esc(r.name) + "</span>" + pills + '<br><span class="proto-slug">' + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc(chainLabel(r.chains)) + "</td>" +
        '<td class="num">' + fmtMoney(r.tvl_usd) + "</td>" +
        '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + "</td>" +
        '<td class="num">' + fmtAge(r.days_listed) + "</td>" +
        '<td class="num value">' + fmtMoney(r.implied_value_usd) + "</td></tr>";
    }).join("");
    viewEl.innerHTML = '<div class="table-wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
    viewEl.querySelectorAll("th.sortable").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.sortKey === key) {
          state.sortDir = -state.sortDir;
        } else {
          state.sortKey = key;
          state.sortDir = key === "name" ? 1 : -1;
        }
        renderView();
      });
    });
    viewEl.querySelectorAll("tr.row").forEach(function (tr) {
      tr.addEventListener("click", function () {
        window.location.hash = "#detail=" + encodeURIComponent(tr.getAttribute("data-slug"));
      });
    });
  }

  function renderDetail() {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === state.detailSlug) { row = DATA.rows[i]; break; }
    }
    if (!row) {
      viewEl.innerHTML = '<div class="detail"><button class="back" type="button">← Back to the board</button><p class="empty">No protocol on the board matches that link.</p></div>';
      bindBack();
      return;
    }
    var pills = "";
    if (row.on_watchlist) pills += '<span class="pill pill-watch">WATCHLIST</span>';
    if (row.is_early) pills += '<span class="pill pill-early">EARLY FIND</span>';
    var steps = row.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    viewEl.innerHTML =
      '<div class="detail"><button class="back" type="button">← Back to the board</button>' +
      "<h2>" + esc(row.name) + pills + "</h2>" +
      '<p class="sub">Rank #' + row.rank + " of " + DATA.rows.length + " · " + esc(row.slug) + " · " + esc(row.category || "Uncategorized") + " · " + esc(chainLabel(row.chains)) + "</p>" +
      '<div class="fact-grid">' +
      '<div class="fact"><p class="label">TVL</p><p class="value">' + fmtMoneyFull(row.tvl_usd) + "</p></div>" +
      '<div class="fact"><p class="label">7-day change</p><p class="value ' + pctClass(row.change_7d) + '">' + fmtPct(row.change_7d) + "</p></div>" +
      '<div class="fact"><p class="label">Tracked for</p><p class="value">' + fmtAge(row.days_listed) + "</p></div>" +
      '<div class="fact"><p class="label">Token recorded</p><p class="value">None</p></div></div>' +
      '<div class="breakdown"><h3>How the implied value is built</h3><div class="breakdown-grid">' +
      '<div class="factor"><p class="f-label">TVL</p><p class="f-value">' + fmtMoney(row.tvl_usd) + '</p><p class="f-note">from the snapshot</p></div>' +
      '<div class="factor"><p class="f-label">Category multiple</p><p class="f-value">' + fmtFactor(row.multiple) + '</p><p class="f-note">median traded ' + esc(row.category || "protocol") + " ratio</p></div>" +
      '<div class="factor"><p class="f-label">Growth factor</p><p class="f-value">' + fmtFactor(row.growth_factor) + '</p><p class="f-note">7d change ' + fmtPct(row.change_7d) + "</p></div>" +
      '<div class="factor"><p class="f-label">Age factor</p><p class="f-value">' + fmtFactor(row.age_factor) + '</p><p class="f-note">' + fmtAge(row.days_listed) + " with no token</p></div>" +
      '<div class="factor"><p class="f-label">Breadth factor</p><p class="f-value">' + fmtFactor(row.breadth_factor) + "</p><p class=\"f-note\">" + row.chains.length + " chain" + (row.chains.length === 1 ? "" : "s") + "</p></div>" +
      "</div>" +
      '<p>Implied value <strong class="value">' + fmtMoneyFull(row.implied_value_usd) + "</strong> = " + fmtMoney(row.tvl_usd) + " × " + row.multiple.toFixed(2) + " × " + row.growth_factor.toFixed(2) + " × " + row.age_factor.toFixed(2) + " × " + row.breadth_factor.toFixed(2) + ". This is the radar's own claim from the snapshot's figures, not a prediction that a token launches.</p></div>" +
      '<div class="plan"><h3>Farm plan — concrete steps, costs, and time</h3><ol>' + steps + "</ol>" +
      '<p class="cost">Costs and times are planning estimates for a first position; gas moves with the chain, and no step guarantees an airdrop.</p></div></div>';
    bindBack();
  }

  function bindBack() {
    var btn = viewEl.querySelector(".back");
    if (btn) btn.addEventListener("click", function () {
      window.location.hash = "";
      state.detailSlug = null;
      renderView();
    });
  }

  function renderView() {
    if (state.detailSlug) renderDetail();
    else renderBoard();
  }

  function init() {
    if (!DATA || !Array.isArray(DATA.rows)) {
      viewEl.innerHTML = '<div class="table-wrap"><p class="empty">No board data was loaded. The dashboard expects its data file beside the page.</p></div>';
      return;
    }
    asofBadge.textContent = "Snapshot: " + DATA.as_of + " · " + DATA.total_protocols + " protocols scanned";
    renderStats();
    renderCalibration();
    renderControls();
    parseHash();
    renderView();
    window.addEventListener("hashchange", function () {
      parseHash();
      renderView();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
