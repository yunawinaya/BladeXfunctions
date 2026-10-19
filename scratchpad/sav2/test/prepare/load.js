// Loads the code-node sources of package A the way build_prepare.py concatenates them (a shared file loses its trailing
// "if (typeof module ..." export statement, however many lines it spans) and returns the named functions.
// load(["lib/lift/runtime.js", "code/shared/sa_common.js", ...], ["saReviewChain", ...]) -> { saReviewChain, ... }
const fs = require("fs");
const path = require("path");

const SAV2 = path.join(__dirname, "..", "..");
const strip = (text) => {
  const i = text.indexOf("\nif (typeof module");
  return (i >= 0 ? text.slice(0, i) : text).replace(/\s+$/, "");
};
const src = (rel) => strip(fs.readFileSync(path.join(SAV2, rel), "utf8"));
function load(files, names) {
  const body = files.map(src).join("\n") + "\nreturn { " + names.join(", ") + " };";
  return new Function(body)();
}
// trace JSON (su_code_workflow_inst) prints Java Longs as bare numbers; a code node received bigint ids as digit strings
const J = (text) => JSON.parse(String(text).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
module.exports = { load, src, strip, J, SAV2 };
