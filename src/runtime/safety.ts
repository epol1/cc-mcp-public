// Fences around AE APIs that crash After Effects 26.5 when touched from scripts (D15).
// Never read/write values of these; inspector skips them, gradients go through .ffx/.aepx.

const CRASHY: { [mn: string]: boolean } = {
  'ADBE Vector Grad Colors': true,
};
// Groups whose sub-properties we never descend into for values (shape gradient fill/stroke).
const CRASHY_PARENTS: { [mn: string]: boolean } = {
  'ADBE Vector Graphic - G-Fill': true,
  'ADBE Vector Graphic - G-Stroke': true,
};

export function isCrashy(matchName: string): boolean {
  return CRASHY[matchName] === true;
}

export function isCrashyParent(matchName: string): boolean {
  return CRASHY_PARENTS[matchName] === true;
}

/** Value types whose `.value` must not be read or written from scripts. */
export function isOpaqueValueType(vt: PropertyValueType): boolean {
  return vt === PropertyValueType.CUSTOM_VALUE || vt === PropertyValueType.NO_VALUE;
}
