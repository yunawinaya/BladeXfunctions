// test_cf_header.js: lib/cf_header.js - headerCustomFields(v), the one helper every copier inlines.
// Run: node scratchpad/salescf/test/test_cf_header.js
const fs = require("fs"), assert = require("assert"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "cf_header.js"), "utf8");
const logs = [];
const load = () => new Function("console", SRC + "\nreturn headerCustomFields;")({ log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) });
const headerCustomFields = load();
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

const o = { a: 1 };
assert.strictEqual(headerCustomFields(o), o);
ok("obj_kept: an object comes back as the same object");

assert.deepStrictEqual(headerCustomFields('{"a":false}'), { a: false });
ok("text_parsed: JSON text is parsed, false kept");

logs.length = 0;
assert.deepStrictEqual(headerCustomFields("{"), {});
assert.strictEqual(logs.length, 1, "one log line for invalid text: " + JSON.stringify(logs));
ok("invalid_text_empty: invalid text gives {} and one log line");

for (const v of [null, undefined, "", "   ", [], 5, true, "[1,2]", "null"]) assert.deepStrictEqual(headerCustomFields(v), {}, JSON.stringify(v));
ok("null_empty: null / undefined / empty / array / scalar / JSON non-object give {}");

assert.deepStrictEqual(headerCustomFields({ lsh_envelope: false, lsh_restday: "", n: 0 }), { lsh_envelope: false, lsh_restday: "", n: 0 });
ok("false_kept: false, empty string and 0 are values");

console.log(n + " passed");
