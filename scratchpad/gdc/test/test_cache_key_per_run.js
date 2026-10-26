// test_cache_key_per_run.js: every node that names a run's Redis key gives two runs of one user in the same second different
// keys (10-27; GD-2610-2093's auto-SI reported 2094's invoice when both runs named 'GD_CONVERT_SI:<uid>:<date>:155817').
// Runs each naming node's own code twice in one tick. usage: node test_cache_key_per_run.js [workflow.json ...]
// (the three patched repo workflows by default; their versions before the patch fail the "different keys" cases.
// SI_POST is out of scope, user 10-27: left as it is)
const fs = require("fs");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const files = process.argv.slice(2).length ? process.argv.slice(2) : ["Sales Invoice/GDconvertSIworkflow.json", "Sales Invoice/SOconvertSIworkflow.json", "Purchase Invoice/convertPOtoPIworkflow.json"].map((f) => R + f);
const TIME = "const time = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS";
const nodes = (o, out = []) => {
  if (Array.isArray(o)) o.forEach((v) => nodes(v, out));
  else if (o && typeof o === "object") {
    const c = o.data && o.data.script && o.data.script.code;
    if (typeof c === "string" && c.indexOf(TIME) >= 0) out.push(o);
    Object.values(o).forEach((v) => nodes(v, out));
  }
  return out;
};
const UID = "2006752085990985729";
let fails = 0, count = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 300))); if (!ok) fails += 1; };
for (const f of files) {
  const found = nodes(JSON.parse(fs.readFileSync(f, "utf8")));
  t(f.replace(R, "") + ": has a key-naming node", found.length > 0, found.length);
  for (const n of found) {
    const fn = new Function(n.data.script.code.split("{{system:uid}}").join(JSON.stringify(UID)));
    let a, b;
    do { a = fn(); b = fn(); } while (a.redis_name.split(":")[3] !== b.redis_name.split(":")[3]);
    count += 1;
    const label = f.replace(R, "") + " " + n.id;
    t(label + ": two runs in the same second get different keys", a.redis_name !== b.redis_name, [a.redis_name, b.redis_name]);
    t(label + ": the name keeps <PREFIX>:<uid>:<date>:<HHMMSS> and adds the tag", new RegExp("^[A-Za-z_]+:" + UID + ":\\d{4}-\\d{2}-\\d{2}:\\d{6}:[a-z0-9]{1,8}$").test(a.redis_name), a.redis_name);
    const rest = (o) => JSON.stringify(Object.assign({}, o, { redis_name: undefined }));
    t(label + ": nothing else in the node's answer changes", rest(a) === rest(b), [rest(a), rest(b)]);
  }
}
console.log(count + " naming nodes; " + (fails ? fails + " FAILED" : "all passed"));
process.exitCode = fails ? 1 : 0;
