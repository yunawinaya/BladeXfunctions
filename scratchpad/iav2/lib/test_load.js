// loads a COMMIT step body as a module: _common + _cmp + (extras) + the step file without its platform tail (the lines
// from "const res = " / "const guard = " / "const e = " / "const eng = " / "const si = " on)
// Copy of scratchpad/grv2/test_commit/load.js; changes: the code root is scratchpad/smv2/code (or $V2_CODE_DIR), and
// load.strip / load.root are exported for other step folders.
const fs = require("fs");
const path = require("path");
const C = process.env.V2_CODE_DIR || path.join(__dirname, "..", "code");
const strip = (t) => {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /^const (res|guard|e|eng|si) = /.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join("\n");
};
function load(file, names, extras) {
  const parts = [fs.readFileSync(path.join(C, "commit/_common.js"), "utf8"), fs.readFileSync(path.join(C, "commit/_cmp.js"), "utf8")];
  for (const x of extras || []) parts.push(fs.readFileSync(path.join(C, x), "utf8"));
  parts.push(strip(fs.readFileSync(path.join(C, "commit", file), "utf8")));
  const src = parts.join("\n") + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(file + ": a platform token is left in the loaded body");
  return new Function(src)();
}
load.strip = strip;
load.root = C;
module.exports = load;
