// Babel options that lower TS to ES3 for ExtendScript (docs/research/toolchain.md §6.3).
import es3Guard from './babel-plugin-es3-guard.mjs';

export const es3BabelOptions = {
  babelrc: false,
  configFile: false,
  targets: 'ie 8', // required on Babel 8; IE<9 turns on the ES3 literal/reserved-word transforms
  assumptions: {
    setClassMethods: true, setPublicClassFields: true, setSpreadProperties: true,
    iterableIsArray: true, noClassCalls: true, superIsCallableConstructor: true, constantSuper: true,
    skipForOfIteratorClosing: true, noDocumentAll: true, ignoreFunctionLength: true, noNewArrows: true,
  },
  plugins: [es3Guard],
  presets: [
    ['@babel/preset-env', {
      modules: false,
      include: ['transform-member-expression-literals', 'transform-property-literals', 'transform-reserved-words'],
      exclude: ['transform-typeof-symbol', 'transform-regenerator', 'transform-async-to-generator', 'transform-async-generator-functions'],
    }],
    ['@babel/preset-typescript', {}],
  ],
};
