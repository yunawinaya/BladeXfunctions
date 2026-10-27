// shake(code): a code node keeps its own tail ("// ---- this node" on) and the top-level declarations it reaches.
//   node scratchpad/sosave_perf/test/test_shake.mjs
import * as acorn from 'acorn';
import { shake } from '../shake.mjs';

let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + (detail || '')}`);
  if (!ok) fail++;
};
const parses = (code) => {
  try {
    acorn.parse(`(function () {\n${code.replace(/\{\{[^}]+\}\}/g, '__ph__')}\n})`, { ecmaVersion: 'latest' });
    return true;
  } catch (e) {
    return false;
  }
};

const LIB = `// SO Save V2 - shared helpers
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// a helper only another helper calls
const inner = (x) => s(x) + "!";
const outer = function outer(x) { return inner(x); };
// read only through typeof
const SO_LINE_NUMERIC = ["so_quantity"];
const numericCols = () => (typeof SO_LINE_NUMERIC !== "undefined" ? SO_LINE_NUMERIC : []);
const unused = function unused() { return "never called"; };
function hoisted(v) { return v * 2; }
const { pickA, pickB } = { pickA: 1, pickB: 2 };
`;
const TAIL = `// ---- this node
const res = outer([{{node:code_node_X.data}}][0]) + numericCols().length + hoisted({{workflowparams:n}}) + pickA;
console.log("tail", JSON.stringify(res));
return res;`;
const out = shake(LIB + TAIL);

check('keeps the tail verbatim, placeholders byte-exact', out.endsWith(TAIL), JSON.stringify(out.slice(-120)));
check('keeps a helper used only inside another kept helper (inner, s)', /const inner =/.test(out) && /const s =/.test(out));
check('keeps the helper the tail calls (outer)', /const outer = function outer/.test(out));
check('keeps a name used only in typeof (SO_LINE_NUMERIC)', /const SO_LINE_NUMERIC =/.test(out));
check('keeps a hoisted function declaration (hoisted)', /function hoisted\(/.test(out));
check('keeps a destructuring declaration one of whose names is used (pickA)', /const \{ pickA, pickB \}/.test(out));
check('drops an unused helper (unused)', !/unused/.test(out));
check('keeps the comment that leads a kept declaration', /\/\/ a helper only another helper calls\nconst inner/.test(out));
check('output parses', parses(out));
check('code without a "// ---- this node" tail is returned unchanged', shake('const a = 1;\nreturn a;') === 'const a = 1;\nreturn a;');
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
