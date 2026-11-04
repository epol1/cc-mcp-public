// 3D renderer feature table — from AE 26.5's own Composition Settings strings (RendererEnabled*/Disabled*),
// verified by rendering (D36/D37). The compiler picks a renderer when unset and fails clearly when a scene
// uses something the chosen renderer can't do.
export type RendererKey = 'classic3d' | 'cinema4d' | 'advanced3d';
export const RENDERER_ID: Record<RendererKey, string> = { advanced3d: 'ADBE Calder', cinema4d: 'ADBE Ernst', classic3d: 'ADBE Advanced 3d' };
export const RENDERER_NAME: Record<string, string> = { 'ADBE Calder': 'Advanced 3D', 'ADBE Ernst': 'Cinema 4D', 'ADBE Advanced 3d': 'Classic 3D' };

export type Feature =
  | 'extrusion' | 'models' | 'environmentLight' | 'dof' | 'motionBlur' | 'lightTransmission'
  | 'effectsOn3DVector' | 'pointLightShadows' | 'curvedFootage' | 'pbrMaterials';

export const SUPPORTS: Record<RendererKey, Record<Feature, boolean>> = {
  classic3d: { extrusion: false, models: false, environmentLight: false, dof: true, motionBlur: true, lightTransmission: true, effectsOn3DVector: true, pointLightShadows: true, curvedFootage: false, pbrMaterials: false },
  cinema4d: { extrusion: true, models: false, environmentLight: false, dof: false, motionBlur: false, lightTransmission: false, effectsOn3DVector: false, pointLightShadows: true, curvedFootage: true, pbrMaterials: false },
  advanced3d: { extrusion: true, models: true, environmentLight: true, dof: true, motionBlur: false, lightTransmission: false, effectsOn3DVector: false, pointLightShadows: false, curvedFootage: true, pbrMaterials: true },
};

const DESC: Record<Feature, string> = {
  extrusion: 'extruded/beveled 3D text or shapes', models: '3D model layers (glTF/GLB/OBJ)', environmentLight: 'environment (HDRI) lights',
  dof: 'camera depth of field', motionBlur: 'motion blur', lightTransmission: 'light transmission',
  effectsOn3DVector: 'effects/masks/mattes/blend modes on 3D text, shape or model layers', pointLightShadows: 'shadows from point/ambient lights',
  curvedFootage: 'curved footage planes', pbrMaterials: 'PBR materials (metal, reflection, IOR)',
};

/** Hard requirements stop the build; soft ones (motion blur, DOF, shadows) become warnings. */
const HARD: Feature[] = ['extrusion', 'models', 'environmentLight', 'effectsOn3DVector', 'curvedFootage'];

export function chooseRenderer(used: Set<Feature>, requested?: RendererKey): { key: RendererKey; errors: string[]; warnings: string[]; auto: boolean } {
  const errors: string[] = [], warnings: string[] = [];
  let key = requested;
  let auto = false;
  if (!key) {
    auto = true;
    const needsAdv = used.has('models') || used.has('environmentLight') || used.has('pbrMaterials');
    if (needsAdv || used.has('extrusion') || used.has('curvedFootage')) key = 'advanced3d';
    else key = 'classic3d';
  }
  for (const f of used) {
    if (SUPPORTS[key][f]) continue;
    const alts = (Object.keys(SUPPORTS) as RendererKey[]).filter((k) => SUPPORTS[k][f]);
    const msg = `${DESC[f]} not supported by the ${RENDERER_NAME[RENDERER_ID[key]]} renderer${alts.length ? ` (supported by: ${alts.map((a) => RENDERER_NAME[RENDERER_ID[a]]).join(', ')})` : ''}`;
    if (HARD.includes(f)) errors.push(msg + (f === 'effectsOn3DVector' ? '. Put the effect on an adjustment layer above, or precompose the 3D layers.' : `. Set renderer: "${alts[0] ?? 'advanced3d'}".`));
    else warnings.push(msg + ' — it will be ignored');
  }
  return { key, errors, warnings, auto };
}
