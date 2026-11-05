// Recipe library (A6): source surgery on scene files, params schema and checks, save → list → instantiate round
// trip in a temp library, and every shipped recipe loading, compiling and instantiating.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyEdits, configEdits, findSceneConfig, objectProps, scanRefs, toLiteral } from '../../src/recipes/source.ts';
import { coerceParams, inferParam } from '@cc-mcp/core/templates/params.ts';
import { allRecipes, findRecipe, instantiateRecipe, listRecipes, saveRecipe, SHIPPED_RECIPES, slugify } from '../../src/recipes/index.ts';
import { instantiateRecipeTool, listRecipesTool, saveRecipeTool } from '../../src/recipes/tool.ts';
import { loadScene } from '../../src/scene/load.ts';
import { compileScene } from '../../src/compile/compile.ts';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-recipes-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
const write = (rel: string, text: string) => { const f = path.join(TMP, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const load = async (file: string) => (await loadScene({ file })).def;

describe('scene source surgery', () => {
  const src = `import { scene } from 'ae-compose';
const X = { a: 1 };
export default scene<P>({
  name: 'Old', duration: '4s', // a comment, with a comma
  params: { headline: 'HI, "there"', n: 3, data: [{ a: 1 }], fn: X.a },
}, (p) => null as any);`;
  it('finds the config object and its top-level props', () => {
    const c = findSceneConfig(src)!;
    expect(src[c.start]).toBe('{');
    expect(src[c.end]).toBe('}');
    expect(objectProps(src, c.start, c.end).map((p) => p.key)).toEqual(['name', 'duration', 'params']);
  });
  it('rewrites name and merges params, keeping untouched source', () => {
    const out = applyEdits(src, configEdits(src, { name: 'New', params: { headline: "it's new", extra: [1, 2] } }));
    expect(out).toContain(`name: 'New'`);
    expect(out).toContain(`headline: 'it\\'s new'`);
    expect(out).toContain('n: 3');
    expect(out).toContain('fn: X.a');
    expect(out).toContain('extra: [1, 2]');
  });
  it('adds params when the config has none, and spreads a params constant', () => {
    const a = `export default scene({ name: 'A', duration: 2 }, () => null as any);`;
    expect(applyEdits(a, configEdits(a, { params: { k: 1 } }))).toContain(`duration: 2, params: { k: 1 }`);
    const b = `const D = { k: 0 };\nexport default scene({ name: 'B', duration: 2, params: D }, () => null as any);`;
    expect(applyEdits(b, configEdits(b, { params: { k: 1 } }))).toContain('params: { ...D, k: 1 }');
  });
  it('serializes values as JS literals', () => {
    expect(toLiteral({ a: 'x\ny', 'b-c': [1, true, null] })).toBe(`{ a: 'x\\ny', 'b-c': [1, true, null] }`);
    expect(toLiteral(Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, value: i * 10 })))).toMatch(/^\[\n {2}\{ label: 'L0', value: 0 \},/);
  });
  it('finds relative imports and asset literals that exist', () => {
    const dir = path.join(TMP, 'refs');
    write('refs/brand.ts', 'export const B = 1;');
    write('refs/art/logo.svg', '<svg/>');
    const scene = write('refs/scene.tsx', `import { B } from './brand.ts';\nconst a = './art/logo.svg', b = './missing.png', c = 'https://x.com/a.png';\n<Text>Don't './art/logo.svg'</Text>`);
    const refs = scanRefs(fs.readFileSync(scene, 'utf8'), scene);
    expect(refs.map((r) => [r.kind, r.value])).toEqual([['import', './brand.ts'], ['asset', './art/logo.svg'], ['asset', './art/logo.svg']]);
    expect(refs[1].abs).toBe(path.join(dir, 'art', 'logo.svg'));
  });
});

