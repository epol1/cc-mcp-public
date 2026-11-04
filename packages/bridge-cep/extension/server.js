"use strict";
/*
 * ae-compose CEP bridge server (hot-reloaded by loader.js on every save).
 *
 * HTTP on 127.0.0.1 only. Every mutating endpoint requires the token stored in
 * ~/.ae-compose/bridge.json, and any request carrying an Origin header is refused,
 * so web pages cannot drive After Effects through this port.
 *
 *   GET  /health            -> { ok, name, version, role, pid, port, uptimeMs, stats }
 *   POST /eval   {script, timeoutMs?}  -> { ok, result } | { ok:false, error, timedOut? }
 *   POST /reload            -> reloads the whole CEP page (loader + server)
 *   GET  /log?n=200         -> recent log lines
 */
var VERSION = "0.1.0";
var DEFAULT_PORT = 47811;
var MAX_BODY = 256 * 1024 * 1024;

var ctx = null;
var server = null;
var statusTimer = null;
var stats = { startedAt: 0, requests: 0, evals: 0, errors: 0, timeouts: 0, lastError: null, lastEvalMs: 0 };
var chain = null;

function mods() {
  var r = ctx.require;
  return { http: r("http"), fs: r("fs"), path: r("path"), os: r("os"), crypto: r("crypto") };
}

function configDir() {
  var m = mods();
  return m.path.join(m.os.homedir(), ".ae-compose");
}

function infoPath() {
  return mods().path.join(configDir(), "bridge.json");
}

function readInfo() {
  try { return JSON.parse(mods().fs.readFileSync(infoPath(), "utf8")); } catch (e) { return null; }
}

function ensureToken() {
  var m = mods();
  var info = readInfo();
  if (info && typeof info.token === "string" && info.token.length >= 32) return info.token;
  return m.crypto.randomBytes(24).toString("hex");
}

function writeInfo(port, token) {
  var m = mods();
  m.fs.mkdirSync(configDir(), { recursive: true });
  var info = {
    name: "ae-compose-bridge",
    version: VERSION,
    port: port,
    token: token,
    pid: process.pid,
    role: ctx.role,
    extDir: ctx.extDir,
    startedAt: new Date().toISOString()
  };
  m.fs.writeFileSync(infoPath(), JSON.stringify(info, null, 2));
}

// AE shows a *modal alert* for syntax errors in evalScript'd code (verified), which blocks the
// bridge until a human clicks OK. So user code is passed as a string literal and run through
// eval() inside try/catch: SyntaxErrors become catchable and come back as structured errors.
// Note: eval'd `var`s are local to the wrapper; code that must define globals assigns to $.global.
var ERR_MARK = "\u0001AEC_ERR\u0001";

function toEs3StringLiteral(s) {
  return JSON.stringify(s).replace(/[\u007f-￿]/g, function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function wrapScript(script) {
  return "(function(){try{var __r=eval(" + toEs3StringLiteral(script) + ");return (__r===undefined||__r===null)?'':String(__r);}" +
    "catch(e){return '" + ERR_MARK + "'+(e&&e.name||'Error')+'\\u0001'+(e&&e.line||0)+'\\u0001'+(e&&e.message||String(e));}})()";
}

function parseWrapped(r) {
  if (r.ok && typeof r.result === "string" && r.result.indexOf(ERR_MARK) === 0) {
    var parts = r.result.slice(ERR_MARK.length).split("\u0001");
    return { ok: false, error: parts[0] + ": " + parts.slice(2).join("\u0001"), errorName: parts[0], line: parseInt(parts[1], 10) || 0, message: parts.slice(2).join("\u0001"), ms: r.ms };
  }
  return r;
}

function evalScript(script, timeoutMs) {
  var run = function () {
    return new Promise(function (resolve) {
      var settled = false;
      var t0 = Date.now();
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        stats.timeouts++;
        resolve({ ok: false, error: "timeout after " + timeoutMs + "ms (AE busy or a modal dialog is open)", timedOut: true });
      }, timeoutMs);
      stats.evals++;
      ctx.cep.evalScript(script, function (res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stats.lastEvalMs = Date.now() - t0;
        if (res === "EvalScript error.") {
          resolve({ ok: false, error: "EvalScript error (uncaught exception in ExtendScript)", result: res });
        } else {
          resolve({ ok: true, result: res, ms: stats.lastEvalMs });
        }
      });
    });
  };
  // Serialize: one script at a time, in arrival order.
  var p = (chain || Promise.resolve()).then(run, run);
  chain = p.then(function () {}, function () {});
  return p;
}

