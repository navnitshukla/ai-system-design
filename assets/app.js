(function () {
  "use strict";

  var SECTIONS = window.SECTIONS || [];
  var QUESTIONS = window.QUESTIONS || [];
  QUESTIONS.forEach(function (q, i) { q.num = i + 1; });

  var TABS = [
    { id: "answer", name: "Interview Answer" },
    { id: "hld", name: "High-Level Design" },
    { id: "lld", name: "Low-Level Design · Snowflake" },
    { id: "build", name: "Build & Video" }
  ];
  var KINDS = [
    ["user", "Actor / input"], ["proc", "Processing"], ["store", "Data / index"],
    ["model", "Model / AI function"], ["guard", "Guardrail / control"], ["decide", "Decision / cache"], ["out", "Output"]
  ];
  var STATUS = { "planned": "Build: planned", "in-progress": "Build: in progress", "done": "Build: done" };
  var CASES = window.CASE_STUDIES || [];
  function caseById(id) { return CASES.filter(function (c) { return c.id === id; })[0]; }

  var app = document.getElementById("app");
  var sidebar = document.getElementById("sidebar");
  var search = document.getElementById("search");
  var practiceToggle = document.getElementById("practiceToggle");
  var state = { filter: "all", query: "" };

  /* ---------- storage ---------- */
  function load(key, fallback) {
    try { var v = localStorage.getItem("aisd." + key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem("aisd." + key, JSON.stringify(value)); } catch (e) { /* ignore */ } }
  var done = load("done", {});

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function section(id) { return SECTIONS.filter(function (s) { return s.id === id; })[0] || { name: id }; }
  function byId(id) { return QUESTIONS.filter(function (q) { return q.id === id; })[0]; }
  function num(n) { return "Q" + (n < 10 ? "0" + n : n); }
  function status(q) { return (q.build && q.build.status) || "planned"; }

  function matches(q, text) {
    if (!text) return true;
    var hay = [q.title, q.scenario, q.tldr, q.tests, q.tradeoff, q.takeaway, (q.tags || []).join(" "), section(q.section).name]
      .concat((q.answer || []).map(function (b) { return b.h + " " + b.items.join(" "); }))
      .concat(((q.lld && q.lld.objects) || []).map(function (o) { return o.join(" "); }))
      .join(" ").toLowerCase();
    return text.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function passesFilter(q) {
    var f = state.filter;
    if (f === "all") return true;
    if (f === "Core" || f === "Advanced") return q.level === f;
    if (f === "todo") return !done[q.id];
    return q.section === f;
  }

  /* ---------- minimal syntax highlighting ---------- */
  var SQL_KW = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|AS|ON|JOIN|USING|LEFT|GROUP BY|ORDER BY|GROUP|ORDER|BY|LIMIT|QUALIFY|OVER|PARTITION|WITH|CREATE|OR REPLACE|REPLACE|IF|EXISTS|TABLE|VIEW|SCHEMA|DATABASE|STAGE|STREAM|TASK|PROCEDURE|SERVICE|CORTEX SEARCH SERVICE|DYNAMIC|HYBRID|ROLE|GRANT|TO|ALTER|SET|INSERT|INTO|VALUES|UPDATE|DELETE|MERGE|MATCHED|WHEN|THEN|ELSE|END|BEGIN|RETURN|RETURNS|LANGUAGE|EXECUTE|CALL|RESUME|CASE|DISTINCT|LATERAL|PRIMARY KEY|DEFAULT|WAREHOUSE|TARGET_LAG|ATTRIBUTES|SCHEDULE|AFTER|ADD|POLICY|ROW ACCESS|DESC|ASC|SAMPLE|ROWS|LIKE|USE)\b/g;
  var PY_KW = /\b(def|return|for|in|if|else|elif|import|from|with|as|try|except|raise|None|True|False|not|and|or|async|await|while|lambda|next)\b/g;

  function highlight(src, lang) {
    return src.split("\n").map(function (line) {
      var marker = lang === "sql" ? "--" : (lang === "python" || lang === "yaml" ? "#" : null);
      var idx = marker ? line.indexOf(marker) : -1;
      var code = idx >= 0 ? line.slice(0, idx) : line;
      var comment = idx >= 0 ? line.slice(idx) : "";
      var out = esc(code);
      if (lang === "sql") out = out.replace(SQL_KW, '<span class="hl-k">$1</span>');
      if (lang === "python") out = out.replace(PY_KW, '<span class="hl-k">$1</span>');
      if (lang === "yaml") out = out.replace(/^(\s*-?\s*)([\w.]+):/, '$1<span class="hl-k">$2</span>:');
      return out + (comment ? '<span class="hl-c">' + esc(comment) + "</span>" : "");
    }).join("\n");
  }

  /* ---------- chrome ---------- */
  function updateProgress() {
    var n = QUESTIONS.filter(function (q) { return done[q.id]; }).length;
    document.getElementById("progressPill").textContent = n + " / " + QUESTIONS.length + " studied";
  }

  // sidebar sections: collapsed by default; user choices persist; the active question's section auto-opens
  var openSections = load("openSections", {});

  function renderSidebar(activeId) {
    var active = activeId && byId(activeId);
    var allOpen = SECTIONS.every(function (s) { return openSections[s.id]; });

    var cur = current() || {};
    var html = '<div class="nav-top"><a class="nav-home' + (cur.type ? "" : " active") + '" href="#/">&#8962; Overview</a>' +
      '<button class="nav-toggle-all" data-all="' + (allOpen ? "collapse" : "expand") + '">' +
      (allOpen ? "Collapse all" : "Expand all") + "</button></div>";

    if (CASES.length) {
      html += '<div class="nav-track">End-to-end case studies</div>';
      CASES.forEach(function (cs) {
        var isActive = cur.type === "case" && cur.id === cs.id;
        html += '<a class="nav-case' + (isActive ? " active" : "") + '" href="#/case/' + cs.id + '/0">' +
          '<span class="nav-case-icon">&#9671;</span><span>' + esc(cs.title) + "</span></a>";
        if (isActive) {
          html += '<div class="nav-stages">' + cs.stages.map(function (st, n) {
            return '<a class="nav-stage' + (n === cur.stage ? " active" : "") + '" href="#/case/' + cs.id + "/" + n + '">' +
              '<span class="nav-num">' + n + "</span><span>" + esc(st.title) + "</span></a>";
          }).join("") + "</div>";
        }
      });
    }
    html += '<div class="nav-track">Question bank</div>';

    SECTIONS.forEach(function (s) {
      var qs = QUESTIONS.filter(function (q) { return q.section === s.id; });
      if (!qs.length) return;
      var d = qs.filter(function (q) { return done[q.id]; }).length;
      var open = !!openSections[s.id];
      var hasActive = active && active.section === s.id;
      html += '<div class="nav-section' + (open ? " open" : "") + (hasActive ? " has-active" : "") + '">' +
        '<button class="nav-section-title" data-section="' + s.id + '" aria-expanded="' + open + '">' +
        '<span class="chev">&#9656;</span><span class="nav-section-name">' + esc(s.name) + "</span>" +
        '<span class="nav-count' + (d === qs.length ? " complete" : "") + '">' + d + "/" + qs.length + "</span></button>" +
        '<div class="nav-items">';
      qs.forEach(function (q) {
        html += '<a class="nav-item' + (q.id === activeId ? " active" : "") + '" href="#/q/' + q.id + '">' +
          '<span class="nav-num">' + q.num + "</span><span>" + esc(q.title) + "</span>" +
          (done[q.id] ? '<span class="nav-done">&#10003;</span>' : "") + "</a>";
      });
      html += "</div></div>";
    });
    sidebar.innerHTML = html;

    sidebar.querySelectorAll(".nav-section-title").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-section");
        openSections[id] = !openSections[id];
        save("openSections", openSections);
        renderSidebar(activeId);
      });
    });
    sidebar.querySelector(".nav-toggle-all").addEventListener("click", function () {
      var expand = this.getAttribute("data-all") === "expand";
      SECTIONS.forEach(function (s) { openSections[s.id] = expand; });
      save("openSections", openSections);
      renderSidebar(activeId);
    });
  }

  /* ---------- home ---------- */
  function card(q) {
    var st = status(q);
    return '<a class="card" href="#/q/' + q.id + '">' +
      '<div class="card-top"><span>' + num(q.num) + " &middot; " + esc(section(q.section).name) + "</span>" +
      (done[q.id] ? '<span class="badge done">&#10003; studied</span>' : "") + "</div>" +
      "<h3>" + esc(q.title) + "</h3>" +
      "<p>" + esc(q.scenario || q.tldr) + "</p>" +
      '<div class="card-foot"><span class="badge level-' + q.level + '">' + q.level + "</span>" +
      (q.hld ? '<span class="badge">HLD</span>' : "") +
      (q.lld ? '<span class="badge sf">LLD &middot; Snowflake</span>' : "") +
      '<span class="badge st-' + st + '">' + STATUS[st] + "</span>" +
      (q.video && q.video.youtubeId ? '<span class="badge st-done">&#9654; video</span>' : "") +
      "</div></a>";
  }

  function caseCard(cs) {
    return '<a class="case-card" href="#/case/' + cs.id + '/0">' +
      '<div class="case-card-tag">End-to-end case study &middot; ' + cs.stages.length + " stages</div>" +
      "<h3>" + esc(cs.title) + "</h3><p>" + esc(cs.subtitle) + "</p>" +
      '<div class="case-card-stages">' + cs.stages.map(function (st, n) {
        return '<span class="mini-stage">' + n + " &middot; " + esc(st.title.split(" — ").pop()) + "</span>";
      }).join("") + "</div>" +
      '<span class="btn">Start the walkthrough &rarr;</span></a>';
  }

  function renderHome() {
    var built = QUESTIONS.filter(function (q) { return status(q) === "done"; }).length;
    var chips = [["all", "All"], ["todo", "Not studied"], ["Core", "Core"], ["Advanced", "Advanced"]]
      .concat(SECTIONS.map(function (s) { return [s.id, s.name]; }));

    var html =
      '<section class="hero"><h1>AI System Design, from interview answer to Snowflake build</h1>' +
      "<p>Two ways to learn: walk an <b>end-to-end case study</b> that grows from prototype to production, or drill " +
      "focused <b>interview questions</b> — each with a vendor-neutral high-level design and a Snowflake low-level design.</p>" +
      '<div class="stats">' +
      '<div class="stat"><b>' + CASES.length + "</b><span>case studies</span></div>" +
      '<div class="stat"><b>' + QUESTIONS.length + "</b><span>questions</span></div>" +
      '<div class="stat"><b>' + SECTIONS.length + "</b><span>topics</span></div>" +
      '<div class="stat"><b>' + built + "</b><span>builds done</span></div>" +
      "</div></section>" +

      (CASES.length && !state.query ? '<h2 class="section-h">End-to-end case studies</h2>' +
        '<p class="section-blurb">One system, built up incident by incident. Step through the architecture as it evolves.</p>' +
        '<div class="case-grid">' + CASES.map(caseCard).join("") + "</div>" : "") +

      '<h2 class="section-h">Question bank — how each question is structured</h2>' +
      '<div class="framework">' +
      fw(1, "Scenario", "A realistic Snowflake deployment and what’s going wrong.") +
      fw(2, "Interview answer", "What’s tested, the 30-second answer, deep dive, trade-off.") +
      fw(3, "High-level design", "Vendor-neutral components and data flow.") +
      fw(4, "Low-level design", "Snowflake objects, SQL/Python and design decisions.") +
      fw(5, "Build & video", "Step-by-step build plan and recorded walkthrough.") +
      "</div>" +

      '<div class="filters">' + chips.map(function (c) {
        return '<button class="chip' + (state.filter === c[0] ? " active" : "") + '" data-filter="' + c[0] + '">' + esc(c[1]) + "</button>";
      }).join("") + "</div>";

    var any = false;
    SECTIONS.forEach(function (s) {
      var qs = QUESTIONS.filter(function (q) { return q.section === s.id && passesFilter(q) && matches(q, state.query); });
      if (!qs.length) return;
      any = true;
      html += '<h2 class="section-h">' + esc(s.name) + " <small>" + qs.length + " scenario" + (qs.length > 1 ? "s" : "") + "</small></h2>" +
        '<p class="section-blurb">' + esc(s.blurb) + "</p>" +
        '<div class="grid">' + qs.map(card).join("") + "</div>";
    });
    if (!any) html += '<p class="empty">No scenarios match “' + esc(state.query) + "”.</p>";

    app.innerHTML = html;
    app.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () { state.filter = b.getAttribute("data-filter"); renderHome(); });
    });
  }
  function fw(n, h, p) {
    return '<div class="fw-step"><div class="n">STEP ' + n + "</div><h4>" + h + "</h4><p>" + p + "</p></div>";
  }

  /* ---------- diagram ---------- */
  function renderDiagram(d, flavour) {
    if (!d || !d.lanes) return '<p class="note">Diagram coming soon.</p>';
    var lanes = d.lanes.map(function (lane) {
      var cols = lane.cols.map(function (col) {
        return '<div class="col">' + col.map(function (n) {
          return '<div class="node k-' + esc(n.k) + '"><b>' + esc(n.t) + "</b>" + (n.s ? "<span>" + esc(n.s) + "</span>" : "") + "</div>";
        }).join("") + "</div>";
      }).join('<div class="arrow"></div>');
      return '<div class="lane">' + (lane.name ? '<div class="lane-name">' + esc(lane.name) + "</div>" : "") +
        '<div class="flow">' + cols + "</div></div>";
    }).join("");
    var legend = '<div class="legend">' + KINDS.map(function (k) {
      return '<span><i style="background:var(--k-' + k[0] + ')"></i>' + k[1] + "</span>";
    }).join("") + "</div>";
    return '<div class="diagram-actions"><span class="diagram-flavour">' + flavour + '</span>' +
      '<button class="btn ghost" data-action="fullscreen">&#x26F6; Expand</button></div>' +
      '<div class="diagram" id="diagram">' + lanes + "</div>" +
      (d.caption ? '<p class="diagram-caption">' + esc(d.caption) + "</p>" : "") + legend;
  }

  /* ---------- tabs ---------- */
  function scenarioBox(q) {
    return q.scenario ? '<div class="callout scenario"><div class="label">Scenario</div><p>' + esc(q.scenario) + "</p></div>" : "";
  }

  function panelAnswer(q) {
    var blocks = (q.answer || []).map(function (b) {
      return '<div class="answer-block"><h4>' + esc(b.h) + "</h4><ul>" +
        b.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul></div>";
    }).join("");
    return scenarioBox(q) +
      '<div class="callout tests"><div class="label">What the interviewer is testing</div><p>' + esc(q.tests) + "</p></div>" +
      '<div class="reveal-bar"><button class="btn" data-action="reveal">Reveal answer</button><p>Practice mode: answer out loud first, then reveal. <kbd>R</kbd></p></div>' +
      '<div class="reveal-target">' +
      '<div class="callout tldr"><div class="label">30-second answer</div><p>' + esc(q.tldr) + "</p></div>" +
      '<div class="answer-grid">' + blocks + "</div>" +
      '<div class="callout tradeoff"><div class="label">Trade-off to call out</div><p>' + esc(q.tradeoff) + "</p></div>" +
      '<div class="callout takeaway"><div class="label">Key takeaway</div><p>' + esc(q.takeaway) + "</p></div>" +
      "</div>" + relatedBox(q);
  }

  function relatedBox(q) {
    var cs = q.caseStudy && caseById(q.caseStudy.id);
    var rel = (q.related || []).map(byId).filter(Boolean);
    if (!cs && !rel.length) return "";
    return '<div class="related">' +
      (cs ? '<a class="related-case" href="#/case/' + cs.id + "/" + q.caseStudy.stage + '">' +
        '<span class="case-card-tag">See it in the case study</span><b>' + esc(cs.title) + "</b>" +
        "<span>Stage " + q.caseStudy.stage + " &middot; " + esc(cs.stages[q.caseStudy.stage].title) + " &rarr;</span></a>" : "") +
      (rel.length ? '<div class="related-qs"><div class="label">Related questions</div>' + rel.map(function (r) {
        return '<a href="#/q/' + r.id + '"><span class="nav-num">' + num(r.num) + "</span>" + esc(r.title) + "</a>";
      }).join("") + "</div>" : "") + "</div>";
  }

  function panelHLD(q) {
    return '<p class="panel-intro">Vendor-neutral architecture — the diagram you would draw on the whiteboard in an interview.</p>' +
      renderDiagram(q.hld, "High-level · vendor-neutral") +
      '<div class="callout tradeoff" style="margin-top:18px"><div class="label">Trade-off</div><p>' + esc(q.tradeoff) + "</p></div>" +
      '<p class="panel-next"><a href="#/q/' + q.id + '/lld">See how this maps to Snowflake &rarr;</a></p>';
  }

  function panelLLD(q) {
    var l = q.lld;
    if (!l) return '<p class="note">Low-level design coming soon.</p>';
    var objects = (l.objects || []).length ?
      '<h3 class="sub-h">Snowflake objects</h3><div class="table-wrap"><table class="table"><thead><tr><th>Object</th><th>Type</th><th>Purpose</th></tr></thead><tbody>' +
      l.objects.map(function (o) { return "<tr><td><code>" + esc(o[0]) + "</code></td><td>" + esc(o[1]) + "</td><td>" + esc(o[2]) + "</td></tr>"; }).join("") +
      "</tbody></table></div>" : "";
    var code = (l.code || []).map(function (c, i) {
      return '<div class="code-block"><div class="code-head"><span>' + esc(c.title) + '</span><span class="code-lang">' + esc(c.lang) +
        '</span><button class="btn ghost small" data-action="copy" data-idx="' + i + '">Copy</button></div>' +
        "<pre><code>" + highlight(c.src, c.lang) + "</code></pre></div>";
    }).join("");
    var notes = (l.notes || []).length ?
      '<h3 class="sub-h">Design decisions</h3><ul class="notes">' + l.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "";
    return '<p class="panel-intro">How the high-level design is implemented with Snowflake objects. SQL is a reference design to validate while building.</p>' +
      renderDiagram(l, "Low-level · Snowflake") + objects +
      (code ? '<h3 class="sub-h">Implementation</h3>' + code : "") + notes;
  }

  function panelBuild(q) {
    var b = q.build || {}, st = status(q), v = q.video || {};
    var video = v.youtubeId ?
      '<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.youtubeId) +
      '" title="' + esc(q.title) + '" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>' +
      (v.notes ? '<p class="diagram-caption">' + esc(v.notes) + "</p>" : "") :
      '<div class="video-empty"><div class="big">&#9654;</div><p><b>Video walkthrough coming soon</b></p>' +
      "<p>The Snowflake build of this scenario will be recorded and embedded here.</p></div>";
    return '<div class="sf-head"><div class="sf-logo">&#10052;</div><div><h3>Build it on Snowflake</h3>' +
      '<span class="badge st-' + st + '">' + STATUS[st] + "</span></div></div>" +
      '<ol class="steps">' + (b.steps || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      (b.repo ? '<p><a class="btn" href="' + esc(b.repo) + '" target="_blank" rel="noopener">View code &rarr;</a></p>' : "") +
      '<h3 class="sub-h">Video</h3>' + video;
  }

  function renderQuestion(id, tab) {
    var q = byId(id);
    if (!q) { location.hash = "#/"; return; }
    if (!TABS.some(function (t) { return t.id === tab; })) tab = "answer";
    var i = QUESTIONS.indexOf(q);
    var prev = QUESTIONS[i - 1], next = QUESTIONS[i + 1];
    var st = status(q);

    var body = tab === "hld" ? panelHLD(q)
      : tab === "lld" ? panelLLD(q)
      : tab === "build" ? panelBuild(q)
      : panelAnswer(q);

    app.innerHTML =
      '<div class="crumbs"><a href="#/">Overview</a> &rsaquo; ' + esc(section(q.section).name) + " &rsaquo; " + num(q.num) + "</div>" +
      '<h1 class="q-title">' + esc(q.title) + "</h1>" +
      '<div class="q-meta"><span class="badge level-' + q.level + '">' + q.level + "</span>" +
      '<span class="badge st-' + st + '">' + STATUS[st] + "</span>" +
      (q.tags || []).map(function (t) { return '<span class="tag">#' + esc(t) + "</span>"; }).join("") +
      '<span style="margin-left:auto"></span>' +
      '<button class="btn ' + (done[q.id] ? "done" : "ghost") + '" data-action="done">' + (done[q.id] ? "&#10003; Studied" : "Mark as studied") + "</button></div>" +
      '<div class="tabs" role="tablist">' + TABS.map(function (t, n) {
        return '<a class="tab' + (t.id === tab ? " active" : "") + '" role="tab" href="#/q/' + q.id + "/" + t.id + '">' +
          '<span class="tab-n">' + (n + 1) + "</span>" + t.name + "</a>";
      }).join("") + "</div>" +
      '<div class="tab-panel" id="panel">' + body + "</div>" +
      '<div class="pager">' +
      (prev ? '<a class="prev" href="#/q/' + prev.id + "/" + tab + '"><small>&larr; Previous</small>' + esc(prev.title) + "</a>" : "<span></span>") +
      (next ? '<a class="next" href="#/q/' + next.id + "/" + tab + '"><small>Next &rarr;</small>' + esc(next.title) + "</a>" : "") +
      "</div>" +
      '<div class="kbd-hint"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> previous / next &middot; <kbd>1</kbd>–<kbd>4</kbd> tabs &middot; <kbd>/</kbd> search</div>';

    app.querySelectorAll("[data-action]").forEach(function (el) {
      el.addEventListener("click", function () {
        var a = el.getAttribute("data-action");
        if (a === "done") {
          if (done[q.id]) delete done[q.id]; else done[q.id] = true;
          save("done", done); updateProgress(); route();
        } else if (a === "reveal") {
          document.getElementById("panel").classList.add("revealed");
        } else if (a === "fullscreen") {
          toggleFullscreen();
        } else if (a === "copy") {
          var src = q.lld.code[+el.getAttribute("data-idx")].src;
          copyText(src).then(function () {
            el.textContent = "Copied"; setTimeout(function () { el.textContent = "Copy"; }, 1500);
          });
        }
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  function toggleFullscreen() {
    var d = document.getElementById("diagram");
    if (!d) return;
    d.classList.toggle("fullscreen");
    var btn = app.querySelector('[data-action="fullscreen"]');
    if (btn) btn.innerHTML = d.classList.contains("fullscreen") ? "&#x2715; Close" : "&#x26F6; Expand";
  }

  /* ---------- case study (architecture stepper) ---------- */
  var caseView = load("caseView", "hld");

  function renderCaseDiagram(cs, stageN) {
    var lld = caseView === "lld";
    var lanes = cs.lanes.map(function (lane) {
      var comps = cs.components.filter(function (c) {
        return c.lane === lane.id && c.stage <= stageN && (c.until === undefined || stageN < c.until);
      });
      if (!comps.length) return "";
      var colIds = comps.map(function (c) { return c.col; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      var cols = colIds.map(function (ci) {
        return '<div class="col">' + comps.filter(function (c) { return c.col === ci; }).map(function (c) {
          var isNew = c.stage === stageN && stageN > 0;
          var t = lld ? c.sf : c.t, s = lld ? c.sfs : c.s;
          return '<div class="node k-' + c.k + (isNew ? " is-new" : "") + (lld && c.ext ? " is-ext" : "") + '">' +
            (isNew ? '<em class="new-tag">NEW</em>' : "") + (lld && c.ext ? '<em class="ext-tag">external</em>' : "") +
            "<b>" + esc(t) + "</b>" + (s ? "<span>" + esc(s) + "</span>" : "") + "</div>";
        }).join("") + "</div>";
      }).join('<div class="arrow"></div>');
      return '<div class="lane"><div class="lane-name">' + esc(lane.name) + '</div><div class="flow">' + cols + "</div></div>";
    }).join("");
    var legend = '<div class="legend">' + KINDS.map(function (k) {
      return '<span><i style="background:var(--k-' + k[0] + ')"></i>' + k[1] + "</span>";
    }).join("") + '<span><i class="legend-new"></i>Added in this stage</span>' +
      (lld ? '<span><i class="legend-ext"></i>Outside Snowflake</span>' : "") + "</div>";
    return '<div class="diagram-actions">' +
      '<div class="seg"><button class="seg-btn' + (lld ? "" : " active") + '" data-view="hld">High-level design</button>' +
      '<button class="seg-btn' + (lld ? " active" : "") + '" data-view="lld">Snowflake low-level design</button></div>' +
      '<button class="btn ghost" data-action="fullscreen">&#x26F6; Expand</button></div>' +
      '<div class="diagram" id="diagram">' + lanes + "</div>" + legend;
  }

  function renderCase(id, stageN) {
    var cs = caseById(id);
    if (!cs) { location.hash = "#/"; return; }
    stageN = Math.max(0, Math.min(cs.stages.length - 1, isNaN(stageN) ? 0 : stageN));
    var st = cs.stages[stageN], last = cs.stages.length - 1;
    var added = (st.adds || []).map(function (cid) {
      return cs.components.filter(function (c) { return c.id === cid; })[0];
    }).filter(Boolean);
    var rel = (st.related || []).map(byId).filter(Boolean);

    var html =
      '<div class="crumbs"><a href="#/">Overview</a> &rsaquo; Case studies &rsaquo; ' + esc(cs.title) + "</div>" +
      '<h1 class="q-title">' + esc(cs.title) + "</h1>" +
      (stageN === 0 ? '<div class="callout scenario"><div class="label">The story</div><p>' + esc(cs.story) + "</p>" +
        '<p class="cast">' + (cs.cast || []).map(function (c) { return "<b>" + esc(c[0]) + "</b> — " + esc(c[1]); }).join(" &middot; ") + "</p></div>" : "") +

      '<div class="stepper">' + cs.stages.map(function (s, n) {
        return '<a class="step' + (n === stageN ? " active" : "") + (n < stageN ? " past" : "") + '" href="#/case/' + cs.id + "/" + n +
          '" title="' + esc(s.title) + '"><span class="step-n">' + n + '</span><span class="step-t">' + esc(s.title.split(" — ").pop()) + "</span></a>";
      }).join("") + "</div>" +

      '<div class="stage-head"><div><div class="stage-kicker">Stage ' + stageN + " of " + last + "</div>" +
      "<h2>" + esc(st.title) + "</h2></div>" +
      '<div class="stage-nav">' +
      (stageN > 0 ? '<a class="btn ghost" href="#/case/' + cs.id + "/" + (stageN - 1) + '">&larr; Prev</a>' : "") +
      (stageN < last ? '<a class="btn" href="#/case/' + cs.id + "/" + (stageN + 1) + '">Next incident &rarr;</a>' : "") +
      "</div></div>" +

      '<div class="callout incident"><div class="label">Incident</div><p>' + esc(st.incident) + "</p></div>" +
      renderCaseDiagram(cs, stageN) +

      '<div class="stage-grid">' +
      '<div class="answer-block"><h4>Questions to ask</h4><ul>' + (st.ask || []).map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="answer-block"><h4>' + (added.length ? "What we add" : "Key points") + "</h4>" +
      (added.length ? '<div class="added">' + added.map(function (c) { return '<span class="badge sf">' + esc(c.t) + "</span>"; }).join("") + "</div>" : "") +
      "<ul>" + (st.points || []).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="answer-block sf-block"><h4>&#10052; On Snowflake</h4><ul>' + (st.snowflake || []).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></div>" +
      "</div>" +

      (st.code ? '<div class="code-block"><div class="code-head"><span>Snowflake sketch</span><span class="code-lang">' + esc(st.code.lang) +
        '</span><button class="btn ghost small" data-action="copy-stage">Copy</button></div><pre><code>' + highlight(st.code.src, st.code.lang) + "</code></pre></div>" : "") +

      (st.walkthrough ? '<h3 class="sub-h">Step by step</h3><ol class="walk">' + st.walkthrough.map(function (w) {
        return '<li><span class="walk-actor">' + esc(w.actor) + "</span><div><b>" + esc(w.t) + "</b><p>" + esc(w.d) + "</p>" +
          (w.code ? "<pre><code>" + highlight(w.code, "sql") + "</code></pre>" : "") + "</div></li>";
      }).join("") + "</ol>" + (st.table ? '<h3 class="sub-h">When something isn’t allowed</h3>' : "") : "") +

      (st.table ? '<div class="table-wrap"><table class="table"><thead><tr>' + st.table.head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
        "</tr></thead><tbody>" + st.table.rows.map(function (r) {
          return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>" : "") +

      (rel.length ? '<div class="related"><div class="related-qs"><div class="label">Deep dive: full answer, HLD, Snowflake LLD and SQL</div>' + rel.map(function (r) {
        return '<a href="#/q/' + r.id + '/lld"><span class="nav-num">' + num(r.num) + "</span>" + esc(r.title) + "</a>";
      }).join("") + "</div></div>" : "") +

      (stageN === last ? '<h3 class="sub-h">Practice: interview questions from this case study</h3><ol class="steps">' +
        cs.practice.map(function (p) {
          var q = byId(p.id);
          return "<li>" + esc(p.q) + (q ? ' <a href="#/q/' + q.id + '">&rarr; ' + num(q.num) + "</a>" : "") + "</li>";
        }).join("") + "</ol>" : "") +

      '<div class="kbd-hint"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> previous / next stage &middot; <kbd>V</kbd> toggle HLD / Snowflake view</div>';

    app.innerHTML = html;
    app.querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () { caseView = b.getAttribute("data-view"); save("caseView", caseView); renderCase(id, stageN); });
    });
    var fsb = app.querySelector('[data-action="fullscreen"]');
    if (fsb) fsb.addEventListener("click", toggleFullscreen);
    var cpb = app.querySelector('[data-action="copy-stage"]');
    if (cpb) cpb.addEventListener("click", function () {
      copyText(st.code.src).then(function () { cpb.textContent = "Copied"; setTimeout(function () { cpb.textContent = "Copy"; }, 1500); });
    });
    var step = app.querySelector(".step.active");
    if (step && step.scrollIntoView) step.scrollIntoView({ block: "nearest", inline: "center" });
  }

  /* ---------- router ---------- */
  function current() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    if (parts[0] === "q") return { type: "q", id: parts[1], tab: parts[2] || "answer" };
    if (parts[0] === "case") return { type: "case", id: parts[1], stage: parseInt(parts[2] || "0", 10) };
    return null;
  }

  function route() {
    var c = current();
    var q = c && c.type === "q" && byId(c.id);
    if (q) openSections[q.section] = true;   // always reveal where you are
    renderSidebar(q ? q.id : null);
    if (q) renderQuestion(c.id, c.tab);
    else if (c && c.type === "case") renderCase(c.id, c.stage);
    else renderHome();
    sidebar.classList.remove("open");
  }

  window.addEventListener("hashchange", function () { route(); window.scrollTo(0, 0); });

  /* ---------- controls ---------- */
  search.addEventListener("input", function () {
    state.query = search.value.trim();
    if (current()) location.hash = "#/"; else renderHome();
  });

  practiceToggle.checked = load("practice", false);
  document.body.classList.toggle("practice", practiceToggle.checked);
  practiceToggle.addEventListener("change", function () {
    document.body.classList.toggle("practice", practiceToggle.checked);
    save("practice", practiceToggle.checked);
    if (current()) route();
  });

  var theme = load("theme", "dark");
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeBtn").addEventListener("click", function () {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    save("theme", theme);
  });

  document.getElementById("menuBtn").addEventListener("click", function () { sidebar.classList.toggle("open"); });

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "Escape") {
      var d = document.getElementById("diagram");
      if (d && d.classList.contains("fullscreen")) toggleFullscreen();
      if (tag === "input") e.target.blur();
      return;
    }
    if (tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); search.focus(); return; }
    var c = current();
    if (!c) return;
    if (c.type === "case") {
      var cs = caseById(c.id);
      if (!cs) return;
      if (e.key === "ArrowRight" && c.stage < cs.stages.length - 1) location.hash = "#/case/" + c.id + "/" + (c.stage + 1);
      else if (e.key === "ArrowLeft" && c.stage > 0) location.hash = "#/case/" + c.id + "/" + (c.stage - 1);
      else if (e.key.toLowerCase() === "v") { caseView = caseView === "lld" ? "hld" : "lld"; save("caseView", caseView); renderCase(c.id, c.stage); }
      return;
    }
    var i = QUESTIONS.indexOf(byId(c.id));
    if (e.key === "ArrowRight" && QUESTIONS[i + 1]) location.hash = "#/q/" + QUESTIONS[i + 1].id + "/" + c.tab;
    else if (e.key === "ArrowLeft" && QUESTIONS[i - 1]) location.hash = "#/q/" + QUESTIONS[i - 1].id + "/" + c.tab;
    else if (/^[1-4]$/.test(e.key)) location.hash = "#/q/" + c.id + "/" + TABS[+e.key - 1].id;
    else if (e.key.toLowerCase() === "r") { var p = document.getElementById("panel"); if (p) p.classList.add("revealed"); }
  });

  updateProgress();
  route();
})();