describe('params', () => {
  it('infers types from defaults', () => {
    const dir = path.join(SHIPPED_RECIPES, 'logo-reveal');
    expect(inferParam(3, dir).type).toBe('number');
    expect(inferParam(true, dir).type).toBe('boolean');
    expect(inferParam('#4683c4', dir).type).toBe('color');
    expect(inferParam('rgb(1,2,3)', dir).type).toBe('color');
    expect(inferParam('./assets/mark.svg', dir).type).toBe('file');
    expect(inferParam('two\rlines', dir).type).toBe('text');
    expect(inferParam('HELLO', dir).type).toBe('string');
    expect(inferParam([{ a: 1 }], dir).type).toBe('data');
    expect(inferParam([1, 2], dir).type).toBe('vec');
    expect(inferParam(['a', 'b'], dir).type).toBe('list');
  });
  it('coerces, validates and makes file params relative to the new scene', () => {
    const schema = { n: { type: 'number', default: 1 }, c: { type: 'color', default: '#fff' }, f: { type: 'file', default: '' }, rows: { type: 'data', default: [{ label: 'A', value: 1 }] }, b: { type: 'boolean', default: false } } as const;
    const outFile = path.join(TMP, 'x', 'scene.tsx');
    const r = coerceParams(schema as any, { n: '2.5', c: '#ff0000', f: path.join(SHIPPED_RECIPES, 'logo-reveal', 'assets', 'mark.svg'), rows: [{ label: 'B' }], b: 'true', zzz: 1 }, { outFile });
    expect(r.errors).toEqual([]);
    expect(r.values.n).toBe(2.5);
    expect(r.values.b).toBe(true);
    expect(r.values.f).toMatch(/mark\.svg$/);
    expect(r.warnings.join('\n')).toMatch(/"zzz" is not a param/);
    expect(r.warnings.join('\n')).toMatch(/lack "value"/);
    const bad = coerceParams(schema as any, { n: 'many', c: 'notacolor', rows: 'x' }, { outFile });
    expect(bad.errors).toHaveLength(3);
  });
});