function send(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function handle(token) {
  return function (req, res) {
    stats.requests++;
    if (req.headers.origin) return send(res, 403, { ok: false, error: "browser origins are not allowed" });
    var url = req.url || "/";
    var q = url.indexOf("?");
    var pathname = q >= 0 ? url.slice(0, q) : url;
    var query = q >= 0 ? url.slice(q + 1) : "";

    if (req.method === "GET" && pathname === "/health") {
      return send(res, 200, {
        ok: true, name: "ae-compose-bridge", version: VERSION, role: ctx.role, pid: process.pid,
        port: server && server.address() && server.address().port,
        uptimeMs: Date.now() - stats.startedAt, stats: stats
      });
    }

    if (req.headers["x-aec-token"] !== token) return send(res, 401, { ok: false, error: "missing or bad x-aec-token" });

    if (req.method === "GET" && pathname === "/log") {
      var n = 200;
      var mm = /(?:^|&)n=(\d+)/.exec(query);
      if (mm) n = parseInt(mm[1], 10);
      return send(res, 200, { ok: true, lines: ctx.ring.slice(-n) });
    }

    if (req.method === "POST" && pathname === "/reload") {
      send(res, 200, { ok: true });
      setTimeout(function () { ctx.reloadAll(); }, 50);
      return;
    }

    if (req.method === "POST" && pathname === "/eval") {
      readBody(req).then(function (raw) {
        var body;
        try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { ok: false, error: "invalid JSON body" }); }
        if (typeof body.script !== "string") return send(res, 400, { ok: false, error: "script must be a string" });
        var timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : 120000;
        var raw = body.raw === true;
        return evalScript(raw ? body.script : wrapScript(body.script), timeoutMs).then(function (r) {
          if (!raw) r = parseWrapped(r);
          if (!r.ok) { stats.errors++; stats.lastError = r.error; }
          send(res, 200, r);
        });
      }).catch(function (e) {
        stats.errors++;
        stats.lastError = String(e && e.message || e);
        send(res, 500, { ok: false, error: stats.lastError });
      });
      return;
    }

    send(res, 404, { ok: false, error: "not found: " + req.method + " " + pathname });
  };
}

function probe(port, cb) {
  var m = mods();
  var r = m.http.get({ host: "127.0.0.1", port: port, path: "/health", timeout: 800 }, function (res) {
    var data = "";
    res.on("data", function (c) { data += c; });
    res.on("end", function () {
      try { cb(JSON.parse(data)); } catch (e) { cb(null); }
    });
  });
  r.on("error", function () { cb(null); });
  r.on("timeout", function () { r.destroy(); cb(null); });
}

var retryTimer = null;
var stopped = false;

function listen(attempt) {
  attempt = attempt || 0;
  if (stopped) return;
  var m = mods();
  var token = ensureToken();
  var port = DEFAULT_PORT;
  var s = m.http.createServer(handle(token));
  s.on("error", function (e) {
    var code = e && e.code || String(e);
    if (attempt === 0 || attempt % 30 === 0) ctx.log("listen error: " + code + " (attempt " + attempt + ")");
    if (server === s) server = null;
    // Port busy (old instance still closing, or the other role is hosting): keep retrying from the
    // background bridge so it takes over if the panel host goes away. The panel gives up quickly.
    if (code === "EADDRINUSE" && (ctx.role === "bridge" || attempt < 5)) {
      retryTimer = setTimeout(function () { listen(attempt + 1); }, attempt < 10 ? 300 : 2000);
    }
  });
  server = s;
  s.listen(port, "127.0.0.1", function () {
    stats.startedAt = Date.now();
    writeInfo(port, token);
    ctx.log("listening on 127.0.0.1:" + port + " (v" + VERSION + ")");
  });
}

function renderPanel() {
  var doc = ctx.document;
  var el = doc && doc.getElementById("status");
  var logEl = doc && doc.getElementById("log");
  if (!el) return;
  probe(DEFAULT_PORT, function (h) {
    if (h && h.ok) {
      el.innerHTML = '<span class="ok">&#9679; Bridge running</span> on :' + h.port +
        " &middot; host: " + h.role + " &middot; evals: " + h.stats.evals +
        (h.stats.lastError ? '<br><span class="bad">last error: ' + String(h.stats.lastError).replace(/</g, "&lt;") + "</span>" : "");
    } else {
      el.innerHTML = '<span class="bad">&#9679; Bridge not running</span>';
    }
    if (logEl) logEl.textContent = ctx.ring.slice(-30).join("\n");
  });
}

exports.start = function (c) {
  ctx = c;
  if (ctx.role === "panel") {
    // If the background bridge is already serving, the panel only shows status; otherwise it hosts the bridge itself.
    probe(DEFAULT_PORT, function (h) {
      if (!(h && h.ok)) listen();
    });
    statusTimer = setInterval(renderPanel, 1500);
    renderPanel();
  } else {
    listen();
  }
};

exports.stop = function () {
  stopped = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  if (server) {
    try { server.close(); } catch (e) {}
    server = null;
  }
};
