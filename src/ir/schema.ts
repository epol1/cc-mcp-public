// IR schema (GOAL §4.2): the contract between the Node compiler and the ES3 runtime. Every IR is validated here
// before it is sent to After Effects, so malformed input fails in Node with a path ("comps[1].layers[4].props[0].keys[2].t")
// instead of half-building a comp. Unknown extra fields are allowed (forward compatible), known ones are typed.
// The TypeScript shapes the runtime consumes live in src/runtime/{build,layers,groups,keys}.ts.
import { z } from 'zod';

const num = z.number().finite();
const vec = z.array(num);
const color = z.array(num).min(3).max(4);

export const IrEase = z.object({ speed: num, influence: num.min(0).max(100) });

export const IrKey = z.object({
  t: num,
  v: z.any(),
  i: z.enum(['bezier', 'linear', 'hold']).optional(),
  o: z.enum(['bezier', 'linear', 'hold']).optional(),
  ie: z.array(IrEase).optional(),
  oe: z.array(IrEase).optional(),
  tc: z.boolean().optional(),
  sp: z.object({ ti: vec.optional(), to: vec.optional(), cont: z.boolean().optional(), auto: z.boolean().optional() }).passthrough().optional(),
  rov: z.boolean().optional(),
  label: z.number().int().optional(),
}).passthrough();

const PropBase = z.object({
  p: z.string().min(1),
  v: z.any().optional(),
  keys: z.array(IrKey).optional(),
  expr: z.string().optional(),
  sep: z.boolean().optional(),
  rel: z.array(z.number().int().min(0).max(2)).optional(),
  enabled: z.boolean().optional(),
}).passthrough();
const keysIncrease = (s: { keys?: { t: number }[] }, ctx: z.RefinementCtx) => {
  if (s.keys) for (let k = 1; k < s.keys.length; k++) if (s.keys[k].t < s.keys[k - 1].t - 1e-9) ctx.addIssue({ code: 'custom', path: ['keys', k, 't'], message: `key times must not decrease (${s.keys[k - 1].t} → ${s.keys[k].t})` });
};
export const PropSpec = PropBase.superRefine(keysIncrease);
/** GroupSpec.set: the added item is itself the property, so it has no path. */
const SetSpec = PropBase.extend({ p: z.string().optional() }).superRefine(keysIncrease);

export type GroupSpecT = { mn: string; name?: string; attrs?: Record<string, any>; props?: z.infer<typeof PropSpec>[]; set?: z.infer<typeof SetSpec>; kids?: { at: string; items: GroupSpecT[] }[]; menu?: string[]; ffx?: string; id?: string };
export const GroupSpec: z.ZodType<GroupSpecT> = z.lazy(() => z.object({
  mn: z.string().min(1),
  name: z.string().optional(),
  attrs: z.record(z.string(), z.any()).optional(),
  props: z.array(PropSpec).optional(),
  set: SetSpec.optional(),
  kids: z.array(z.object({ at: z.string(), items: z.array(GroupSpec) })).optional(),
  menu: z.array(z.string()).optional(),
  ffx: z.string().optional(),
  id: z.string().optional(),
}).passthrough()) as any;

export const LAYER_TYPES = ['solid', 'null', 'text', 'shape', 'adjustment', 'footage', 'precomp', 'camera', 'light', 'model'] as const;

export const IrLayer = z.object({
  id: z.string().min(1),
  type: z.enum(LAYER_TYPES),
  name: z.string(),
  in: num.optional(), out: num.optional(), start: num.optional(), stretch: num.optional(),
  parent: z.string().optional(),
  threeD: z.boolean().optional(),
  blend: z.string().optional(),
  solid: z.object({ color: color, w: num.optional(), h: num.optional() }).passthrough().optional(),
  text: z.object({ text: z.string() }).passthrough().optional(),
  footage: z.object({ asset: z.string() }).optional(),
  precomp: z.object({ comp: z.string() }).optional(),
  light: z.object({ kind: z.enum(['parallel', 'spot', 'point', 'ambient', 'environment']), source: z.string().optional() }).passthrough().optional(),
  groups: z.array(z.object({ at: z.string(), items: z.array(GroupSpec) })).optional(),
  props: z.array(PropSpec).optional(),
  matte: z.object({ layer: z.string(), type: z.enum(['alpha', 'alphaInverted', 'luma', 'lumaInverted']), showSource: z.boolean().optional() }).optional(),
  markers: z.array(z.object({ t: num, comment: z.string().optional(), dur: num.optional() }).passthrough()).optional(),
  anchorBox: z.array(num).length(2).optional(),
}).passthrough().superRefine((L, ctx) => {
  if (L.in !== undefined && L.out !== undefined && L.out <= L.in) ctx.addIssue({ code: 'custom', path: ['out'], message: `out (${L.out}) must be after in (${L.in})` });
  if (L.type === 'text' && !L.text) ctx.addIssue({ code: 'custom', path: ['text'], message: 'text layers need a text document' });
  if (L.type === 'footage' && !L.footage) ctx.addIssue({ code: 'custom', path: ['footage'], message: 'footage layers need footage.asset' });
  if (L.type === 'precomp' && !L.precomp) ctx.addIssue({ code: 'custom', path: ['precomp'], message: 'precomp layers need precomp.comp' });
});

