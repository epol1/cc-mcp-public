// pr-cut UXP bridge for Premiere Pro: long-polls the pr-cut CEP hub (UXP plugins can't listen on a socket) and runs
// each job as the body of an async function with `ppro` (require("premierepro")), `uxp` and `fs` in scope.
// The returned value is JSON-encoded back to the hub. Keep this file small: it can only be reloaded from the
// UXP Developer Tool.
const VERSION = "0.1.0";
const ppro = require("premierepro");
const uxp = require("uxp");
const fs = require("fs");
const os = require("os");

const statusEl = document.getElementById("status");
const lastEl = document.getElementById("last");
let info = null;
let jobs = 0;

function readInfo() {
  try {
    const home = os.homedir ? os.homedir() : "";
    const raw = fs.readFileSync(home + "/.ae-compose/bridge-pr.json", { encoding: "utf-8" });
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function show(ok, text) {
  statusEl.innerHTML = '<span class="' + (ok ? "ok" : "bad") + '">&#9679;</span> ' + text;
}

// Plain values go back as they are; Premiere DOM objects become their enumerable fields.
function safe(v, depth) {
  depth = depth || 0;
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (depth > 4) return String(v);
  if (Array.isArray(v)) return v.map((x) => safe(x, depth + 1));
  if (t === "object") {
    const o = {};
    for (const k of Object.keys(v)) { try { o[k] = safe(v[k], depth + 1); } catch (e) { o[k] = "<" + e.message + ">"; } }
    return o;
  }
  return String(v);
}

async function run(job) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("ppro", "uxp", "fs", job.script);
  return safe(await fn(ppro, uxp, fs));
}

async function post(path, body) {
  return fetch("http://127.0.0.1:" + info.port + path, {
    method: "POST",
    headers: { "x-aec-token": info.token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loop() {
  for (;;) {
    info = readInfo();
    if (!info) { show(false, "no ~/.ae-compose/bridge-pr.json (is the pr-cut CEP bridge running?)"); await sleep(3000); continue; }
    let job = null;
    try {
      const r = await fetch("http://127.0.0.1:" + info.port + "/uxp/next?wait=20000&v=" + VERSION, { headers: { "x-aec-token": info.token } });
      if (r.status === 200) job = await r.json();
      show(true, "connected to :" + info.port + " · " + jobs + " jobs");
    } catch (e) {
      show(false, "hub unreachable: " + e.message);
      await sleep(2000);
      continue;
    }
    if (!job || !job.id) continue;
    jobs++;
    try {
      const result = await run(job);
      await post("/uxp/result", { id: job.id, ok: true, result: result === undefined ? null : result });
      lastEl.textContent = "job " + job.id + " ok";
    } catch (e) {
      await post("/uxp/result", { id: job.id, ok: false, error: String(e && e.message || e), errorName: e && e.name, stack: e && e.stack });
      lastEl.textContent = "job " + job.id + " failed: " + (e && e.message);
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

loop();
