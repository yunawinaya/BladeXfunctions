// Runs a code-node body the way the platform does: each {{kind:path}} placeholder is replaced by the JSON text of a
// supplied value (an expression), then the body runs as a function. Unknown placeholders fail loudly.
const fs = require("fs");
const path = require("path");

// copy of scratchpad/gdc/pkv2tools/harness.js (sim/test_flow.js requires it as ../harness); code root = scratchpad/smv2/code
const CODE = path.join(__dirname, "..", "code");

function runBody(body, values, label) {
  const src = body.replace(/\{\{([a-z]+):([^}]+)\}\}/g, (m, kind, p) => {
    const k = kind + ":" + p;
    if (!(k in values)) throw new Error("no value for " + k + " in " + label);
    const v = values[k];
    return v === undefined ? "undefined" : JSON.stringify(v);
  });
  const logs = [];
  const fn = new Function("console", src);
  const out = fn({ log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push("ERR " + a.join(" ")) });
  // the platform keeps only declared keys; tests read the full object and check declarations separately
  return JSON.parse(JSON.stringify(out));
}

function run(file, values) {
  return runBody(fs.readFileSync(path.join(CODE, file), "utf8"), values, file);
}

let fails = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + label + (ok ? "" : "\n     got  " + JSON.stringify(got).slice(0, 900) + "\n     want " + JSON.stringify(want).slice(0, 900)));
  return ok;
}
function truthy(label, cond, extra) {
  if (!cond) fails++;
  console.log((cond ? "ok   " : "FAIL ") + label + (cond || extra === undefined ? "" : "  " + JSON.stringify(extra).slice(0, 900)));
}
function done() {
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
}
// trace JSON stores snowflake ids as bare numbers; JSON.parse would round them, so they are read as text
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8").replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));

module.exports = { run, runBody, eq, truthy, done, fixture };