describe('save → list → instantiate', () => {
  const lib = path.join(TMP, 'lib');
  // A scene in its own project folder: imports ../brand.ts and uses an asset by relative path.
  write('proj/brand.ts', `import { brand } from 'ae-compose';\nexport const BRAND = brand({ colors: { ink: '#101010', white: '#fafafa', accent: '#ee4266' }, fonts: { display: 'Inter-Black' }, live: ['accent'] });\n`);
  write('proj/art/mark.svg', fs.readFileSync(path.join(SHIPPED_RECIPES, 'logo-reveal', 'assets', 'mark.svg'), 'utf8'));
  const sceneFile = write('proj/ember/scene.tsx', `// Ember Roast title
import { scene, Composition, Solid, Text, Svg, perWord } from 'ae-compose';
import { BRAND } from '../brand.ts';

export default scene({ name: 'EmberTitle', duration: 4, params: { headline: 'EMBER ROAST', logo: '../art/mark.svg', size: 150 } }, (p) => (
  <Composition>
    <Solid name="BG" color={BRAND.value('ink')} />
    <Svg id="logo" src={p.logo} width={200} y={300} color={BRAND.colors.accent} />
    <Text id="headline" font={BRAND.fonts.display} size={p.size} color={BRAND.value('white')} animate={{ text: perWord({ from: { y: 60, opacity: 0 }, each: '80ms' }) }}>{p.headline}</Text>
  </Composition>
));
`);
  // A second brand with another export name and the same tokens.
  const brand2 = write('clientx/tokens.ts', `import { brand } from 'ae-compose';\nexport const CLIENT = brand({ colors: { ink: '#001020', white: '#ffffff', accent: '#00c2a8' }, fonts: { display: 'Inter-Bold' }, live: ['accent'] });\n`);
  const brand3 = write('clienty/brand.ts', `import { brand } from 'ae-compose';\nexport const Y = brand({ colors: { bg: '#000000' } });\n`);

  it('saves the scene with its brand and asset, rewrites paths and writes the manifest', async () => {
    const thumb = write('proj/sheet.png', 'png');
    const r = await saveRecipe({ sceneFile, name: 'Ember Title', intent: 'A warm coffee-brand title with the logo above the headline', tags: ['title', 'coffee', 'logo'], params: { headline: 'The headline' }, thumbnails: [thumb], dir: lib });
    expect(r.dir).toBe(path.join(lib, 'ember-title'));
    expect(fs.readdirSync(r.dir).sort()).toEqual(['assets', 'brand.ts', 'recipe.json', 'scene.tsx', 'thumbs']);
    const src = fs.readFileSync(path.join(r.dir, 'scene.tsx'), 'utf8');
    expect(src).toContain(`from './brand.ts'`);
    expect(src).toContain(`logo: './assets/mark.svg'`);
    expect(r.recipe).toMatchObject({ name: 'ember-title', sceneName: 'EmberTitle', brand: 'brand.ts', duration: 4, thumbnails: ['thumbs/sheet.png'], controls: ['Accent Color'] });
    expect(r.recipe.params.headline).toMatchObject({ type: 'string', default: 'EMBER ROAST', description: 'The headline' });
    expect(r.recipe.params.logo.type).toBe('file');
    expect(r.recipe.params.size.type).toBe('number');
    await expect(saveRecipe({ sceneFile, name: 'Ember Title', intent: 'x', dir: lib })).rejects.toThrow(/already exists/);
    await expect(saveRecipe({ sceneFile, name: 'Ember Title', intent: 'again', dir: lib, overwrite: true })).resolves.toBeTruthy();
    await saveRecipe({ sceneFile, name: 'Ember Title', intent: 'A warm coffee-brand title with the logo above the headline', tags: ['title', 'coffee', 'logo'], params: { headline: 'The headline' }, dir: lib, overwrite: true });
  }, 60_000);

  it('lists and ranks by intent, tags and name', () => {
    const dirs = [lib, SHIPPED_RECIPES];
    expect(listRecipes('coffee title', { dirs })[0].name).toBe('ember-title');
    expect(listRecipes('lower third for an interview', { dirs })[0].name).toBe('lower-third');
    expect(listRecipes('bar chart', { dirs })[0].name).toBe('data-chart');
    expect(listRecipes('logo sting', { dirs })[0].name).toBe('logo-reveal');
    expect(listRecipes('zzzz qqqq', { dirs })).toEqual([]);
    expect(listRecipes(undefined, { dirs }).length).toBe(allRecipes(dirs).length);
    expect(() => findRecipe('ember titel', dirs)).toThrow(/did you mean "ember-title"/);
  });

  it('instantiates with new params and a new brand: an editable scene that compiles', async () => {
    const outFile = path.join(TMP, 'work', 'client-x-title.tsx');
    const r = await instantiateRecipe('ember-title', { outFile, params: { headline: 'CLIENT X', size: 120 }, brand: brand2, dirs: [lib] });
    expect(r.file).toBe(outFile);
    expect(r.sceneName).toBe('ClientXTitle');
    expect(r.check?.error).toBeUndefined();
    expect(r.check?.ok).toBe(true);
    const src = fs.readFileSync(outFile, 'utf8');
    expect(src).toMatch(/^\/\/ From recipe "ember-title"/);
    expect(src).toMatch(/import \{ CLIENT as BRAND \} from '\.\.\/clientx\/tokens\.ts'/);
    expect(src).toContain(`logo: './ember-title/assets/mark.svg'`);
    expect(fs.existsSync(path.join(TMP, 'work', 'ember-title', 'assets', 'mark.svg'))).toBe(true);
    expect(fs.existsSync(path.join(TMP, 'work', 'ember-title', 'brand.ts'))).toBe(false); // replaced by the new brand
    const def = await load(outFile);
    expect(def.config.name).toBe('ClientXTitle');
    expect(def.config.params).toMatchObject({ headline: 'CLIENT X', size: 120 });
    const ir = compileScene(def, { sceneFile: outFile }).ir;
    const text = ir.comps[0].layers.find((L: any) => /headline$/.test(L.id));
    expect(JSON.stringify(text)).toContain('CLIENT X');
    await expect(instantiateRecipe('ember-title', { outFile, dirs: [lib] })).rejects.toThrow(/exists/);
  }, 60_000);

  it('links instead of copying, warns on missing brand tokens, rejects bad params', async () => {
    const outFile = path.join(TMP, 'work2', 'linked.tsx');
    const r = await instantiateRecipe('ember-title', { outFile, deps: 'link', dirs: [lib], sceneName: 'Linked' });
    expect(r.copied).toEqual([]);
    expect(fs.readFileSync(outFile, 'utf8')).toMatch(/from '.*lib\/ember-title\/brand\.ts'/);
    expect(r.check?.ok).toBe(true);
    const r2 = await instantiateRecipe('ember-title', { outFile: path.join(TMP, 'work2', 'y.tsx'), brand: brand3, dirs: [lib], check: false });
    const lacks = r2.warnings.find((w) => /lacks tokens the recipe uses/.test(w)) ?? '';
    for (const t of ['colors.ink', 'colors.white', 'colors.accent', 'fonts.display']) expect(lacks).toContain(t);
    await expect(instantiateRecipe('ember-title', { outFile: path.join(TMP, 'work2', 'z.tsx'), params: { size: 'big' }, dirs: [lib] })).rejects.toThrow(/bad params/);
  }, 60_000);

  it('tool handlers report what they did', async () => {
    const saved = await saveRecipeTool({ sceneFile, name: 'Ember Copy', intent: 'Another coffee title', tags: ['coffee'], dir: lib });
    expect(saved).toMatch(/saved recipe "ember-copy"/);
    expect(listRecipesTool({ query: 'coffee', dirs: [lib] })).toMatch(/ember/);
    const made = await instantiateRecipeTool({ name: 'ember-copy', outFile: path.join(TMP, 'work3', 'e.tsx'), params: { headline: 'HELLO' }, dirs: [lib] });
    expect(made).toMatch(/compiles/);
    expect(made).toMatch(/next: build_scene/);
  }, 60_000);
});

