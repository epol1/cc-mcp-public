// A3/A6 in AE: plan_scene turns a beat sheet into a scaffold that builds, and instantiate_recipe makes a new scene
// from a shipped recipe (new params) that builds; both undo in one step and lint.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planSceneTool } from '../../../src/plan/tool.ts';
import { instantiateRecipeTool, listRecipesTool } from '../../../src/recipes/tool.ts';
import { buildUndoCheck, check, done } from './harness.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-agenttools-'));

// plan_scene: a three-beat sheet with an end card → scaffold file → build.
const planFile = path.join(dir, 'planned.tsx');
const report = await planSceneTool({
  name: 'PlannedPiece', message: 'Small habits add up',
  beats: [
    { name: 'Hook', purpose: 'stop the scroll', duration: 2.6, text: 'One minute a day', transitionIn: 'cut' },
    { name: 'Proof', purpose: 'show it adds up', duration: 3.2, text: ['365 minutes a year', 'six hours of practice'], transitionIn: 'shape-wipe' },
  ],
  end: { text: 'Start today', hold: 2.5, transitionIn: 'light-leak' },
  file: planFile, cwd: dir,
} as any);
check('plan_scene writes a scaffold', fs.existsSync(planFile), report.slice(0, 300));
check('plan_scene reports the plan', /Hook|Proof/.test(report));
if (fs.existsSync(planFile)) await buildUndoCheck('planned scaffold build', planFile, 'PlannedPiece_v001', { frames: 0, motion: false });

// recipes: list, instantiate the lower third with new params, build.
const list = listRecipesTool({ query: 'lower third interview' });
check('list_recipes finds the lower third', /lower-third/.test(list), list.slice(0, 200));
const recipeFile = path.join(dir, 'lt.tsx');
const inst = await instantiateRecipeTool({ name: 'lower-third', params: { person: 'Maya Chen', role: 'HEAD OF PRODUCT' }, outFile: recipeFile, sceneName: 'MayaLowerThird', cwd: dir });
check('instantiate_recipe writes an editable scene', fs.existsSync(recipeFile) && /Maya Chen/.test(fs.readFileSync(recipeFile, 'utf8')), inst.slice(0, 300));
if (fs.existsSync(recipeFile)) await buildUndoCheck('recipe instance build', recipeFile, 'MayaLowerThird_v001', { frames: 0, motion: false });
done();
