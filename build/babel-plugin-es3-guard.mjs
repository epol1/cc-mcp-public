// Fails the build on constructs that cannot run in ExtendScript (ES3). See docs/research/toolchain.md §6.4.
export default function es3Guard() {
  const fail = (path, what) => { throw path.buildCodeFrameError(`ES3/ExtendScript: ${what} is not supported`); };
  const checks = {
    'ClassMethod|ObjectMethod|ClassPrivateMethod|ClassAccessorProperty'(path) {
      const k = path.node.kind;
      if (k === 'get' || k === 'set' || path.isClassAccessorProperty()) fail(path, 'getter/setter/accessor');
    },
    Function(path) {
      if (path.node.generator) fail(path, 'generator');
      if (path.node.async) fail(path, 'async function');
    },
    RestElement(path) {
      if (path.parentPath.isObjectPattern()) fail(path, 'object rest destructuring');
    },
    TaggedTemplateExpression(path) { fail(path, 'tagged template'); },
  };
  return { name: 'es3-guard', visitor: { Program: { enter(path) { path.traverse(checks); } } } };
}
