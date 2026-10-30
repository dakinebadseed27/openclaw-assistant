(function () {
  "use strict";
  var POLL_MS = 60000, STALE_MS = 2 * 3600 * 1000, FRAME_MS = 1000 / 30;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (id) { return document.getElementById(id); };
  var state = { agents: { folders: [], agents: [] }, meta: null };
  var baseVersion = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fmtTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    if (!m) return String(hhmm);
    var h = +m[1];
    return ((h % 12) || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
  }
  function fmtNum(n) {
    n = +n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "K";
    return String(n);
  }

  /* ---------- clock / header ---------- */
  function tick() {
    var now = new Date();
    $("clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    var m = state.meta;
    if (m && m.last_updated) {
      var d = new Date(m.last_updated);
      if (!isNaN(d)) {
        $("updTime").textContent = d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        $("upd").classList.toggle("stale", now - d > STALE_MS);
      }
    }
    markCalendar();
  }

  /* ---------- panel renderers ---------- */
  var render = {
    meta: function (d) {
      state.meta = d;
      $("sampleBadge").hidden = d.sample !== true;
      tick();
    },
    directives: function (d) {
      var ol = $("directives"); ol.textContent = "";
      var list = d.directives || [];
      if (!list.length) ol.appendChild(el("li", "empty", "No directives"));
      list.forEach(function (x) {
        var li = el("li", x.priority || "low");
        li.appendChild(el("span", "pri"));
        li.appendChild(el("span", "tx", x.text));
        ol.appendChild(li);
      });
    },
    calendar: function (d) {
      var ul = $("calendar"); ul.textContent = "";
      var list = d.events || [];
      if (!list.length) ul.appendChild(el("li", "empty", "No events today"));
      list.forEach(function (x) {
        var li = el("li"); li.setAttribute("data-t", x.time);
        li.appendChild(el("span", "t", fmtTime(x.time)));
        li.appendChild(el("span", "tx", x.title));
        ul.appendChild(li);
      });
      markCalendar();
    },
    vitals: function (d) {
      var box = $("vitals"); box.textContent = "";
      (d.tiles || []).slice(0, 4).forEach(function (t) {
        var c = el("div", "tile");
        c.appendChild(el("div", "v", String(t.value)));
        c.appendChild(el("div", "l", t.label));
        if (t.sub) c.appendChild(el("div", "s", t.sub));
        box.appendChild(c);
      });
    },
    skills: function (d) {
      var box = $("skills"); box.textContent = "";
      (d.skills || []).forEach(function (s) {
        var b = el("button"); b.type = "button";
        b.appendChild(el("b", null, s.label));
        if (s.sub) b.appendChild(el("span", null, s.sub));
        b.addEventListener("click", function () { toast(s.label + ": Coming soon"); });
        box.appendChild(b);
      });
    },
    agents: function (d) {
      state.agents = { folders: d.folders || [], agents: d.agents || [] };
      var ul = $("legend"); ul.textContent = "";
      state.agents.agents.forEach(function (a) {
        var li = el("li", a.status);
        li.appendChild(el("i"));
        li.appendChild(el("span", null, a.name));
        li.appendChild(el("span", "st", a.status === "active" && a.folder ? "active - " + a.folder : a.status));
        ul.appendChild(li);
      });
      hive.sync();
    },
    tokens: function (d) {
      var t = d.today || {};
      $("tokTotal").textContent = fmtNum(t.total);
      var sub = "tokens today";
      $("tokSub").textContent = sub;
      var bar = $("tokBar");
      if (t.budget) {
        var pct = Math.min(100, 100 * t.total / t.budget);
        bar.hidden = false; bar.firstElementChild.style.width = pct + "%";
        bar.classList.toggle("warn", pct >= 85);
        $("tokSub").textContent = Math.round(pct) + "% of " + fmtNum(t.budget) + " budget";
      } else bar.hidden = true;
      var box = $("tokBars"); box.textContent = "";
      var days = (d.last7 || []).slice(-7);
      var max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
      days.forEach(function (x, i) {
        var b = el("div", "bar" + (i === days.length - 1 ? " today" : ""));
        b.appendChild(el("div", "n", fmtNum(x.total)));
        var c = el("div", "col"); c.style.height = Math.max(2, 100 * x.total / max * 0.72) + "%";
        b.appendChild(c);
        var dt = new Date(x.date + "T12:00:00");
        b.appendChild(el("div", "d", isNaN(dt) ? "" : dt.toLocaleDateString([], { weekday: "short" })));
        box.appendChild(b);
      });
    }
  };
  var panelOf = { meta: "upd", directives: "p-directives", calendar: "p-calendar", vitals: "p-vitals", skills: "p-skills", agents: "p-agents", tokens: "p-tokens" };

  function markCalendar() {
    var items = $("calendar").querySelectorAll("li[data-t]");
    var now = new Date(), cur = now.getHours() * 60 + now.getMinutes(), nextSet = false;
    items.forEach(function (li) {
      var p = li.getAttribute("data-t").split(":"), m = (+p[0]) * 60 + (+p[1]);
      li.classList.toggle("past", m < cur - 30);
      var isNext = !nextSet && m >= cur - 30;
      if (isNext) nextSet = true;
      li.classList.toggle("now", isNext);
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  /* ---------- data polling ---------- */
  function setErr(name, on) {
    if (name === "meta") { $("metaErr").hidden = !on; return; }
    $(panelOf[name]).classList.toggle("err", on);
  }
  function load(name) {
    return fetch("./data/" + name + ".json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (name === "meta") {
          if (baseVersion === null) baseVersion = d.version;
          else if (d.version !== baseVersion) { location.reload(); return; }
        }
        render[name](d); setErr(name, false);
      })
      .catch(function () { setErr(name, true); });
  }
  function pollAll() { Object.keys(render).forEach(load); }

  /* ---------- Hive Mind canvas ---------- */
  var hive = (function () {
    var cv = $("hive"), ctx = cv.getContext("2d");
    var W = 0, H = 0, dpr = 1, drones = {}, raf = 0, last = 0, t0 = performance.now();
    var cs = getComputedStyle(document.documentElement);
    var C = { acc: cs.getPropertyValue("--accent").trim() || "#2ee6d6", amber: cs.getPropertyValue("--amber").trim() || "#ffb020",
      idle: "#7f93ab", line: "#24405a", text: "#e6eef6", muted: "#8499ad" };
    var sans = cs.getPropertyValue("--sans").trim() || "sans-serif";
    var mono = cs.getPropertyValue("--mono").trim() || "monospace";
    var S = 1, hub = { x: 0, y: 0, r: 40 }, fpos = {}, RX = 0, RY = 0;

    function resize() {
      var r = cv.parentNode.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(100, Math.round(r.width)); H = Math.max(100, Math.round(r.height));
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S = Math.max(0.62, Math.min(W / 900, H / 600, 1.6));
      layout();
      if (reduced) { snap(); draw(performance.now()); }
    }
    function folderBox(name) {
      ctx.font = "600 " + Math.round(17 * S + 3) + "px " + sans;
      var w = ctx.measureText(name).width + 34 * S, h = 30 * S + 4;
      return { w: w, h: h };
    }
    function layout() {
      hub.x = W / 2; hub.y = H / 2; hub.r = 52 * S + 4;
      var fs = state.agents.folders, n = fs.length || 1;
      var mx = 60 * S + 40, my = 28 * S + 10;
      var rx = W / 2 - mx, ry = H / 2 - my; RX = rx; RY = ry;
      fpos = {};
      fs.forEach(function (f, i) {
        var a = -Math.PI / 2 + i * 2 * Math.PI / n;
        var b = folderBox(f);
        fpos[f] = { x: hub.x + rx * Math.cos(a), y: hub.y + ry * Math.sin(a), a: a, w: b.w, h: b.h };
      });
    }
    function dockPos(i, n) {
      var a = -Math.PI / 2 + (i + 0.5) * 2 * Math.PI / Math.max(n, 1) + Math.PI / n * 0;
      var r = hub.r + 34 * S;
      return { x: hub.x + r * Math.cos(a), y: hub.y + r * Math.sin(a), a: a };
    }
    function targets() {
      var ag = state.agents.agents, byFolder = {}, docked = [];
      ag.forEach(function (a) {
        if (a.status === "active" && fpos[a.folder]) (byFolder[a.folder] = byFolder[a.folder] || []).push(a);
        else docked.push(a);
      });
      var res = {};
      Object.keys(byFolder).forEach(function (f) {
        var list = byFolder[f], p = fpos[f];
        list.forEach(function (a, k) {
          var dx = hub.x - p.x, dy = hub.y - p.y, d = Math.hypot(dx, dy) || 1;
          var ux = dx / d, uy = dy / d, off = p.h / 2 + 60 * S, sp = (k - (list.length - 1) / 2) * 62 * S;
          res[a.name] = { x: p.x + ux * off - uy * sp, y: p.y + uy * off + ux * sp, mode: "work", fx: p.x, fy: p.y };
        });
      });
      docked.forEach(function (a, i) {
        var d = dockPos(i, docked.length);
        res[a.name] = { x: d.x, y: d.y, mode: "dock", a: d.a };
      });
      return res;
    }
    var tg = {};
    function sync() {
      layout();
      tg = targets();
      var seen = {};
      state.agents.agents.forEach(function (a) {
        seen[a.name] = 1;
        var d = drones[a.name];
        if (!d) d = drones[a.name] = { x: hub.x, y: hub.y, h: -Math.PI / 2, ph: Math.random() * 6 };
        d.status = a.status; d.name = a.name;
      });
      Object.keys(drones).forEach(function (k) { if (!seen[k]) delete drones[k]; });
      if (reduced) { snap(); draw(performance.now()); } else start();
    }
    function snap() {
      Object.keys(drones).forEach(function (k) {
        var t = tg[k]; if (!t) return;
        drones[k].x = t.x; drones[k].y = t.y;
        drones[k].h = t.mode === "work" ? Math.atan2(t.fy - t.y, t.fx - t.x) : -Math.PI / 2;
      });
    }
    function angLerp(a, b, k) {
      var d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
      return a + d * k;
    }
    function hexPath(x, y, r, rot) {
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = rot + i * Math.PI / 3;
        ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
    }
    function drawFolder(name, p, hot, err) {
      var w = p.w, h = p.h, x = p.x - w / 2, y = p.y - h / 2, rr = 5 * S;
      var col = err ? C.amber : hot ? C.acc : C.line;
      ctx.fillStyle = hot ? "rgba(46,230,214,0.10)" : "rgba(20,36,52,0.9)";
      ctx.strokeStyle = col; ctx.lineWidth = hot ? 1.6 : 1.2;
      ctx.beginPath();
      ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
      ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
      ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(x + 8 * S, y - 3, 14 * S, 3); // folder tab
      ctx.fillStyle = hot ? C.text : "#b7c6d6";
      ctx.font = "600 " + Math.round(17 * S + 3) + "px " + sans;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(name, p.x, p.y + 1);
    }
    function drawDrone(d, t, time) {
      var col = d.status === "error" ? C.amber : d.status === "active" ? C.acc : C.idle;
      var r = 14 * S + 2, x = d.x, y = d.y;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, d.status === "idle" ? "rgba(127,147,171,0.25)" : (d.status === "error" ? "rgba(255,176,32,0.45)" : "rgba(46,230,214,0.45)"));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, 6.283); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(d.h);
      ctx.beginPath();
      var P = [[1.5, 0], [0.25, 0.5], [-0.35, 1.25], [-0.85, 1.05], [-0.7, 0.35], [-0.95, 0], [-0.7, -0.35], [-0.85, -1.05], [-0.35, -1.25], [0.25, -0.5]];
      P.forEach(function (q) { ctx.lineTo(q[0] * r, q[1] * r); });
      ctx.closePath();
      ctx.fillStyle = "#0a1824"; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
      hexPath(0, 0, r * 0.38, 0);
      ctx.fillStyle = col; ctx.fill();
      ctx.restore();
    }
    function drawLabel(d, t) {
      ctx.font = "600 " + Math.round(13 * S + 3) + "px " + sans;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var r = 14 * S + 2, lx = d.x, ly = d.y + r + 14 * S;
      if (t && t.mode === "work") { var vx = d.x - t.fx, vy = d.y - t.fy, vl = Math.hypot(vx, vy) || 1; lx = d.x + vx / vl * (r + 24 * S); ly = d.y + vy / vl * (r + 12 * S); }
      if (t && t.mode === "dock") { lx = d.x + Math.cos(t.a) * (r + 34 * S); ly = d.y + Math.sin(t.a) * (r + 18 * S); }
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(7,11,17,0.9)"; ctx.strokeText(d.name, lx, ly);
      ctx.fillStyle = d.status === "error" ? C.amber : d.status === "idle" ? "#a9b8c8" : C.acc;
      ctx.fillText(d.name, lx, ly);
    }
    function draw(now) {
      var time = reduced ? 0 : (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      // ring guide + spokes
      var fs = state.agents.folders, n = fs.length;
      if (n) {
        ctx.strokeStyle = "rgba(36,64,90,0.55)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(hub.x, hub.y, RX, RY, 0, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = "rgba(36,64,90,0.35)";
        fs.forEach(function (f) { var p = fpos[f]; ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(p.x, p.y); ctx.stroke(); });
      }
      // active folders
      var hot = {}, errf = {};
      state.agents.agents.forEach(function (a) { if (a.status === "active" && a.folder) hot[a.folder] = 1; });
      fs.forEach(function (f) { drawFolder(f, fpos[f], hot[f], false); });
      // hub
      var pulse = reduced ? 0 : Math.sin(time * 1.4) * 3 * S;
      ctx.strokeStyle = "rgba(46,230,214,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hub.x, hub.y, hub.r + 34 * S + 30 * S + pulse, 0, 6.283); ctx.stroke();
      var hg = ctx.createRadialGradient(hub.x, hub.y, hub.r * 0.4, hub.x, hub.y, hub.r * 2.2);
      hg.addColorStop(0, "rgba(46,230,214,0.28)"); hg.addColorStop(1, "rgba(46,230,214,0)");
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hub.x, hub.y, hub.r * 2.2, 0, 6.283); ctx.fill();
      hexPath(hub.x, hub.y, hub.r, Math.PI / 6);
      ctx.fillStyle = "#0a1a26"; ctx.fill(); ctx.strokeStyle = C.acc; ctx.lineWidth = 2; ctx.stroke();
      hexPath(hub.x, hub.y, hub.r * 0.82, Math.PI / 6);
      ctx.strokeStyle = "rgba(46,230,214,0.35)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = C.acc; ctx.font = "700 " + Math.round(14 * S + 3) + "px " + mono;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("H1V3", hub.x, hub.y - 8 * S - 1);
      ctx.fillText("M1ND", hub.x, hub.y + 8 * S + 1);
      // beams, drones
      var list = Object.keys(drones).map(function (k) { return drones[k]; });
      list.forEach(function (d) {
        var t = tg[d.name];
        if (t && t.mode === "work" && Math.hypot(t.x - d.x, t.y - d.y) < 12 * S + 6) {
          var fa = state.agents.agents.filter(function (a) { return a.name === d.name; })[0], p = fpos[fa.folder];
          var ux = d.x - p.x, uy = d.y - p.y, ul = Math.hypot(ux, uy) || 1, e = p.h / 2 + 3;
          ctx.strokeStyle = "rgba(46,230,214,0.85)"; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(p.x + ux / ul * e, p.y + uy / ul * e); ctx.stroke();
        }
      });
      list.forEach(function (d) { drawDrone(d, tg[d.name], time); });
      list.forEach(function (d) { drawLabel(d, tg[d.name]); });
    }
    function step(now) {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      var dt = now - last;
      if (dt < FRAME_MS) return;
      last = now - (dt % FRAME_MS);
      dt = Math.min(dt, 100) / 1000;
      var k = 1 - Math.exp(-dt * 1.8), time = now / 1000;
      Object.keys(drones).forEach(function (key) {
        var d = drones[key], t = tg[key]; if (!t) return;
        var tx = t.x, ty = t.y;
        if (t.mode === "work") { tx += Math.cos(time * 1.3 + d.ph) * 3 * S; ty += Math.sin(time * 1.9 + d.ph) * 3 * S; }
        var dist = Math.hypot(tx - d.x, ty - d.y);
        d.x += (tx - d.x) * k; d.y += (ty - d.y) * k;
        var th;
        if (dist > 8 * S + 4) th = Math.atan2(ty - d.y, tx - d.x);
        else th = t.mode === "work" ? Math.atan2(t.fy - d.y, t.fx - d.x) : -Math.PI / 2;
        d.h = angLerp(d.h, th, Math.min(1, dt * 5));
      });
      draw(now);
    }
    function start() { if (!reduced && !raf) { last = 0; raf = requestAnimationFrame(step); } }
    window.addEventListener("resize", function () { resize(); sync(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) last = 0; });
    resize();
    return { sync: sync, start: start };
  })();

  tick();
  setInterval(tick, 1000);
  pollAll();
  setInterval(pollAll, POLL_MS);
})();
