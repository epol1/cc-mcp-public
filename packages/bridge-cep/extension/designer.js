/*
 * ae-compose designer panel (TOOLKIT §7): the human side of the toolkit, inside AE.
 *  - Controls: the active comp's ae-compose controls grouped by rig (rig effects and expression controls), editable.
 *  - Lint: the latest lint + style-lint issues for the comp (written by builds, edits and lint_comp), jump to time.
 *  - Variants: the scene's sibling comps (variants, Compare, reframes), opened with one click.
 *  - Recipes: the recipe library (recipes/ in the repo), with how to instantiate one.
 *  - Ask: a message to the Claude session (queued in ~/.ae-compose/inbox.jsonl; the agent reads it with designer_inbox).
 * Plain ES5 in the panel's browser context; AE is queried with evalScript and small self-contained ExtendScripts
 * (nested ?: must be parenthesized there: ExtendScript's conditional operator is left-associative, D82).
 * Editing this file reloads the open panel (server.js watches it).
 */
(function () {
  var cep = window.__adobe_cep__;
  var req = (typeof require === "function") ? require : (window.cep_node && window.cep_node.require);
  var fs = req && req("fs"), path = req && req("path"), os = req && req("os");
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var HOME = os ? os.homedir() : "";
  var LINT_DIR = path ? path.join(HOME, ".ae-compose", "out", "_lint") : "";
  var INBOX = path ? path.join(HOME, ".ae-compose", "inbox.jsonl") : "";
  var state = null;

  function extDir() {
    var p = decodeURIComponent((cep.getSystemPath("extension") || "").replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p) && p.charAt(0) !== "/") p = "/" + p;
    return path.normalize(p);
  }
  var REPO = path ? path.resolve(extDir(), "..", "..", "..") : "";

  function evalAE(code, cb) { cep.evalScript(code, function (r) { cb && cb(r); }); }

  // ---- ExtendScript snippets (ES3; tiny JSON writer because ExtendScript has no JSON) ----
  var J = "function J(v){if(v===null||v===undefined)return'null';var t=typeof v;if(t==='number')return isFinite(v)?String(Math.round(v*10000)/10000):'null';if(t==='boolean')return v?'true':'false';if(t==='string')return '\"'+v.replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"').replace(/[\\r\\n]/g,' ')+'\"';if(v instanceof Array){var a=[];for(var i=0;i<v.length;i++)a.push(J(v[i]));return '['+a.join(',')+']';}var o=[];for(var k in v)if(v.hasOwnProperty(k))o.push(J(k)+':'+J(v[k]));return '{'+o.join(',')+'}';}";
  var STATE = J + "(function(){var c=app.project.activeItem;if(!(c instanceof CompItem))return J({comp:null});" +
    "var CTL={'ADBE Slider Control':1,'ADBE Color Control':1,'ADBE Checkbox Control':1,'ADBE Point Control':1,'ADBE Angle Control':1,'ADBE Dropdown Control':1};" +
    "var rigs=[];for(var i=1;i<=c.numLayers;i++){var L=c.layer(i);if(String(L.comment).indexOf(';clone')>=0)continue;var fx=L.property('ADBE Effect Parade');if(!fx)continue;" +
    "for(var k=1;k<=fx.numProperties;k++){var e=fx.property(k),mn=e.matchName,ps=[];if(mn.indexOf('Pseudo/')!==0&&!CTL[mn])continue;var n=mn.indexOf('Pseudo/')===0?e.numProperties:1;" +
    "for(var j=1;j<=n;j++){var p=e.property(j);if(p.propertyType!==PropertyType.PROPERTY)continue;var vt=p.propertyValueType;if(vt===PropertyValueType.NO_VALUE){ps.push({i:j,name:p.name,group:true});continue;}" +
    "if(p.matchName==='ADBE Effect Built In Params'||vt===PropertyValueType.CUSTOM_VALUE||vt===PropertyValueType.LAYER_INDEX)continue;" +
    "var kind=vt===PropertyValueType.COLOR?'color':((vt===PropertyValueType.TwoD_SPATIAL||vt===PropertyValueType.TwoD)?'point':'number');var v=p.value;" +
    "ps.push({i:j,name:mn.indexOf('Pseudo/')===0?p.name:e.name,kind:kind,value:kind==='number'?v:[v[0],v[1],v.length>2?v[2]:0],keyed:p.numKeys>0,expr:p.expressionEnabled&&p.expression!==''});}" +
    "rigs.push({layer:L.name,li:i,effect:e.name,fi:k,rig:mn.indexOf('Pseudo/')===0,params:ps});}}" +
    "var sib=[],f=c.parentFolder,base=c.name.replace(/_v\\d+.*$/,'');for(var m=1;m<=f.numItems;m++){var it=f.item(m);if(it instanceof CompItem&&it.name.indexOf(base)===0)sib.push(it.name);}" +
    "var sel=[];for(var s=0;s<c.selectedLayers.length;s++)sel.push(c.selectedLayers[s].name);" +
    "return J({comp:c.name,id:c.id,time:c.time,dur:c.duration,fps:c.frameRate,rigs:rigs,siblings:sib,selected:sel});})()";
  function setScript(li, fi, pi, v) {
    return "(function(){var c=app.project.activeItem;app.beginUndoGroup('ae-compose panel: set');try{var p=c.layer(" + li + ").property('ADBE Effect Parade').property(" + fi + ").property(" + pi + ");p.setValue(" + JSON.stringify(v) + ");}finally{app.endUndoGroup();}return 'ok';})()";
  }
  function gotoScript(comp, t) {
    return "(function(){for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i);if(it instanceof CompItem&&it.name===" + JSON.stringify(comp) + "){it.openInViewer();" + (t === undefined ? "" : "it.time=" + t + ";") + "return 'ok';}}return 'missing';})()";
  }

  // ---- views ----
  function rgbHex(c) { var h = function (x) { var s = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16); return s.length < 2 ? "0" + s : s; }; return "#" + h(c[0]) + h(c[1]) + h(c[2]); }
  function hexRgb(h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255, 1]; }

  function renderControls() {
    var el = $("controls");
    if (!state || !state.comp) { el.innerHTML = '<p class="dim">Open a comp to see its controls.</p>'; return; }
    if (!state.rigs.length) { el.innerHTML = '<p class="dim">No ae-compose controls in “' + esc(state.comp) + '”.</p>'; return; }
    var html = "";
    for (var r = 0; r < state.rigs.length; r++) {
      var R = state.rigs[r];
      html += '<div class="rig"><div class="rig-h">' + esc(R.effect) + ' <span class="dim">on ' + esc(R.layer) + "</span></div>";
      for (var p = 0; p < R.params.length; p++) {
        var P = R.params[p], id = "p_" + r + "_" + p;
        if (P.group) { html += '<div class="grp">' + esc(P.name) + "</div>"; continue; }
        var lock = P.keyed || P.expr ? ' disabled title="keyed or driven by an expression"' : "";
        var input = P.kind === "color" ? '<input type="color" id="' + id + '" value="' + rgbHex(P.value) + '"' + lock + ">"
          : P.kind === "point" ? '<input id="' + id + '" value="' + P.value[0] + ", " + P.value[1] + '"' + lock + ">"
          : '<input type="number" step="any" id="' + id + '" value="' + P.value + '"' + lock + ">";
        html += '<label class="row"><span>' + esc(P.name) + "</span>" + input + "</label>";
      }
      html += "</div>";
    }
    el.innerHTML = html;
    for (var r2 = 0; r2 < state.rigs.length; r2++) for (var p2 = 0; p2 < state.rigs[r2].params.length; p2++) (function (R, P, el2) {
      if (!el2) return;
      el2.onchange = function () {
        var v = P.kind === "color" ? hexRgb(el2.value) : P.kind === "point" ? el2.value.split(",").map(Number) : Number(el2.value);
        evalAE(setScript(R.li, R.fi, P.i, v), function () { setStatus("set " + R.effect + " › " + P.name); });
      };
    })(state.rigs[r2], state.rigs[r2].params[p2], $("p_" + r2 + "_" + p2));
  }

  function renderLint() {
    var el = $("lint");
    if (!state || !state.comp) { el.innerHTML = ""; return; }
    var f = path.join(LINT_DIR, state.comp.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) + ".json");
    var data = null;
    try { data = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
    if (!data) { el.innerHTML = '<p class="dim">No lint yet: build, edit or run lint_comp on this comp.</p>'; return; }
    if (!data.issues.length) { el.innerHTML = '<p class="ok">Clean (' + esc(data.at.slice(0, 16).replace("T", " ")) + ")</p>"; return; }
    var html = '<p class="dim">' + data.issues.length + " issue(s), " + esc(data.at.slice(0, 16).replace("T", " ")) + "</p>";
    data.issues.sort(function (a, b) { return (a.severity === "warn" ? 0 : 1) - (b.severity === "warn" ? 0 : 1); });
    for (var i = 0; i < data.issues.length; i++) {
      var I = data.issues[i];
      html += '<div class="issue ' + (I.severity === "warn" ? "warn" : "note") + '" data-t="' + (I.t ? I.t[0] : "") + '"><b>' + esc(I.rule) + "</b> " + esc(I.message) + (I.t ? ' <span class="jump">↦ ' + I.t[0].toFixed(2) + "s</span>" : "") + "</div>";
    }
    el.innerHTML = html;
    var items = el.querySelectorAll(".issue");
    for (var k = 0; k < items.length; k++) items[k].onclick = function () { var t = this.getAttribute("data-t"); if (t !== "") evalAE(gotoScript(state.comp, Number(t))); };
  }

  function renderVariants() {
    var el = $("variants");
    if (!state || !state.siblings) { el.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < state.siblings.length; i++) html += '<button class="comp' + (state.siblings[i] === state.comp ? " cur" : "") + '">' + esc(state.siblings[i]) + "</button>";
    el.innerHTML = html || '<p class="dim">No sibling comps.</p>';
    var bs = el.querySelectorAll("button");
    for (var k = 0; k < bs.length; k++) bs[k].onclick = function () { evalAE(gotoScript(this.textContent), refresh); };
  }

  function renderRecipes() {
    var el = $("recipes"), dir = path.join(REPO, "recipes"), list = [];
    try { fs.readdirSync(dir).forEach(function (d) { try { list.push(JSON.parse(fs.readFileSync(path.join(dir, d, "recipe.json"), "utf8"))); } catch (e) {} }); } catch (e) {}
    if (!list.length) { el.innerHTML = '<p class="dim">No recipes in ' + esc(dir) + "</p>"; return; }
    var html = "";
    for (var i = 0; i < list.length; i++) html += '<div class="recipe"><b>' + esc(list[i].name) + "</b> <span class=\"dim\">" + esc((list[i].tags || []).join(", ")) + "</span><br>" + esc(list[i].intent || "") + "</div>";
    el.innerHTML = html + '<p class="dim">Ask Claude: “make another like &lt;recipe&gt; for …” (instantiate_recipe).</p>';
  }

  function sendAsk() {
    var text = $("ask-text").value.trim();
    if (!text) return;
    var msg = { id: String(Date.now()), at: new Date().toISOString(), text: text, comp: state && state.comp, time: state && state.time, layers: state && state.selected };
    try { fs.mkdirSync(path.dirname(INBOX), { recursive: true }); fs.appendFileSync(INBOX, JSON.stringify(msg) + "\n"); $("ask-text").value = ""; setStatus("sent to Claude (designer_inbox)"); }
    catch (e) { setStatus("could not queue the message: " + e.message); }
  }

  function setStatus(s) { var el = $("dstatus"); if (el) el.textContent = s; }
  function show(tab) {
    var tabs = ["controls", "lint", "variants", "recipes", "ask"];
    for (var i = 0; i < tabs.length; i++) { $(tabs[i]).style.display = tabs[i] === tab ? "block" : "none"; $("t-" + tabs[i]).className = tabs[i] === tab ? "on" : ""; }
  }
  function refresh() {
    evalAE(STATE, function (r) {
      try { state = JSON.parse(r); } catch (e) { state = null; setStatus("AE did not answer (" + String(r).slice(0, 60) + ")"); return; }
      $("comp").textContent = state.comp ? state.comp : "no comp open";
      // Don't redraw the controls under a field the designer is editing.
      var a = document.activeElement;
      if (!(a && a.tagName === "INPUT" && $("controls").contains(a))) renderControls();
      renderLint(); renderVariants(); renderRecipes();
    });
  }

  window.AECDesigner = { refresh: refresh, show: show, sendAsk: sendAsk, _state: function () { return state; }, _scripts: { STATE: STATE, setScript: setScript, gotoScript: gotoScript } };
  document.addEventListener("DOMContentLoaded", function () {
    var tabs = ["controls", "lint", "variants", "recipes", "ask"];
    for (var i = 0; i < tabs.length; i++) (function (t) { $("t-" + t).onclick = function () { show(t); }; })(tabs[i]);
    $("refresh").onclick = refresh;
    $("ask-send").onclick = sendAsk;
    show("controls");
    refresh();
    setInterval(function () { if (document.visibilityState !== "hidden") refresh(); }, 4000);
  });
})();
