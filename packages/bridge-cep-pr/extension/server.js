"use strict";
/*
 * pr-cut CEP bridge server for Premiere Pro (hot-reloaded by loader.js on every save).
 * Same design as the ae-compose bridge (packages/bridge-cep): HTTP on 127.0.0.1 only, a token in
 * ~/.ae-compose/bridge-pr.json on every mutating endpoint, and no browser origins.
 *
 * It is also the hub for the pr-cut UXP plugin: UXP plugins cannot listen on a socket, so the plugin
 * long-polls /uxp/next for jobs and posts answers to /uxp/result.
 *
 *   GET  /health                         -> { ok, name, version, role, pid, port, uptimeMs, stats, uxp }
 *   POST /eval      {script, timeoutMs?}  -> ExtendScript in Premiere: { ok, result } | { ok:false, error, timedOut? }
 *   POST /uxp/eval  {script, timeoutMs?}  -> JS in the UXP plugin (async function body): { ok, result } | { ok:false, error }
 *   GET  /uxp/next?wait=ms                -> (plugin) next job { id, script, timeoutMs } or 204
 *   POST /uxp/result {id, ok, result?, error?} -> (plugin) answer for a job
 *   POST /reload                          -> reloads the whole CEP page (loader + server)
 *   GET  /log?n=200                       -> recent log lines
 */
var VERSION = "0.1.0";
var DEFAULT_PORT = 47812;
var MAX_BODY = 256 * 1024 * 1024;

var ctx = null;
var server = null;
var statusTimer = null;
var stats = { startedAt: 0, requests: 0, evals: 0, uxpEvals: 0, errors: 0, timeouts: 0, lastError: null, lastEvalMs: 0 };
var chain = null;

// UXP job queue: jobs wait here until the plugin polls; waiting polls park in `pollers`.
var uxp = { queue: [], pending: {}, pollers: [], lastPollAt: 0, nextId: 1, pluginVersion: null };

function mods() {
  var r = ctx.require;
  return { http: r("http"), fs: r("fs"), path: r("path"), os: r("os"), crypto: r("crypto") };
}

function configDir() {
  var m = mods();
  return m.path.join(m.os.homedir(), ".ae-compose");
}

function infoPath() {
  return mods().path.join(configDir(), "bridge-pr.json");
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
    name: "pr-cut-bridge",
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

// Syntax errors in evalScript'd code can raise modal alerts, so user code is passed as a string
// literal and run through eval() inside try/catch (same as the AE bridge).
var ERR_MARK = "\u0001PRC_ERR\u0001";

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
        resolve({ ok: false, error: "timeout after " + timeoutMs + "ms (Premiere busy or a modal dialog is open)", timedOut: true });
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

// ---- UXP hub ----

function uxpConnected() {
  return Date.now() - uxp.lastPollAt < 35000 || uxp.pollers.length > 0;
}

function uxpDispatch() {
  while (uxp.queue.length && uxp.pollers.length) {
    var job = uxp.queue.shift();
    var poller = uxp.pollers.shift();
    clearTimeout(poller.timer);
    poller.send(job);
  }
}

function uxpEval(script, timeoutMs) {
  return new Promise(function (resolve) {
    var id = uxp.nextId++;
    var t0 = Date.now();
    stats.uxpEvals++;
    var timer = setTimeout(function () {
      if (!uxp.pending[id]) return;
      delete uxp.pending[id];
      uxp.queue = uxp.queue.filter(function (j) { return j.id !== id; });
      stats.timeouts++;
      resolve({ ok: false, timedOut: true, error: uxpConnected()
        ? "timeout after " + timeoutMs + "ms (Premiere busy or a modal dialog is open)"
        : "the pr-cut UXP plugin is not connected (is it loaded in Premiere?)" });
    }, timeoutMs);
    uxp.pending[id] = function (r) {
      clearTimeout(timer);
      delete uxp.pending[id];
      r.ms = Date.now() - t0;
      resolve(r);
    };
    uxp.queue.push({ id: id, script: script, timeoutMs: timeoutMs });
    uxpDispatch();
  });
}

function send(res, code, obj) {
  if (code === 204) { res.writeHead(204, { "Cache-Control": "no-store" }); return res.end(); }
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

function readJson(req, res, cb) {
  readBody(req).then(function (raw) {
    var body;
    try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { ok: false, error: "invalid JSON body" }); }
    cb(body);
  }).catch(function (e) {
    stats.errors++;
    stats.lastError = String(e && e.message || e);
    send(res, 500, { ok: false, error: stats.lastError });
  });
}

