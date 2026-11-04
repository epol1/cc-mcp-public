# Toolchain research: TS/TSX to ExtendScript (ES3) for After Effects 26.5

Phase 1 research, 2026-11-04. Scope: how to compile the ae-compose TypeScript runtime library and the
compiler's generated code into ES3 that runs in AE 26.5's ExtendScript engine (`typeof JSON === "undefined"`, D11).

**How claims are marked**

| Tag | Meaning |
|---|---|
| **[lab]** | Run on this machine (Node 22.20.0, Windows 11) in a scratch directory. Nothing was installed in the repo and nothing was run in After Effects. "Runs" means it ran in a Node `vm` context with the ES5+ built-ins deleted, which approximates ES3 but is **not** ExtendScript. |
| **[docs]** | Read in official docs, package source or the npm registry. |
| **[community]** | Forum threads or GitHub issues. |
| **[unverified]** | Could not be verified. Each one has a probe listed in section 6.7. |

Versions are the `latest` npm dist-tags as of 2026-11-04 unless stated otherwise.

---

## 1. Hyper Brew Bolt CEP: how its ExtendScript build works

Packages: `bolt-cep@2.2.3`, `vite-cep-plugin@2.2.3` and `create-bolt-cep@2.2.3`, all published 2026-06-28 under the MIT license [docs].
Source: `github.com/hyperbrew/bolt-cep`, commit `771157b` (2026-06-28). Files read: `vite.es.config.ts`, `vite-cep-plugin/src/index.ts`, `src/jsx/**`, `package.json`.

### 1.1 Pipeline [docs]
`vite.config.ts` calls `extendscriptConfig("src/jsx/index.ts", "dist/cep/jsx/index.js", …)`. That function runs **Rollup 4 directly**, outside Vite, with these plugins:

```ts
// bolt-cep/vite.es.config.ts (abridged)
plugins: [
  json(),
  nodeResolve({ extensions }),
  babel({
    extensions, exclude: /node_modules/, babelrc: false,
    babelHelpers: "inline",                       // helpers duplicated per module
    presets: ["@babel/preset-env", "@babel/preset-typescript"],   // NO targets
    plugins: ["@babel/plugin-syntax-dynamic-import", "@babel/plugin-proposal-class-properties"],
  }),
  jsxPonyfill(),                                  // regex rewrite of Object.freeze / Array.isArray
  jsxInclude({ iife: true, globalThis: "thisObj" }), // inlines "// @include" files and wraps everything
  jsxBin(mode),                                   // optional .jsxbin via the `jsxbin` package
]
```

