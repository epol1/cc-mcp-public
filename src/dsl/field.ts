// Instance fields (P1): field("Card Color", "#4683c4") marks a property inside a cloner's master (or any precomp)
// as an Essential Graphics property of that comp. Every instance of the comp then carries it under Essential
// Properties, so instances can differ (cloner `data`, color effectors) while the master stays one editable comp.
export interface FieldRef<T = any> { $field: true; name: string; value: T }

export function field<T>(name: string, value: T): FieldRef<T> {
  if (!name || /[/]/.test(name)) throw new Error(`field(name, value): a name without "/" is required (got "${name}")`);
  return { $field: true, name, value };
}

export function isField(x: any): x is FieldRef {
  return !!x && typeof x === 'object' && x.$field === true;
}
