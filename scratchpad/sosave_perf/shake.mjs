// Trim a code node's copy of the SO Save V2 shared library to what the node uses. The node's own tail ("// ---- this node"
// on) and every top-level statement that is not a declaration stay; a top-level declaration stays when kept code
// reaches its name. Names are matched anywhere in the kept code, nested functions included, so a shadowed name can keep a
// helper it does not need (over-keeping) but nothing used is dropped. Kept statements keep their leading comments; the
// text is otherwise the original. {{placeholders}} pass through byte-exact.
//
//   import { shake } from './shake.mjs'                       one code string
//   node scratchpad/sosave_perf/shake.mjs <in.json> <out.json>  every code node of a workflow, with a size report
import fs from 'node:fs';
import * as acorn from 'acorn';

const MARKER = '// ---- this node';
const PLACEHOLDER = /\{\{[^}]+\}\}/g;
const PH_NAME = /__PH_(\d+)__/g;
const DYNAMIC = /\beval\s*\(|new\s+Function\s*\(|globalThis|\bthis\s*\[|\bwindow\s*\[/;
const parse = (code) => acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, sourceType: 'script' });

// names a declaration statement introduces
const patternNames = (p, out) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((x) => patternNames(x.type === 'RestElement' ? x.argument : x.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((x) => patternNames(x, out));
  else if (p.type === 'RestElement') patternNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
  return out;
};
const declared = (st) => {
  if (st.type === 'VariableDeclaration') return st.declarations.flatMap((d) => patternNames(d.id, []));
  if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) return [st.id.name];
  return null; // not a declaration: always kept
};
// every identifier a subtree uses by name (property keys and member names are not uses)
const usedNames = (node, out = new Set()) => {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => usedNames(n, out)); return out; }
  if (node.type === 'Identifier') { out.add(node.name); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    if (k === 'property' && node.type === 'MemberExpression' && !node.computed) continue;
    if (k === 'key' && (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && !node.computed) continue;
    if (k === 'label') continue;
    if (v && typeof v === 'object') usedNames(v, out);
  }
  return out;
};

export function shake(code) {
  const tailAt = code.lastIndexOf(MARKER);
  if (tailAt < 0) return code;
  if (DYNAMIC.test(code)) throw new Error('shake: the code looks a name up dynamically; trimming by name is not safe');
  if (/__PH_\d+__/.test(code)) throw new Error('shake: the code already holds a __PH_n__ name');
  const phs = [];
  const swapped = code.replace(PLACEHOLDER, (m) => `__PH_${phs.push(m) - 1}__`);
  const markerAt = swapped.lastIndexOf(MARKER);
  const body = parse(swapped).body;
  const keep = body.map((st) => st.start >= markerAt || declared(st) === null);
  const needed = new Set();
  body.forEach((st, i) => { if (keep[i]) usedNames(st, needed); });
  for (let grew = true; grew; ) {
    grew = false;
    body.forEach((st, i) => {
      if (keep[i]) return;
      if (declared(st).some((name) => needed.has(name))) {
        keep[i] = true;
        usedNames(st, needed);
        grew = true;
      }
    });
  }
  // each kept statement with the text since the previous statement ended (its leading comments)
  let out = '';
  let prevEnd = 0;
  body.forEach((st, i) => {
    if (keep[i]) out += swapped.slice(prevEnd, st.end);
    prevEnd = st.end;
  });
  out += swapped.slice(prevEnd);
  parse(out); // still one valid program
  return out.replace(PH_NAME, (m, i) => phs[Number(i)]);
}

// CLI: every code node of a workflow document
if (process.argv[1] && new URL(import.meta.url).pathname === fs.realpathSync(process.argv[1])) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error('usage: node shake.mjs <in.json> <out.json>');
    process.exit(2);
  }
  const doc = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  let before = 0;
  let after = 0;
  let nodes = 0;
  const walk = (ns) => ns.forEach((n) => {
    if (n.type === 'code-node' && n.data && n.data.script && typeof n.data.script.code === 'string') {
      const c = n.data.script.code;
      const t = shake(c);
      before += c.length;
      after += t.length;
      if (t !== c) nodes++;
      n.data.script.code = t;
    }
    walk(n.blocks || []);
  });
  walk(doc.nodes);
  fs.writeFileSync(outFile, JSON.stringify(doc));
  console.log(`${inFile.split('/').pop()}: ${nodes} code nodes trimmed, code ${before} -> ${after} chars (${(100 * after / Math.max(1, before)).toFixed(1)}%)`);
}