export const IrComp = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  w: z.number().int().min(4).max(30000), h: z.number().int().min(4).max(30000),
  fps: num.min(1).max(999), dur: num.positive(),
  bg: color.optional(),
  renderer: z.string().optional(),
  part: z.boolean().optional(),
  layers: z.array(IrLayer),
  markers: z.array(z.object({ t: num, comment: z.string().optional(), dur: num.optional() }).passthrough()).optional(),
}).passthrough();

export const IrAsset = z.object({ id: z.string().min(1), path: z.string().optional(), item: z.string().optional() }).passthrough()
  .refine((a) => !!a.path || !!a.item, 'an asset needs a path or a project item name');

export const IrProject = z.object({
  irVersion: z.literal(1),
  scene: z.string().min(1),
  main: z.string().optional(),
  assets: z.array(IrAsset).optional(),
  comps: z.array(IrComp).min(1),
}).passthrough().superRefine((p, ctx) => {
  // Cross references: layer ids unique per comp, parents/mattes/precomps/assets exist, precomps come first.
  const assetIds = new Set((p.assets ?? []).map((a) => a.id));
  const seenComps = new Set<string>();
  p.comps.forEach((c, ci) => {
    const ids = new Set<string>();
    c.layers.forEach((L, li) => {
      if (ids.has(L.id)) ctx.addIssue({ code: 'custom', path: ['comps', ci, 'layers', li, 'id'], message: `duplicate layer id "${L.id}" in comp "${c.id}"` });
      ids.add(L.id);
    });
    c.layers.forEach((L, li) => {
      const at = ['comps', ci, 'layers', li];
      if (L.parent && !ids.has(L.parent)) ctx.addIssue({ code: 'custom', path: [...at, 'parent'], message: `parent "${L.parent}" is not a layer of comp "${c.id}"` });
      if (L.matte && !ids.has(L.matte.layer)) ctx.addIssue({ code: 'custom', path: [...at, 'matte', 'layer'], message: `matte layer "${L.matte.layer}" is not in comp "${c.id}"` });
      if (L.footage && !assetIds.has(L.footage.asset)) ctx.addIssue({ code: 'custom', path: [...at, 'footage', 'asset'], message: `asset "${L.footage.asset}" is not declared in assets` });
      // A precomp may also reference a comp built by an earlier request (variants → Compare), so only flag
      // references to comps of THIS IR that come later.
      if (L.precomp && !seenComps.has(L.precomp.comp) && p.comps.slice(ci).some((x) => x.id === L.precomp!.comp)) ctx.addIssue({ code: 'custom', path: [...at, 'precomp', 'comp'], message: `precomp "${L.precomp.comp}" must be listed before comp "${c.id}"` });
    });
    seenComps.add(c.id);
  });
  if (p.main && !p.comps.some((c) => c.id === p.main)) ctx.addIssue({ code: 'custom', path: ['main'], message: `main comp "${p.main}" is not in comps` });
});

export type IrProjectT = z.infer<typeof IrProject>;

/** Validates an IR; throws one readable error listing every problem with its path. */
export function validateIr(ir: unknown): IrProjectT {
  const r = IrProject.safeParse(ir);
  if (r.success) return r.data;
  const lines = r.error.issues.slice(0, 12).map((i) => `  ${i.path.map((x) => (typeof x === 'number' ? `[${x}]` : `.${String(x)}`)).join('').replace(/^\./, '')}: ${i.message}`);
  throw new Error(`invalid IR (${r.error.issues.length} problem${r.error.issues.length > 1 ? 's' : ''}):\n${lines.join('\n')}${r.error.issues.length > 12 ? '\n  …' : ''}`);
}
