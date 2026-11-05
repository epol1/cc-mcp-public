{
  "version": "1.0.0",

  "clamp": function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
  "lerp": function (a, b, t) { return a + (b - a) * t; },
  "remap": function (v, a, b, c, d) { var t = (v - a) / ((b - a) || 1e-9); return c + (d - c) * this.clamp(t, 0, 1); },
  "smooth": function (e0, e1, x) { var t = this.clamp((x - e0) / ((e1 - e0) || 1e-9), 0, 1); return t * t * (3 - 2 * t); },
  "step": function (v, size) { return size > 0 ? Math.round(v / size) * size : v; },
  "wrap": function (v, lo, hi) { var r = hi - lo; if (r <= 0) return lo; var m = (v - lo) % r; return (m < 0 ? m + r : m) + lo; },
  "mixv": function (a, b, t) { var o = []; for (var i = 0; i < a.length; i++) o[i] = a[i] + ((b[i] === undefined ? a[i] : b[i]) - a[i]) * t; return o; },

  "hash": function (i, k) { var x = Math.sin(i * 127.1 + (k || 0) * 311.7 + 74.7) * 43758.5453123; return x - Math.floor(x); },
  "rand": function (i, k, lo, hi) { return lo + (hi - lo) * this.hash(i, k); },
  "srand": function (i, k) { return this.hash(i, k) * 2 - 1; },
  "pick": function (list, i, seed) { return list[Math.floor(this.hash(i, seed) * list.length) % list.length]; },
  "noise1": function (x, seed) { var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return this.lerp(this.srand(i, seed), this.srand(i + 1, seed), u); },
  "noise2": function (x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var h = function (a, b) { var q = Math.sin(a * 127.1 + b * 269.5 + (seed || 0) * 419.2) * 43758.5453; return (q - Math.floor(q)) * 2 - 1; };
    var a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
  },

  "bezier": function (x1, y1, x2, y2, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var u = x, i, cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    for (i = 0; i < 8; i++) { var xu = ((ax * u + bx) * u + cx) * u - x, d = (3 * ax * u + 2 * bx) * u + cx; if (Math.abs(xu) < 1e-6 || Math.abs(d) < 1e-6) break; u -= xu / d; }
    var lo = 0, hi = 1;
    if (Math.abs(((ax * u + bx) * u + cx) * u - x) > 1e-4) { for (i = 0; i < 30; i++) { u = (lo + hi) / 2; if (((ax * u + bx) * u + cx) * u < x) lo = u; else hi = u; } }
    return ((ay * u + by) * u + cy) * u;
  },
  "eased": function (b, t) { return b ? this.bezier(b[0], b[1], b[2], b[3], t) : this.clamp(t, 0, 1); },
  "tween": function (t, t0, dur, from, to, b) { var p = this.eased(b, (t - t0) / (dur || 1e-9)); return typeof from === "number" ? from + (to - from) * p : this.mixv(from, to, p); },
  "spring": function (t, fps, c, k, m) {
    var f = t * fps; if (f <= 0) return 0;
    var st = Math.min(1000 / fps, 64), w = Math.floor(f), s = (w * st + Math.min((f - w) * 1000 / fps, 64)) / 1000;
    var z = c / (2 * Math.sqrt(k * m)), w0 = Math.sqrt(k / m);
    if (z < 1) { var w1 = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * s) * (Math.cos(w1 * s) + (z * w0 / w1) * Math.sin(w1 * s)); }
    return 1 - Math.exp(-w0 * s) * (1 + w0 * s);
  },
  "overshoot": function (t, amp, freq, decay) { if (t <= 0) return 0; return amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t); },
  "inertia": function (v, t, freq, decay) { if (t <= 0) return 0; var w = freq * 2 * Math.PI; return v * Math.sin(w * t) / Math.exp(decay * t) / w; },
  "bounce": function (t, height, gravity, elasticity, maxBounces) {
    var g = gravity || 4000, e = elasticity || 0.6, v = Math.sqrt(2 * g * height), first = v / g, tt = t, n = 0;
    if (t <= 0) return height;
    if (tt < first) return height - g * tt * tt / 2;
    tt -= first; v *= e;
    while (n < (maxBounces || 6)) { var seg = 2 * v / g; if (tt < seg) return v * tt - g * tt * tt / 2; tt -= seg; v *= e; n++; }
    return 0;
  },
  "follow": function (t, i, lag) { return t - i * lag; },

  "stagger": function (i, n, each, order, seed) {
    var c = (n - 1) / 2, k;
    if (order === 1) k = n - 1 - i; else if (order === 2) k = Math.abs(i - c); else if (order === 3) k = c - Math.abs(i - c);
    else if (order === 4) k = this.hash(i, seed || 7) * (n - 1); else k = i;
    return k * each;
  },
  "cascade": function (d, speed) { return speed > 0 ? d / speed : 0; },

  "line": function (i, n, spacing, angle, center) {
    var a = (angle || 0) * Math.PI / 180, o = (center === false ? i : i - (n - 1) / 2) * spacing;
    return [Math.cos(a) * o, Math.sin(a) * o];
  },
  "grid": function (i, n, cols, gapX, gapY) {
    cols = Math.max(1, Math.round(cols)); var rows = Math.ceil(n / cols), c = i % cols, r = Math.floor(i / cols);
    return [(c - (cols - 1) / 2) * gapX, (r - (rows - 1) / 2) * gapY];
  },
  "circle": function (i, n, radius, start, arc) {
    var full = arc === undefined || arc >= 360, span = full ? 360 : arc, k = full ? n : Math.max(1, n - 1);
    var a = ((start || 0) - 90 + span * i / k) * Math.PI / 180;
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  },
  "circleAngle": function (i, n, start, arc) { var full = arc === undefined || arc >= 360, span = full ? 360 : arc, k = full ? n : Math.max(1, n - 1); return (start || 0) + span * i / k; },
  "scatter": function (i, n, w, h, seed, jitter) {
    var cols = Math.max(1, Math.round(Math.sqrt(n * w / (h || 1)))), rows = Math.ceil(n / cols), j = jitter === undefined ? 0.8 : jitter;
    var cell = n > 1 ? (i * 7919 + Math.floor(this.hash(seed || 1, 3) * n)) % n : 0, c = cell % cols, r = Math.floor(cell / cols), cw = w / cols, ch = h / rows;
    return [(c + 0.5 + this.srand(i, seed) * j * 0.5) * cw - w / 2, (r + 0.5 + this.srand(i, (seed || 1) + 91) * j * 0.5) * ch - h / 2];
  },
  "sphere": function (i, n, radius) {
    var y = n > 1 ? 1 - 2 * i / (n - 1) : 0, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius];
  },
  "helix": function (i, n, radius, height, turns) {
    var u = n > 1 ? i / (n - 1) : 0, a = u * (turns || 2) * 2 * Math.PI;
    return [Math.cos(a) * radius, (u - 0.5) * height, Math.sin(a) * radius];
  },
  "onPath": function (path, u, closed) { var v = closed ? this.wrap(u, 0, 1) : this.clamp(u, 0, 1); return path.pointOnPath(v); },
  "pathAngle": function (path, u, closed) { var v = closed ? this.wrap(u, 0, 1) : this.clamp(u, 0, 1), d = path.tangentOnPath(v); return Math.atan2(d[1], d[0]) * 180 / Math.PI; },

  "falloff": function (d, radius, softness) { var s = Math.max(softness, 1e-6); return 1 - this.smooth(radius - s / 2, radius + s / 2, d); },
  "radial": function (p, c, radius, softness) { var dx = p[0] - c[0], dy = p[1] - c[1], dz = (p[2] || 0) - (c[2] || 0); return this.falloff(Math.sqrt(dx * dx + dy * dy + dz * dz), radius, softness); },
  "box": function (p, c, size, softness) { var dx = Math.max(Math.abs(p[0] - c[0]) - size[0] / 2, 0), dy = Math.max(Math.abs(p[1] - c[1]) - size[1] / 2, 0); return 1 - this.smooth(0, Math.max(softness, 1e-6), Math.sqrt(dx * dx + dy * dy)); },
  "linear": function (p, c, angle, width) { var a = (angle || 0) * Math.PI / 180, d = (p[0] - c[0]) * Math.cos(a) + (p[1] - c[1]) * Math.sin(a); return this.clamp(0.5 - d / (width || 1), 0, 1); },

  "hsl": function (h, s, l, a) {
    h = ((h % 360) + 360) % 360 / 360; s = this.clamp(s, 0, 1); l = this.clamp(l, 0, 1);
    var f = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    if (s === 0) return [l, l, l, a === undefined ? 1 : a];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3), a === undefined ? 1 : a];
  },
  "toHsl": function (c) {
    var r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d > 1e-9) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return [h, s, l, c[3] === undefined ? 1 : c[3]];
  },
  "shade": function (c, dh, ds, dl) { var x = this.toHsl(c); return this.hsl(x[0] + (dh || 0), x[1] + (ds || 0), x[2] + (dl || 0), x[3]); },
  "hex": function (s) { var h = String(s).replace("#", ""); if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255, 1]; },
  "palette": function (list, i) { return list[((Math.floor(i) % list.length) + list.length) % list.length]; },
  "gradient": function (list, t) { var n = list.length - 1, x = this.clamp(t, 0, 1) * n, k = Math.min(Math.floor(x), n - 1); return n < 1 ? list[0] : this.mixv(list[k], list[k + 1], x - k); },

  "pulse": function (t, starts, len) { for (var i = 0; i < starts.length; i++) if (t >= starts[i] && t < starts[i] + len) return 1; return 0; },
  "since": function (t, starts) { var best = -1; for (var i = 0; i < starts.length; i++) if (starts[i] <= t && starts[i] > best) best = starts[i]; return best < 0 ? -1 : t - best; },

  "pad": function (n, digits) { var s = String(Math.abs(Math.round(n))); while (s.length < digits) s = "0" + s; return (n < 0 ? "-" : "") + s; },
  "num": function (v, decimals, sep, dec) {
    var d = decimals || 0, neg = v < 0, x = Math.abs(v).toFixed(d), parts = x.split("."), ip = parts[0], out = "";
    for (var i = 0; i < ip.length; i++) { if (i > 0 && (ip.length - i) % 3 === 0) out += (sep === undefined ? "," : sep); out += ip.charAt(i); }
    return (neg ? "-" : "") + out + (d > 0 ? (dec || ".") + parts[1] : "");
  },
  "scramble": function (text, p, seed, t, chars) {
    var cs = chars || "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*", n = text.length, done = Math.floor(this.clamp(p, 0, 1) * n), out = "", tick = Math.floor(t * 20);
    for (var i = 0; i < n; i++) { var ch = text.charAt(i); out += (i < done || ch === " ") ? ch : cs.charAt(Math.floor(this.hash(i + tick * 31, seed) * cs.length)); }
    return out;
  },
  "typed": function (text, p, caret, t, blink) {
    var n = Math.floor(this.clamp(p, 0, 1) * text.length), on = !blink || Math.floor(t * blink * 2) % 2 === 0;
    return text.substr(0, n) + (caret && (p < 1 || on) ? caret : "");
  }
}
