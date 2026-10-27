// Every trimmed code node of the SO Save V2 workflows (out/preshake/ against out/):
// - each name it uses is declared in it or is a known global, and the trim made no name free that was not free before it;
// - no top-level declaration the trim dropped is used anywhere in the kept code (the free-name check is scope-blind: a local
//   of the same name hides a dropped helper from it);
// - the kept top-level statements are the untrimmed node's, verbatim and in order;
// - it does not claim to hold every shared helper.
// build.py runs it after the trim and refuses the build when it fails.
//   node scratchpad/sosave_perf/test/check_free.mjs [<dir holding preshake/ and the trimmed workflows>]
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

const OUT = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'out');
const ALL_HELPERS = 'included at the top of every code node';
const GLOBALS = new Set(['JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'Set', 'Map',
  'Promise', 'console', 'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'undefined', 'NaN',
  'Infinity']);
const WORKFLOWS = ['SO_SAVE_SUBMIT', 'SO_SAVE_WORKER', 'SO_SAVE_PREPARE', 'SO_SAVE_COMMIT', 'SO_SAVE_RUN'];

const names = (p, out) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((x) => names(x.type === 'RestElement' ? x.argument : x.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((x) => names(x, out));
  else if (p.type === 'RestElement') names(p.argument, out);
  else if (p.type === 'AssignmentPattern') names(p.left, out);
  return out;
};
const parse = (code) => acorn.parse(code.replace(/\{\{[^}]+\}\}/g, '__PH__'), { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
// declared anywhere (scope-blind) and used anywhere: a name is free when it is used and declared nowhere
const freeNames = (code) => {
  const ast = parse(code);
  const declared = new Set();
  const used = new Set();
  const walk = (n, parentKey, parent) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, parentKey, parent));
    if (n.type === 'VariableDeclarator') names(n.id, declared);
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) declared.add(n.id.name);
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') n.params.forEach((p) => names(p, declared));
    if (n.type === 'CatchClause' && n.param) names(n.param, declared);
    if (n.type === 'Identifier') {
      used.add(n.name);
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      if (k === 'property' && n.type === 'MemberExpression' && !n.computed) continue;
      if (k === 'key' && (n.type === 'Property' || n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') && !n.computed) continue;
      if (k === 'label') continue;
      if (v && typeof v === 'object') walk(v, k, n);
    }
  };
  walk(ast);
  return [...used].filter((x) => !declared.has(x) && x !== '__PH__');
};
// every name used anywhere in the code, nested scopes included (property keys and member names are not uses)
const usedAnywhere = (node, out = new Set()) => {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((x) => usedAnywhere(x, out)); return out; }
  if (node.type === 'Identifier') { out.add(node.name); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    if (k === 'property' && node.type === 'MemberExpression' && !node.computed) continue;
    if (k === 'key' && (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && !node.computed) continue;
    if (k === 'label') continue;
    if (v && typeof v === 'object') usedAnywhere(v, out);
  }
  return out;
};
const topDeclared = (body) => body.flatMap((st) => {
  if (st.type === 'VariableDeclaration') return st.declarations.flatMap((d) => [...names(d.id, new Set())]);
  if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) return [st.id.name];
  return [];
});
// the trim's own promises, beyond the free names
const trimProblems = (pre, fin) => {
  const problems = [];
  const preAst = parse(pre);
  const finAst = parse(fin);
  const kept = new Set(topDeclared(finAst.body));
  const used = usedAnywhere(finAst);
  const dropped = topDeclared(preAst.body).filter((x) => !kept.has(x) && used.has(x));
  if (dropped.length) problems.push(`dropped but used ${JSON.stringify([...new Set(dropped)])}`);
  const preText = preAst.body.map((st) => pre.replace(/\{\{[^}]+\}\}/g, '__PH__').slice(st.start, st.end));
  const finSrc = fin.replace(/\{\{[^}]+\}\}/g, '__PH__');
  let at = 0;
  for (const st of finAst.body) {
    const t = finSrc.slice(st.start, st.end);
    while (at < preText.length && preText[at] !== t) at++;
    if (at === preText.length) {
      problems.push(`a kept statement is not the untrimmed node's, in order: ${JSON.stringify(t.slice(0, 80))}`);
      break;
    }
    at++;
  }
  if (fin !== pre && fin.includes(ALL_HELPERS)) problems.push(`still says "${ALL_HELPERS}"`);
  return problems;
};
const codeNodes = (file) => {
  const out = {};
  const walk = (ns) => ns.forEach((n) => { if (n.type === 'code-node') out[n.id] = n.data.script.code; walk(n.blocks || []); });
  walk(JSON.parse(fs.readFileSync(file, 'utf8')).nodes);
  return out;
};

let fail = 0;
let checked = 0;
for (const w of WORKFLOWS) {
  const pre = codeNodes(path.join(OUT, 'preshake', w + '.json'));
  const fin = codeNodes(path.join(OUT, w + '.json'));
  for (const [id, code] of Object.entries(fin)) {
    checked++;
    const free = freeNames(code);
    const before = new Set(freeNames(pre[id]));
    const unknown = free.filter((x) => !GLOBALS.has(x));
    const newlyFree = free.filter((x) => !before.has(x));
    const problems = trimProblems(pre[id], code);
    if (unknown.length || newlyFree.length) problems.unshift(`not a known global ${JSON.stringify(unknown)}; free only after the trim ${JSON.stringify(newlyFree)}`);
    if (problems.length) {
      fail++;
      console.log(`FAIL ${w} ${id}: ${problems.join('; ')}`);
    }
  }
}
console.log(fail ? `${fail} of ${checked} code nodes FAILED`
  : `all ${checked} trimmed code nodes: every name declared or a known global, none newly free, no used helper dropped, kept statements verbatim`);
process.exit(fail ? 1 : 0);