describe('shipped recipes', () => {
  const shipped = allRecipes([SHIPPED_RECIPES]);
  it('there are six, each with an intent, tags and a scene', () => {
    expect(shipped.map((r) => r.name).sort()).toEqual(['data-chart', 'end-card', 'kinetic-title', 'logo-reveal', 'lower-third', 'product-promo']);
    for (const r of shipped) {
      expect(r.name).toBe(slugify(r.name));
      expect(r.intent.length).toBeGreaterThan(30);
      expect(r.tags.length).toBeGreaterThanOrEqual(4);
      expect(fs.existsSync(path.join(r.dir, r.scene))).toBe(true);
      for (const f of r.files) expect(fs.existsSync(path.join(r.dir, f))).toBe(true);
    }
  });
  for (const r of allRecipes([SHIPPED_RECIPES])) {
    it(`${r.name} loads, compiles, matches its manifest and instantiates`, async () => {
      const file = path.join(r.dir, r.scene);
      const def = await load(file);
      expect(def.config.name).toBe(r.sceneName);
      expect(Object.keys(def.config.params ?? {}).sort()).toEqual(Object.keys(r.params).sort());
      for (const [k, spec] of Object.entries(r.params)) expect((def.config.params as any)[k]).toEqual(spec.default);
      const { ir } = compileScene(def, { sceneFile: file });
      const main = ir.comps.find((c: any) => c.id === ir.main);
      expect(main.dur).toBeCloseTo(r.duration);
      // an instance with a changed text param builds too
      const textKey = Object.entries(r.params).find(([, s]) => s.type === 'string' && s.default)?.[0];
      const out = path.join(TMP, 'shipped', `${r.name}.tsx`);
      const inst = await instantiateRecipe(r.name, { outFile: out, params: textKey ? { [textKey]: 'NEW TEXT' } : {}, dirs: [SHIPPED_RECIPES] });
      expect(inst.check?.error).toBeUndefined();
      expect(inst.check?.ok).toBe(true);
      expect(inst.check?.controls.sort()).toEqual([...r.controls].sort());
    }, 60_000);
  }
});