- **Babel versions:** `@babel/core ^7.19`, `@babel/preset-env ^7.19`, `@rollup/plugin-babel ^6.0.4`, `rollup ^4.42`, `typescript ^5.8.3`, `types-for-adobe ^7.2.3`.
- **ES3 transforms:** preset-env has **no `targets`**. On Babel 7 that means "transform everything", which includes the three ES3 plugins (`transform-member-expression-literals`, `transform-property-literals`, `transform-reserved-words`). Running Bolt's exact options on Babel 7.29 [lab] gives output that is valid ES3 syntax, with `"default"` and `o["default"]` quoted. **On Babel 8 the same config emits modern code**, because Babel 8's default target is browserslist `defaults` [lab: the output kept `class` and `static` fields].
- **Wrapper:** the Rollup output (default `es` format; the entry has only type exports) is wrapped as `(function (thisObj) { …includes…; …bundle… })(this);`, with lines joined by `\r`. Functions are published on the `$` object (`host[ns] = aeft`, where `ns` is the extension ID) to avoid polluting the global namespace.
- **JSON:** `src/jsx/index.ts` starts with `// @include './lib/json2.js'`. `jsxInclude` inlines that file, a minified Crockford json2 that **installs a global `JSON` if one is missing**, at the top of the bundle. `src/jsx/global.d.ts` declares `JSON` for TypeScript.
- **Comment stripping:** `jsxInclude` also deletes every `// @…` comment from the source. This matters because ExtendScript treats `//@include` and similar comments as preprocessor directives (§4.3).
- **Ponyfills:** `jsxPonyfill` replaces the text `Object.freeze` with `__objectFreeze(o){return o}` and `Array.isArray` with `__isArray` (`instanceof Array`). It does this with a **regex over the final chunk**, so it would also rewrite matches inside strings. Custom `{find, replace, inject}` entries can be added.
- **Array.prototype methods:** these are **not** polyfilled. Bolt ships helper functions in `src/jsx/utils/utils.ts` (`forEach`, `map`, `indexOf`, …) instead, so `.map()` passes through untouched (issue #11).

### 1.2 How individual features fare in Bolt's output
| Feature | Result with Bolt's config (Babel 7 helpers) |
|---|---|
| `let`/`const` | Become `var`. Closures in loops get `_loop` wrapper functions. Fine. |
| Arrow functions | Become `function`s with `_this`. Fine. |
| Template literals | Become `"".concat(…)` (ES3 `String.prototype.concat`). Fine. |
| Reserved words as properties | Quoted (`o["default"]`, `{"class": 1}`). Fine on Babel 7, see above. |
| Classes | `_classCallCheck` plus `_createClass`, which calls **`Object.defineProperty`** and **breaks in ExtendScript**. Open issue #93 (2023): "extendscript doesn't know anything about `Object.defineProperty`". Issue #133 is a related "Cannot call a class as a function" report. [community] |
| Getters/setters | Lowered to `Object.defineProperty({get})`, so they break as well. |
| Spread / for-of | `_toConsumableArray` and `_createForOfIteratorHelper` guard their `Symbol` checks and fall back to `Array.isArray`, which is ponyfilled. These work, but the helpers are heavy. |
| Object spread/rest | `_objectSpread2` and `_objectWithoutProperties` need `Object.keys`, `getOwnPropertySymbols` and `Array.prototype.indexOf`. These break unless polyfilled. |

The Bolt `src/jsx/tsconfig.json` uses `"target": "es3"`. TypeScript ≥ 5.6 rejects that with TS5108 [lab]. Bolt's build doesn't notice because its root and build tsconfigs exclude `src/jsx`, so the ExtendScript layer is never type-checked during the build [docs].

### 1.3 What is reusable without adopting Bolt
- The **idea and roughly 40 lines** of `vite.es.config.ts`: Rollup, node-resolve and Babel (env + typescript), then a post-pass. Our recommended config (§6) is a hardened version of it.
- `jsxInclude` and `jsxPonyfill` are plain Rollup plugins exported from `vite-cep-plugin` (MIT). The package pulls in `archiver`, `jszip`, `fs-extra`, `meta-bolt` and `prettify-xml`, and `jsxBin` needs the undeclared `jsxbin` package. **Copying the idea is better than depending on it.** Our post-pass (§6.5) replaces both plugins with AST-based code.
- The `$`-namespace convention and the `evalTS` typed-RPC idea. We already have our own bridge (D5–D8).
- Not reusable as-is: the Babel config on Babel 8 (no targets), the class and getter handling, and the regex ponyfills.

---

## 2. AE type definitions

### 2.1 Package
- **`types-for-adobe@7.2.6`**: published 2026-09-04, MIT, GitHub `docsforadobe/types-for-adobe`. Maintainers include Justin Taylor (Hyper Brew) and Zack Lovatt [docs].
- **`@types/after-effects` does not exist** (npm 404) [docs]. No maintained alternative turned up. `types-for-adobe-extras@0.0.9` covers only the Premiere QE DOM. `photoshop.d.ts` is Photoshop only.
- Layout: `AfterEffects/<ver>/index.d.ts` for 8.0 … 24.6, 25.1, 25.2, 25.4 and **26.0**. The shared ExtendScript libs live in `shared/` (`JavaScript.d.ts`, `global.d.ts`, `ScriptUI.d.ts`, `XMPScript.d.ts`, `PlugPlugExternalObject.d.ts`). The GitHub `master` branch has no 26.3 or 26.5 folder either; the last AE commit is 2026-05-18 [docs].
- `shared/JavaScript.d.ts` is an **ES3 library**. With `noLib: true`, it makes `JSON`, `[].map` and `Object.keys` type errors, which is what we want [lab]:
  `TS2339: Property 'map' does not exist on type 'number[]'`, `TS2304: Cannot find name 'JSON'`, `TS2550: Property 'keys' does not exist on type 'ObjectConstructor'`.

### 2.2 Coverage of recent APIs (`AfterEffects/26.0/index.d.ts`) [lab: grep and type-check]
| API | First typings folder | In 26.0 typings? | Notes |
|---|---|---|---|
| `CompItem.saveFrameToPng(time, file)` | 17.0 | yes | Typed `: void`. **Wrong for 26.5**, which returns a task object with `wait()`, `onComplete`, `onError` and `_isReady` (D12). Declaration merging cannot override it, because the class overload wins [lab]. Wrap it in a runtime helper that casts. |
| `ThreeDModelLayer` | 24.5 | yes | Declared as an empty `class ThreeDModelLayer extends AVLayer {}`. |
| `Property.setPropertyParameters(items)` / `isDropdownEffect` | 17.0 | yes | 26.0 adds `propertyParameters` and `valueText`. |
| `TextDocument.characterRange(start, end)` → `TextDocument & CharacterRange`, plus `paragraphRange`, `composedLineRange`, `CharacterRange.pasteFrom` | 24.3 / 25.1 | yes | `CharacterRange` types `fillColor`, `strokeColor`, `strokeOverFill`, `text` and `kerning`; the rest comes from the `TextDocument &` intersection. |
| `app.fonts` / `FontObject` / `FontsObject`, `Project.replaceFont`, `usedFonts` | 24.0 / 24.5 | yes | |
| `TextDocument.boxAutoFitPolicy` etc. | 24.6 | yes | |
| `LightLayer.lightSource` | 25.2 | yes | |
| `PropertyGroup.addVariableFontAxis` | 26.0 | yes | |
| `app.restart()` (AE 25.4) | 25.2 only | **no** | Missing from the 25.4 and 26.0 folders. |
| `LayerCollection.addParametricMesh` / `ParametricMeshLayer` (AE 26.3) | none | **no** | |
| `GuideOptions`, `Item/Layer.getGuideAsObject`, `Property.layerInputStage`… (AE 26.5) | none | **no** | |

The AE 26.x API list comes from `ae-scripting.docsforadobe.dev/introduction/changelog/` [docs].

### 2.3 Consuming it [lab: TS 6.0.3 and 7.0.2 both pass]
Both forms work: `"types": ["types-for-adobe/AfterEffects/26.0"]` in tsconfig, or `/// <reference types="types-for-adobe/AfterEffects/26.0" />` in a file.
TS 5.9 with `target: es2015` and `noLib` reports TS2488 on `for…of` over arrays, because no iterator types exist. TS 6.0 and 7.0 do not, and neither does TS 5.9 with `target: es5`.
Missing APIs go in a local `types/ae-augment.d.ts` (§6.2). Interface merging works for adding members (`interface LayerCollection { addParametricMesh(…) }`, `interface Application { restart(): void }`) but not for changing an existing member's return type [lab].

---

## 3. Compiling TS to ES3 today

### 3.1 TypeScript [lab: each version run]
| Version | `target: ES3` | `target: ES5` |
|---|---|---|
| 5.4.5 | Deprecated (TS5107). Works with `"ignoreDeprecations": "5.0"` and gives real ES3 semantics: `{"default": 1}` quoted, and accessors are an error (TS1056). | ok |
| 5.5.4 | Accepted with `"ignoreDeprecations": "5.0"`, but the output **uses ES5 semantics**: `{ default: 1 }` and `o.default` are not quoted, and there is no accessor error. | ok |
| 5.6 – 5.9.3 | **TS5108 "Option 'target=ES3' has been removed"** | ok |
| 6.0.3 (2026-04-16, last JS-based release) | TS5108, removed | **Deprecated** (TS5107; silence with `"ignoreDeprecations": "6.0"`) |
| 7.0.2 (2026-07-08, Go native; `latest`) | Not even a valid value: `--target` accepts only `es6`, `es2015` … `esnext` (TS6046) | **TS5108, removed** |

- TS 7.0.2's `typescript` package exports **no classic compiler API**. `lib/` holds only `tsc.js`, `getExePath.js` and `version.cjs`. The exports are `typescript/unstable/sync`, `…/async` and `…/ast` (an IPC API). If the Node-side compiler needs `ts.createProgram` or `transpileModule` in-process, pin `typescript@6.0.3` [lab].
- Conclusion: **use tsc only for type-checking** (`noEmit`), and let Babel do the emit.

### 3.2 Babel [lab]
- Current lines: `@babel/core@8.1.0` (8.0.0 went GA on 2026-06-16) and `@babel/preset-env@8.0.7` / `@babel/preset-typescript@8.0.7`. Babel 7 is still patched (`@babel/core@7.29.13` was published today, dist-tag `v7`). Babel 8 requires **Node `^22.18.0 || >=24.11.0`** (Node 22.20 is fine) and is ESM-only [docs].
- Babel 8 changes that matter here [docs: v8 migration guide]:
  - The default target is browserslist `defaults` (Babel 7 used "all"), so **`targets` must be set explicitly**.
  - `loose`, `spec` and `bugfixes` were removed from preset-env. Use top-level `assumptions` instead.
  - `useBuiltIns` was removed in favour of `babel-plugin-polyfill-corejs3`.
  - Uninitialized class fields are now preserved (`this.x = void 0`). Use TypeScript's `declare x: T` to avoid that.
  - `proposal-*` plugins were renamed to `transform-*`.
- The **ES3 plugins still ship inside preset-env 8**: `@babel/plugin-transform-member-expression-literals`, `-property-literals` and `-reserved-words`, all at 8.0.1. In `@babel/compat-data` they turn on for **IE < 9**, so `targets: "ie 8"` enables them. IE 9 does not [lab: compat-data `ie: "9"`; an `ie 9` build leaves `obj.default` bare]. You can also force them with `include: [...]`.
- What `targets: "ie 8"` produces [lab]:
  - `o.default` becomes `o["default"]`.
  - `{default: 1, new: 2}` becomes `{"default": 1, "new": 2}`.
  - `var int`, `native`, `abstract`, `char`, `goto` and `float(double)` are renamed with a leading underscore (`_int`, `_float(_double)`).
  - `let`/`const` become `var`, arrows become functions, and `a ?? b` becomes `a != null ? a : b` (with `noDocumentAll`).
  - `2 ** 3` becomes `Math.pow`, and `f(...xs)` becomes `f.apply(void 0, xs)`.
- **Preset order matters.** Presets run last to first. With `["@babel/preset-typescript", "@babel/preset-env"]`, env lowers the class *before* the TS parameter properties are stripped. That leaves `function Base(public n)` in the output, which acorn rejects [lab]. Use `[env, typescript]`.
- Helper cost with versus without `assumptions` [lab, same input]: 10.4 KB versus 3.9 KB. The input used `Symbol` (19 references → 2), `Reflect`, `Array.from`, `Object.getOwnPropertyDescriptor` and more. With the assumptions in §6.3, the only ES5 statics left are `Object.defineProperty` (from `_createClass` and `_inherits`) and `Object.create` (from `_inherits`). `Object.assign` and `Object.setPrototypeOf` appear only behind feature checks that fall back to ES3 code. `Array.prototype.indexOf` appears only through object-rest destructuring (`_objectWithoutPropertiesLoose`), and the guard in §6.4 rejects that.
- Warm transform speed [lab]: a 36 KB generated-style script takes **40–80 ms**. The first call in a process takes 0.4–1.9 s while Babel loads its config and plugins. An acorn ES3 parse of the output takes 8–13 ms.

### 3.3 esbuild, SWC, Rolldown: cannot emit ES3 [lab]
- **`esbuild@0.28.2`:** `--target=es3` gives `Invalid target "es3"`. `--target=es5` gives `Transforming const to the configured target environment ("es5") is not supported yet` (it fails on let, const, classes and more). As a *bundler* in front of Babel it is also unusable: its IIFE export helper `__export` defines **getters** via `Object.defineProperty`, which failed in the ES3 harness with `__defProp is not a function`.
- **`rolldown@1.2.16`:** IIFE namespaces use `__exportAll`, which builds getter properties and needs `Symbol.toStringTag`. It fails the same way in the ES3 harness.
- **`@swc/core@1.16.21` with `jsc.target: "es3"`:** leaves `default: 1` and `obj.default` unquoted and keeps `Symbol`/`Object.defineProperty` helpers. It fails `acorn` with `allowReserved: "never"`. Not recommended unless ExtendScript is shown to accept ES5 keyword-as-property syntax, which is [unverified] (§6.7).
- **Rollup** (`rollup@4.67.5`): `format: "iife"` with `freeze: false`, `strict: false`, `esModule: false`, `generatedCode: { preset: "es5", reservedNamesAsProps: false }` emits plain object literals for namespaces (`{ __proto__: null, a: a }`), a plain `function` wrapper and no getters. **This bundle passes acorn ES3 and runs in the ES3 harness.** Caveat: top-level `this` in a module becomes `undefined`, so use `$.global`.
- webpack 5 was not tested. From prior knowledge, its harmony export runtime also uses getter `defineProperty` calls [unverified].

### 3.4 Polyfills: what is actually needed
In AE 26.5 these must be treated as **absent**: `JSON` (verified, D11), `Object.create`, `Object.defineProperty`, `Object.keys`, `Array.isArray`, `Array.prototype.map/filter/forEach/indexOf/reduce/some/every`, `Function.prototype.bind`, `String.prototype.trim`, `Date.now` and `Date.prototype.toISOString`. Except for `JSON`, this is [community]: Adobe engineer Douglas Waterfall (2024) said `Array.forEach` is "not a native ExtendScript function", and Bolt #93 says the same about `defineProperty`. Confirm with the probe in §6.7.

Two facts drive the policy:
1. **The engine is shared, and other code patches it** [community, 2024]. A user saw `Array.indexOf` appear after opening AE's own *Learn* panel, and plugins or panels can load polyfills into the global space. In Premiere, the native `JSON` object exists only while the CC Libraries panel is visible. So **never rely on these being present or absent**, and **never install prototype polyfills yourself**. In ES3 an assigned `Array.prototype.map` is enumerable, so every `for (k in array)` in every other script would see it.
2. Babel's lowered output needs only `Object.create` (two arguments, data descriptors) and `Object.defineProperty` (data descriptor, `{writable:false}`). Everything else is guarded.

Policy (verified in the harness [lab]):
- **Statics used by Babel helpers:** rewrite them in the bundle to local ponyfills (`__es3_create`, `__es3_defineProperty`, `__es3_keys`, `__es3_isArray`, `__es3_identity`). The post-pass in §6.5 does this, so globals stay untouched.
- **Prototype methods and JSON:** handle them with runtime helper functions (`each`, `map`, `filter`, `indexOf`, `reduce`, `keys`, `trim`, `now()`, and our own `stringify` per D11). TypeScript enforces this through the ES3 `JavaScript.d.ts` lib.
- **Inside ExtendScript, avoid `JSON.parse` on large inputs.** One report measured a 7 MB `JSON.parse` at 143 s in Premiere's ExtendScript versus about 25 ms in the panel's JS [community, 2023]. The compiler should embed data as **JS object literals** (validated by acorn) instead of JSON strings. The runtime then needs only `stringify` to return results.

Package status [docs]:
| Package | Version / date | Status |
|---|---|---|
| `extendscript-es5-shim` | 0.3.1 (2020-10). Repo last pushed 2023-01, not archived. | Assigns methods onto prototypes (enumerable). Its `Object.defineProperty` throws on `get`/`set`. Its `Array.prototype.map` checks `callback.__class__`, which is ExtendScript-specific. Bundles json2. **OK as an MIT snippet source; do not include globally.** |
| `json2` on npm | 0.4.0 | **Not Crockford's**: it is the "json2 / native JSON normalizer for Joose" fork. The canonical json2.js is `github.com/douglascrockford/JSON-js` (public domain, last pushed 2023-05). |
| `json3` | 3.3.3 | **Repo archived**: "A JSON polyfill. No longer maintained." |
| `es5-shim` | 4.6.7 (2022) | Browser-oriented. Same prototype-pollution concern. |
| `core-js` | 3.51.0 | Overkill, and relies on descriptors. Bolt issue #11 reports trouble producing valid ExtendScript with core-js-pure plus esbuild. Not recommended. |
| `babel-preset-extendscript` | 1.0.2 (repo last pushed 2020) | Stale. |

---

## 4. ES3 validation and ExtendScript gotchas

### 4.1 acorn `ecmaVersion: 3` [lab, acorn 8.19.0]
The important option is **`allowReserved`**. With its default (`true` for ecmaVersion 3) or `false`, acorn accepts keywords as property names, which is ES5 semantics. **Only `allowReserved: "never"` rejects `obj.default` and `{default: 1}`.**

| Snippet | `allowReserved` default / `false` | `"never"` |
|---|---|---|
| `{a:1,}` (trailing comma in object) | reject | reject |
| `[1,2,]` (trailing comma in array, valid ES3 elision) | ok | ok |
| `o.default`, `{default:1}`, `o.class`, `o.import()` | **ok** | **reject** |
| `{'default':1}`, `o['default']` | ok | ok |
| `var int = 1`, `var abstract` (ES3 future reserved) | default: ok; `false`: reject | reject |
| `get x(){}` / `set x(v){}` literals | reject | reject |
| `let`, `const`, arrows, template literals, `/a/y`, `1_000` | reject | reject |
| E4X `<a/>`, `#include` | reject | reject. These must never appear in our output anyway. |
| `'use strict'`, `debugger`, labels, try/catch/finally | ok | ok |

Use: `parse(code, { ecmaVersion: 3, sourceType: "script", allowReserved: "never" })`. acorn only checks **syntax**. Runtime API usage such as `Object.defineProperty(…{get})` passes, which is why §6.5 also scans for banned helpers and why the ES3 harness exists.

### 4.2 ExtendScript parser and semantics bugs a code generator must avoid
1. **Nested conditionals** [community: AE forum 2018 and an AE bug report from 2025-07-24, still open]:
   - `true ? true ? "one" : "two" : "three"` is a **syntax error** ("Expected: :").
   - `true ? a : true ? b : c` **returns `b`**, a silent wrong result.
   - Parenthesizing the inner `?:` fixes both. An Adobe community manager does not expect a fix soon.
   - Minifiers (UglifyJS #1144, terser) and Babel's printer drop those parens. Babel prints `s > 1 ? s > 2 ? 3 : 2 : 1` [lab].
2. **`||` / `&&` precedence**: `true || false && false` reportedly evaluates to `false` in ExtendScript (left to right) instead of `true` [community, 2018]. Parenthesize every `&&` that is an operand of `||` (and vice versa).
   → The post-pass in §6.5 adds both kinds of parentheses on the AST [lab: `a ? 1 : (b ? 2 : 3)` and `(a && b) || c > 2`]. **Never minify** ExtendScript output.
3. **Getters/setters are not supported** [community 2012, plus `extendscript-es5-shim`, which throws "getters & setters can not be defined on this javascript engine"]. Ban them at compile time (§6.4).
4. **Comments as directives** [docs: ExtendScript preprocessor directives]: directives can be written either as `#include "x"` or as **a comment starting with `@`**, such as `//@include "x"`. Strip comments that start with `@` from output, for example `//@ts-ignore`, `//@include` and `/*@__PURE__*/`. Bolt also strips `// @…` comments.
5. **`#include`, `#includepath`, `#targetengine`** [docs]: `#include` resolves the literal path first, then `#includepath` entries, then engine paths. A missing file is a runtime error. `#targetengine` works only in Illustrator and InDesign CS5+, and other apps ignore it, so in AE everything shares one engine and its globals persist. Our output should contain **no directives**: bundle everything.
6. **`$.evalFile(file[, timeout=10000])`** [docs] evaluates a file and returns its last value; it returns `undefined` if evaluation fails within the timeout. Use it to load the prebuilt runtime once per AE session, guarded by version (§6.6). `$.global` is the global object, and `$.hiresTimer` is in microseconds.
7. **`for…in` pitfalls**: because other panels inject enumerable polyfills, never `for…in` over arrays, and always filter object `for…in` with `Object.prototype.hasOwnProperty.call`. Babel's `_extends` fallback already does that.
8. **Rollup namespace objects** contain `__proto__: null`. If ExtendScript treats `__proto__` as a plain key, that key becomes enumerable [unverified]. Avoid using `import * as ns` as a value.
9. **Static class inheritance** goes through `_setPrototypeOf`'s fallback `t.__proto__ = e`. Whether ExtendScript honours `__proto__` writes is [unverified]. Instance inheritance via `__es3_create` works regardless.
10. **Size, recursion and string performance**: a 64 KB string-literal limit, the recursion depth limit (a "Stack overrun" error) and slow `+=` concatenation are all **[unverified]**. No authoritative source was found. Until §6.7 measures them: keep single string literals under 32 KB, write iterative algorithms, and build large strings with `array.join("")`.
11. **`evalScript` errors are opaque** ("EvalScript error") [community]. Wrap every payload in `try { … } catch (e) { return <serialized error with e.line, e.message> }`. The bridge design (D8) already assumes this.

---

## 5. UXP in After Effects (status at 2026-11-04)

- **Not in release AE.** AE 26.x has **no** UXP plugin or scripting support for third parties.
  - On 2026-10-30 Adobe opened a **private beta** in the Creative Cloud Developer forum ("After Effects is adding UXP plugin support: Private Beta now open"). It runs on **AE (Beta) build 27.0.0.63**, for a small group of developers, "ahead of the public beta at MAX" [community].
  - Adobe's roadmap says "Public beta UXP plugins by November 2026" for AE [docs: Adobe Developer Blog, 2026-09]. No public-beta announcement was found as of today [unverified].
  - The `Support Files\UXP` folder in our 26.5 install (ENVIRONMENT.md) is the host's runtime. Nothing suggests it is open to plugins [unverified].
- **API** [docs: `developer.adobe.com/after-effects/uxp/after-effects-api/`, marked beta]:
  - `require("aftereffects")`; 43 classes whose names mirror the ExtendScript DOM: `Application`, `Project`, `CompItem`, `LayerCollection`, `Property`, `PropertyGroup`, `TextDocument`, `CharacterRange`, `ParagraphRange`, `ThreeDModelLayer`, `ParametricMeshLayer`, `RenderQueue`, `OutputModule`, `KeyframeEase`, `GuideOptions`, `Fonts`, `Viewer` and others.
  - **Every member lists Min Version 27.0.**
  - Calls appear synchronous (they return values). `CompItem.saveFrameToPng`, `saveDraftFrameToPng` and `getRenderGUID` return a **`DeferredCall`**, which matches the task object we see from `saveFrameToPng` in ExtendScript 26.5 (D12).
  - `app.beginUndoGroup`/`endUndoGroup`, `scheduleTask` and `executeCommand` exist.
  - **No `evalScript`-style bridge to ExtendScript** is listed. "Hybrid" (C++) plugins for AE are a developer feature request, not a feature [community, 2026-10].
  - The get-started page is still a placeholder [docs].
- **Maturity:** private beta, with docs still filling in. Far behind ExtendScript and CEP, which are complete and stable in 26.x.
- **CEP deprecation** [docs: Adobe Developer Blog 2026-09]:
  - **December 2028:** AE stops accepting new CEP submissions, and CEP becomes **disabled by default**.
  - **December 2029:** CEP is no longer included in AE.
  - Each flagship app is guaranteed at least two years after its UXP public beta.
  - The blog says **"ExtendScripts are not affected by this transition."**
  - For comparison: Premiere's UXP and hybrid plugins are GA; Photoshop's CEP is disabled by default from December 2027.
- **Recommendation (swappable backend):** keep ExtendScript plus the CEP bridge as the primary backend (D10) and the `AfterFX.com -r` fallback. That covers us until at least December 2028, and pure `.jsx` execution beyond that.
  - Make the compiler emit a **backend-neutral build plan (IR)** and keep two emitters: `extendscript-es3` (today) and `uxp` (later: an ES2020+ module using `require("aftereffects")`, same DOM names, `DeferredCall` awaits).
  - Write the runtime library against a thin `Host` interface (app/project/File/stringify). The same TS sources can then be built twice: Babel `ie 8` plus the ES3 post-pass for ExtendScript, or a plain modern build for UXP.
  - Don't spend effort on UXP until a public beta exists and `27.0` ships in release.

---

## 6. Recommendation: exact toolchain

Everything in this section was run end to end [lab] in a scratch copy on 2026-11-04: Babel 8.1, Rollup 4.67.5, TS 6.0.3 and 7.0.2. The output was validated with acorn ES3 `allowReserved: "never"` and run in the ES3 harness. The code blocks in 6.3–6.5, the Rollup config in 6.6 and the probe in 6.7 were extracted from this file and run as written. **None of it has been run in After Effects yet.**

### 6.1 Packages
```jsonc
// devDependencies of the runtime/compiler packages (exact pins)
{
  "typescript": "6.0.3",                      // type-check (noEmit) + in-process TS API if the compiler needs it
                                              // (typescript@7.0.2 also type-checks this setup and is faster, but has no classic JS API)
  "types-for-adobe": "7.2.6",                 // AfterEffects/26.0 + ES3 shared lib
  "@babel/core": "8.1.0",
  "@babel/preset-env": "8.0.7",               // includes the 3 ES3 plugins (8.0.1)
  "@babel/preset-typescript": "8.0.7",
  "rollup": "4.67.5",
  "@rollup/plugin-babel": "7.1.0",            // peer says @babel/core ^7 — works with 8.1.0 [lab]; Babel 8 support PR rollup/plugins#2021 is open
  "@rollup/plugin-node-resolve": "16.0.3",
  "acorn": "8.19.0",
  "acorn-walk": "8.3.5",
  "magic-string": "1.4.5"                     // published 2026-10-27; pin 1.4.4 if you prefer releases older than 2 weeks
}
```
`@rollup/plugin-babel@7.1.0` declares `peerDependencies: { "@babel/core": "^7.0.0" }`, so you need one of these:
- **npm:** `.npmrc` with `legacy-peer-deps=true`. Without it, `npm i` fails with ERESOLVE [lab].
- **pnpm:** a peer rule, for example in `pnpm-workspace.yaml`:
  ```yaml
  peerDependencyRules:
    allowedVersions:
      "@babel/core": "8"
  ```
  The exact location for pnpm 11 is [unverified]; pnpm only warns on peer mismatches by default.
- **Zero-friction fallback:** `@babel/core@7.29.13`, `@babel/preset-env@7.29.7` and `@babel/preset-typescript@7.29.7`. The **same config** produced equivalent ES3 output and ran in the harness [lab]. On Babel 7, `targets` is still required for consistency.

Not used: esbuild, rolldown, SWC, `tsc` emit, core-js, es5-shim, extendscript-es5-shim (globally), json2/json3, terser or any other minifier, and jsxbin.

### 6.2 tsconfig (runtime and generated code type-check) [lab: TS 6.0.3 and 7.0.2 exit 0]
```jsonc
// packages/runtime/tsconfig.json
{
  "compilerOptions": {
    "target": "es2015",              // syntax is lowered by Babel; es2015 is the floor in TS 7
    "module": "esnext",
    "moduleResolution": "bundler",
    "noLib": true,                   // ES3 library only → JSON / [].map / Object.keys are type errors
    "types": ["types-for-adobe/AfterEffects/26.0"],
    "strict": true,
    "noEmit": true,                  // tsc never emits; Babel does
    "isolatedModules": true,         // Babel compiles per file (no cross-file const enum)
    "verbatimModuleSyntax": true     // type-only imports must say `import type`
  },
  "include": ["src/**/*.ts", "types/**/*.d.ts"]
}
```
```ts
// packages/runtime/types/ae-augment.d.ts — APIs newer than types-for-adobe 7.2.6
declare class ParametricMeshLayer extends AVLayer {}                     // AE 26.3
interface LayerCollection { addParametricMesh(...args: any[]): ParametricMeshLayer } // signature TBD
interface Application { restart(): void }                                  // AE 25.4, missing from 26.0 typings
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T } // not in the ES3 lib
/** CompItem.saveFrameToPng returns this in 26.5 (D12); call it through a runtime helper that casts. */
interface AeFrameTask { wait(): void; onComplete: (() => void) | null; onError: ((e: unknown) => void) | null; readonly _isReady: boolean }
```

### 6.3 Babel options (shared by the Rollup build and per-request transforms)
```js
// packages/runtime/babel.config.mjs  (imported explicitly; configFile/babelrc are off)
import es3Guard from "./build/babel-plugin-es3-guard.mjs";
export const es3BabelOptions = {
  babelrc: false,
  configFile: false,
  targets: "ie 8",            // REQUIRED on Babel 8; IE<9 enables the ES3 literal/reserved-word transforms
  assumptions: {
    setClassMethods: true, setPublicClassFields: true, setSpreadProperties: true,
    iterableIsArray: true,    // for-of / [...a] / [x, y] = arr → index loops, no Symbol.iterator
    noClassCalls: true, superIsCallableConstructor: true, constantSuper: true,
    skipForOfIteratorClosing: true, noDocumentAll: true, ignoreFunctionLength: true, noNewArrows: true,
  },
  plugins: [es3Guard],
  presets: [
    ["@babel/preset-env", {
      modules: false,
      include: ["transform-member-expression-literals", "transform-property-literals", "transform-reserved-words"],
      exclude: ["transform-typeof-symbol", "transform-regenerator", "transform-async-to-generator", "transform-async-generator-functions"],
    }],
    ["@babel/preset-typescript", {}],   // listed LAST so it runs FIRST
  ],
};
```
Note: `iterableIsArray` makes `for…of` and spread work **only on arrays and array-likes**. That holds for our runtime. AE collections are 1-based and must use index loops anyway.

### 6.4 Compile-time guard (rejects what cannot run on ES3) [lab: fails the build with a code frame]
```js
// packages/runtime/build/babel-plugin-es3-guard.mjs
export default function es3Guard() {
  const fail = (path, what) => { throw path.buildCodeFrameError(`ES3/ExtendScript: ${what} is not supported`); };
  const checks = {
    "ClassMethod|ObjectMethod|ClassPrivateMethod|ClassAccessorProperty"(path) {
      const k = path.node.kind;
      if (k === "get" || k === "set" || path.isClassAccessorProperty()) fail(path, "getter/setter/accessor");
    },
    Function(path) { if (path.node.generator) fail(path, "generator"); if (path.node.async) fail(path, "async function"); },
    RestElement(path) { if (path.parentPath.isObjectPattern()) fail(path, "object rest destructuring (helper needs Array.prototype.indexOf)"); },
    TaggedTemplateExpression(path) { fail(path, "tagged template"); },
  };
  // Pre-pass in Program.enter: preset-env would otherwise rewrite classes/rest before these visitors see them.
  return { name: "es3-guard", visitor: { Program: { enter(path) { path.traverse(checks); } } } };
}
```
TypeScript with the ES3 lib already rejects `JSON`, `Map`, `Set`, `Promise`, `Symbol`, `[].map`, `Object.keys`, `"".trim` and so on [lab, for the first and the array/Object ones].

### 6.5 ES3 post-pass (AST based; replaces Bolt's `jsxInclude`/`jsxPonyfill`) [lab]
```js
// packages/runtime/build/es3-postpass.mjs
import { parse } from "acorn";
import { simple } from "acorn-walk";
import MagicString from "magic-string";

const PONY = { "Object.create": "__es3_create", "Object.defineProperty": "__es3_defineProperty",
  "Object.keys": "__es3_keys", "Array.isArray": "__es3_isArray", "Object.freeze": "__es3_identity" };
const PONY_SRC = {
  __es3_create: "function __es3_create(p, props) { function F() {} F.prototype = p; var o = new F(); if (props) { for (var k in props) { if (Object.prototype.hasOwnProperty.call(props, k)) { o[k] = props[k].value; } } } return o; }",
  __es3_defineProperty: "function __es3_defineProperty(o, k, d) { if (d.get || d.set) { throw new Error(\"ES3: accessor properties are not supported\"); } if (\"value\" in d) { o[k] = d.value; } return o; }",
  __es3_keys: "function __es3_keys(o) { var r = [], k; for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { r[r.length] = k; } } return r; }",
  __es3_isArray: "function __es3_isArray(a) { return Object.prototype.toString.call(a) === \"[object Array]\"; }",
  __es3_identity: "function __es3_identity(o) { return o; }",
};
const BANNED = ["_objectWithoutProperties", "_toConsumableArray", "_slicedToArray", "_createForOfIteratorHelper",
  "_regenerator", "_asyncToGenerator", "_wrapNativeSuper", "_taggedTemplateLiteral", "Symbol.iterator"];
const ES3 = { ecmaVersion: 3, sourceType: "script", allowReserved: "never" };

export function es3PostPass(code, opts = {}) {
  const comments = [];
  const ast = parse(code, { ...ES3, preserveParens: true, onComment: comments });
  const s = new MagicString(code);
  const used = new Set();
  const wrap = (n) => { s.appendLeft(n.start, "("); s.prependRight(n.end, ")"); };
  simple(ast, {
    MemberExpression(n) {                       // ES5 statics → local ponyfills (no global patching)
      if (!n.computed && n.object.type === "Identifier" && n.property.type === "Identifier") {
        const rep = PONY[n.object.name + "." + n.property.name];
        if (rep) { s.overwrite(n.start, n.end, rep); used.add(rep); }
      }
    },
    ConditionalExpression(n) {                  // ExtendScript nested ?: bugs
      for (const c of [n.test, n.consequent, n.alternate]) if (c.type === "ConditionalExpression") wrap(c);
    },
    LogicalExpression(n) {                      // ExtendScript ||/&& precedence bug
      for (const c of [n.left, n.right]) if (c.type === "LogicalExpression" && c.operator !== n.operator) wrap(c);
    },
  });
  for (const c of comments) if (/^\s*@/.test(c.value)) s.remove(c.start, c.end);   // "//@include"-style directives
  const at = opts.insertAt ?? code.indexOf("\n") + 1;                               // inside the IIFE
  if (used.size) s.appendRight(at, [...used].map((u) => PONY_SRC[u]).join("\n") + "\n");
  const out = s.toString();
  parse(out, ES3);                                                                   // hard ES3 syntax gate
  return { code: out, map: s.generateMap({ hires: true }), problems: BANNED.filter((b) => out.includes(b)) };
}

export default function es3() {
  return {
    name: "es3",
    renderChunk(code) {
      const r = es3PostPass(code);
      for (const p of r.problems) this.error(`ES3: bundle contains ${p} (needs ES5+ runtime support)`);
      return { code: r.code, map: r.map };
    },
  };
}
```

### 6.6 Rollup config and the two ways to produce "one ES3 file"
```js
// packages/runtime/rollup.config.mjs
import { babel } from "@rollup/plugin-babel";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import es3 from "./build/es3-postpass.mjs";
import { es3BabelOptions } from "./babel.config.mjs";

const extensions = [".ts", ".js"];
export default {
  input: "src/index.ts",              // no exports: the entry publishes itself on $.global.__aeCompose
  treeshake: true,
  plugins: [
    nodeResolve({ extensions }),
    babel({ ...es3BabelOptions, extensions, babelHelpers: "bundled" }),  // helpers once, inside the IIFE
    es3(),
  ],
  output: {
    file: "dist/ae-compose-runtime.jsx",
    format: "iife",
    strict: false,                    // no "use strict"
    freeze: false,                    // no Object.freeze on namespaces
    esModule: false,                  // no __esModule marker
    externalLiveBindings: false,
    generatedCode: { preset: "es5", reservedNamesAsProps: false, symbols: false },
    indent: false,
  },
};
```

**A. Recommended: prebuilt runtime plus a per-request scene script.**
- The runtime is built once at package build time. The bridge loads it once per AE session; the guard is `if (!$.global.__aeCompose || $.global.__aeCompose.version !== "x.y.z") $.evalFile(runtimeFile)`.
- Each request then sends only the scene.
- The ideal is for the codegen to emit ES3 directly: data as quoted-key object literals plus runtime calls. Then only `es3PostPass` runs, which costs about 10 ms.
- If the generated code is TS, transform it in-process [lab: the first call takes 0.4–1.9 s while Babel loads its config and plugins; after that, 40–80 ms per 36 KB]:
```js
import { transformAsync } from "@babel/core";
const { code } = await transformAsync(sceneTs, { ...es3BabelOptions, filename: "scene.ts", sourceType: "script" });
const r = es3PostPass("(function () {\n" + code + "\n})();");   // own IIFE keeps Babel helpers local
if (r.problems.length) throw new Error(r.problems.join(", "));
const oneFile = runtimeJsx + "\n;\n" + r.code;                   // if a single file is required
```

**B. Single Rollup pass with an in-memory entry.** This gives tree-shaking across runtime and scene [lab: about 500 ms cold, 8–11 ms warm with `cache` when the scene is unchanged]:
```js
const SCENE = path.resolve("__scene__.ts");   // fake on-disk id: @rollup/plugin-babel's filter skips "\0" ids [lab]
const scenePlugin = { name: "scene", resolveId: (id) => (id === "scene" ? SCENE : null), load: (id) => (id === SCENE ? sceneTs : null) };
const bundle = await rollup({ ...config, input: "scene", cache, plugins: [scenePlugin, ...config.plugins] });
const { output } = await bundle.generate(config.output);   // output[0].code is the single ES3 file
```

### 6.7 Tests to add, and a probe to run once in AE (Phase 2)
- **ES3 harness (CI, no AE):** run the bundle in `node:vm` after deleting `Object.create/defineProperty/keys/assign/setPrototypeOf/freeze`, `Array.isArray/from`, the ES5 `Array.prototype` methods, `String.prototype.trim`, `Function.prototype.bind`, `Date.now`, `JSON`, `Symbol`, `Map`, `Set`, `Promise` and `Reflect`.
  - It caught `e.indexOf is not a function` from object rest, and `__defProp is not a function` from esbuild and rolldown output [lab].
  - It is a smoke test, not ExtendScript.
- **Golden tests:** every emitted script must pass `parse(code, {ecmaVersion: 3, allowReserved: "never"})`.
- **AE probe:** run once through the bridge and record the results in ENVIRONMENT.md. This settles every **[unverified]** item above. It is written in ES3 and uses `eval` so that a syntax failure is caught rather than fatal. `toSource()` exists in ExtendScript, so no JSON is needed.
```js
(function () {
  function t(src) { try { return eval(src); } catch (e) { return "ERR: " + e.message; } }
  var r = { engine: $.version + " | " + $.build };
  r.statics = [typeof JSON, typeof Object.create, typeof Object.defineProperty, typeof Object.keys, typeof Array.isArray, typeof Date.now].join(",");
  r.protos = [typeof [].map, typeof [].forEach, typeof [].indexOf, typeof "".trim, typeof (function () {}).bind].join(",");
  r.kwMember = t("var o = {}; o.default = 1; o.default");          // ES5 keyword-as-property syntax accepted?
  r.kwKey = t("({ default: 1 })['default']");
  r.getterLiteral = t("({ get x() { return 1; } }).x");
  r.defineGetter = typeof ({}).__defineGetter__;
  r.protoWrite = t("var p = { z: 1 }, o = {}; o.__proto__ = p; o.z");
  r.nested1 = t("true ? 'a' : true ? 'b' : 'c'");                 // JS: a (reported: b)
  r.nested2 = t("true ? true ? 'one' : 'two' : 'three'");         // JS: one (reported: syntax error)
  r.orAnd = t("true || false && false");                          // JS: true (reported: false)
  r.longLiteral = (function () { var s = []; for (var i = 0; i < 70000; i++) s[i] = "a"; return t('"' + s.join("") + '".length'); })();
  r.depth = (function () { var lim = [1000, 5000, 20000, 100000], ok = 0; function f(n, m) { return n >= m ? n : f(n + 1, m); }
    for (var i = 0; i < lim.length; i++) { try { f(0, lim[i]); ok = lim[i]; } catch (e) { break; } } return ok; })();
  r.concatMs = (function () { var t0 = $.hiresTimer, s = ""; for (var i = 0; i < 200000; i++) s += "x"; return ($.hiresTimer) / 1000; })();
  r.joinMs = (function () { var t0 = $.hiresTimer, a = []; for (var i = 0; i < 200000; i++) a[i] = "x"; a.join(""); return ($.hiresTimer) / 1000; })();
  return r.toSource();
})();
```
Run it in a throwaway session. A deep-recursion limit can be slow or unstable. `$.hiresTimer` returns the microseconds since its last read, so each `t0` read resets it.

### 6.8 Rules for the runtime library's own source (enforced by §6.2, §6.4 and §6.5)
- Allowed:
  - `let`/`const`, arrows, classes with methods and fields (no accessors), `extends`/`super`.
  - Templates, default params, array destructuring and spread (arrays only), `for…of` over arrays.
  - `?.` and `??`; object spread (it uses guarded `_extends`).
  - Shorthand properties, keyword property names (quoted automatically), `enum`, `const enum` (same file only).
- Forbidden:
  - Getters/setters, `async`/generators, object rest, tagged templates, `Symbol`, `Map`/`Set`/`Promise`, `JSON` (use the runtime's own `stringify`).
  - ES5 prototype methods: use the runtime ponyfills `each`, `map`, `filter`, `indexOf`, `reduce`, `keys`, `trim` and `now`.
  - `for…in` without a `hasOwnProperty` check, `import * as ns` used as a value, and top-level `this` (use `$.global`).
  - Minification.

---

## Sources
- Bolt CEP source: https://github.com/hyperbrew/bolt-cep (vite.es.config.ts, vite-cep-plugin/src/index.ts); issues #11, #93, #121, #133.
- types-for-adobe: https://github.com/docsforadobe/types-for-adobe and the npm tarball 7.2.6.
- AE scripting changelog: https://ae-scripting.docsforadobe.dev/introduction/changelog/
- ExtendScript preprocessor directives and the Dollar object: https://extendscript.docsforadobe.dev/extendscript-tools-features/preprocessor-directives/ and …/dollar-object/
- Babel 8 migration guide: https://babeljs.io/docs/v8-migration
- `@rollup/plugin-babel` Babel 8 support: rollup/plugins issue #2014 and PR #2021.
- Missing array methods in AE ExtendScript (2024): https://community.adobe.com/t5/after-effects-discussions/ae-scripting-array-methods-foreach-indexof-not-working-in-2024/m-p/14798137
- Nested ternaries and `||`/`&&` (2018): https://community.adobe.com/t5/after-effects-discussions/extendscript-throws-on-nested-ternary-operator/m-p/9573874
- Ternary bug report (2025): https://community.adobe.com/t5/after-effects-bugs/bug-in-extendscript-s-conditional-ternary-operator/idi-p/15428397
- Slow `JSON.parse` in ExtendScript (PPro, 2023): https://community.adobe.com/t5/premiere-pro-discussions/json-parse-extremely-slow-in-extendscript/m-p/13534456
- Getters/setters in ExtendScript (2012): https://community.adobe.com/questions-671/javascript-question-about-objects-851761
- UglifyJS nested-ternary issue: https://github.com/mishoo/UglifyJS/issues/1144
- UXP roadmap and CEP timeline: https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications
- AE UXP docs (beta): https://developer.adobe.com/after-effects/uxp/ , …/after-effects-api/ , …/after-effects-api/compitem , …/application , …/deferredcall
- AE UXP private beta announcement and hybrid request: https://forums.creativeclouddeveloper.com/tag/after-effects/200.md
- An older UXP status note (2026-04, now outdated): https://github.com/pushREC/after-effects-sdk-kb/blob/main/scripting/UXP-STATUS-NOTE.md
