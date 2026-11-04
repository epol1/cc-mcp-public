/*
 * ae-compose CEP loader. Deliberately tiny and defensive: it must never need editing,
 * because a broken loader can only be fixed by restarting After Effects.
 *
 * It polls server.js for changes and hot-swaps it (stop old -> clear require cache -> start new),
 * so all bridge behavior can be developed without restarting AE.
 */
(function () {
  var req = (typeof require === "function") ? require : (window.cep_node && window.cep_node.require);
  var role = window.AEC_ROLE || "bridge";
  var cep = window.__adobe_cep__;
  if (!req || !cep) {
    document.title = "ae-compose: Node or CEP API unavailable";
    return;
  }
  var fs = req("fs");
  var path = req("path");
  var os = req("os");

  function extensionDir() {
    var p = cep.getSystemPath("extension") || "";
    p = decodeURIComponent(p.replace(/^file:\/+/, ""));
    if (/^[A-Za-z]:/.test(p) === false && p.charAt(0) !== "/") p = "/" + p;
    return path.normalize(p);
  }

  var extDir = extensionDir();
  var serverPath = path.join(extDir, "server.js");
  var logDir = path.join(os.homedir(), ".ae-compose", "logs");
  var ring = [];

  function log(msg) {
    var line = new Date().toISOString() + " [" + role + "] " + msg;
    ring.push(line);
    if (ring.length > 400) ring.shift();
    try { console.log(line); } catch (e) {}
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, "bridge-" + role + ".log"), line + "\n");
    } catch (e) {}
  }

  var current = null;
  var lastMtime = -1;

  function load() {
    if (current && typeof current.stop === "function") {
      try { current.stop(); } catch (e) { log("stop failed: " + (e && e.stack || e)); }
    }
    current = null;
    try {
      var resolved = req.resolve(serverPath);
      delete req.cache[resolved];
      var mod = req(resolved);
      current = mod;
      mod.start({
        role: role,
        cep: cep,
        window: window,
        document: document,
        require: req,
        log: log,
        ring: ring,
        extDir: extDir,
        reloadAll: function () { window.location.reload(); }
      });
      log("server.js loaded (" + serverPath + ")");
    } catch (e) {
      log("server.js load failed: " + (e && e.stack || e));
    }
  }

  function poll() {
    fs.stat(serverPath, function (err, st) {
      if (err) return;
      var m = st.mtimeMs || +st.mtime;
      if (m !== lastMtime) {
        lastMtime = m;
        load();
      }
    });
  }

  log("loader start, extDir=" + extDir);
  poll();
  setInterval(poll, 1000);
})();