function handle(token) {
  return function (req, res) {
    stats.requests++;
    var url = req.url || "/";
    var q = url.indexOf("?");
    var pathname = q >= 0 ? url.slice(0, q) : url;
    var query = q >= 0 ? url.slice(q + 1) : "";
    var fromPlugin = pathname.indexOf("/uxp/next") === 0 || pathname.indexOf("/uxp/result") === 0;
    // UXP's fetch may send an Origin; the plugin endpoints still need the token, which no web page can read.
    if (req.headers.origin && !fromPlugin) return send(res, 403, { ok: false, error: "browser origins are not allowed" });

    if (req.method === "GET" && pathname === "/health") {
      return send(res, 200, {
        ok: true, name: "pr-cut-bridge", version: VERSION, role: ctx.role, pid: process.pid,
        port: server && server.address() && server.address().port,
        uptimeMs: Date.now() - stats.startedAt, stats: stats,
        uxp: { connected: uxpConnected(), lastPollAgoMs: uxp.lastPollAt ? Date.now() - uxp.lastPollAt : null, queued: uxp.queue.length, pluginVersion: uxp.pluginVersion }
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
      return readJson(req, res, function (body) {
        if (typeof body.script !== "string") return send(res, 400, { ok: false, error: "script must be a string" });
        var timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : 120000;
        var raw = body.raw === true;
        evalScript(raw ? body.script : wrapScript(body.script), timeoutMs).then(function (r) {
          if (!raw) r = parseWrapped(r);
          if (!r.ok) { stats.errors++; stats.lastError = r.error; }
          send(res, 200, r);
        });
      });
    }

    if (req.method === "POST" && pathname === "/uxp/eval") {
      return readJson(req, res, function (body) {
        if (typeof body.script !== "string") return send(res, 400, { ok: false, error: "script must be a string" });
        var timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : 120000;
        uxpEval(body.script, timeoutMs).then(function (r) {
          if (!r.ok) { stats.errors++; stats.lastError = r.error; }
          send(res, 200, r);
        });
      });
    }

    if (req.method === "GET" && pathname === "/uxp/next") {
      uxp.lastPollAt = Date.now();
      var vm = /(?:^|&)v=([^&]+)/.exec(query);
      if (vm) uxp.pluginVersion = decodeURIComponent(vm[1]);
      var wm = /(?:^|&)wait=(\d+)/.exec(query);
      var wait = Math.min(wm ? parseInt(wm[1], 10) : 20000, 30000);
      if (uxp.queue.length) return send(res, 200, uxp.queue.shift());
      var poller = { send: function (job) { send(res, 200, job); } };
      poller.timer = setTimeout(function () {
        uxp.pollers = uxp.pollers.filter(function (p) { return p !== poller; });
        uxp.lastPollAt = Date.now();
        send(res, 204);
      }, wait);
      req.on("close", function () {
        clearTimeout(poller.timer);
        uxp.pollers = uxp.pollers.filter(function (p) { return p !== poller; });
      });
      uxp.pollers.push(poller);
      return;
    }

    if (req.method === "POST" && pathname === "/uxp/result") {
      return readJson(req, res, function (body) {
        uxp.lastPollAt = Date.now();
        var done = uxp.pending[body.id];
        if (done) done({ ok: !!body.ok, result: body.result, error: body.error, errorName: body.errorName, stack: body.stack });
        send(res, 200, { ok: true, known: !!done });
      });
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
        " &middot; host: " + h.role + " &middot; evals: " + h.stats.evals + " &middot; UXP: " + (h.uxp && h.uxp.connected ? "connected" : "not connected") +
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
  uxp.pollers.forEach(function (p) { clearTimeout(p.timer); try { p.send(null); } catch (e) {} });
  uxp.pollers = [];
  if (server) {
    try { server.close(); } catch (e) {}
    server = null;
  }
};
