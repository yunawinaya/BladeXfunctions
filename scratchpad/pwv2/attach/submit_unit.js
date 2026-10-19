// PUTAWAY_ASYNC_SUBMIT guard + post with request.ref_doc.  node attach/submit_unit.js
"use strict";
const fs = require("fs");
const path = require("path");
const body = (f) => fs.readFileSync(path.join(__dirname, "..", "code", "submit", f), "utf8").split("\nconst res = ")[0];
const fns = new Function(body("_common.js") + "\n" + body("guard.js") + "\n" + body("post.js") + "\nreturn { submitGuard, submitPost };")();
let pass = 0, fail = 0;
const ok = (c, what, x) => { if (c) pass++; else { fail++; console.log("FAIL", what, JSON.stringify(x).slice(0, 300)); } };
const base = { operation: "SUBMIT", toId: "2110625387005267969", key: "PWC:1:2:abc:1", tenantId: "000000", uid: "9", confirmedBy: "admin" };
const g = (req) => fns.submitGuard(Object.assign({}, base, { request: req }));
const file = { key: "a.jpeg", url: "https://x/a.jpeg", link: "https://x/a.jpeg", name: "a.jpeg" };

let r = g({ source: "MOBILE", lines: [{ id: "1", qty: 1 }] });
ok(r.route === "CONTINUE" && !("ref_doc" in r.request) && r.request.source === "MOBILE", "no ref_doc: request carries none", r);
r = g({ lines: [], ref_doc: [] });
ok(r.route === "CONTINUE" && Array.isArray(r.request.ref_doc) && r.request.ref_doc.length === 0, "ref_doc []: kept (clears the list)", r);
r = g({ lines: [], ref_doc: [file] });
ok(r.route === "CONTINUE" && r.request.ref_doc[0].url === file.url, "ref_doc [file]: passed through as sent", r);
r = g({ lines: [], ref_doc: null });
ok(r.route === "CONTINUE" && !("ref_doc" in r.request), "ref_doc null: treated as absent", r);
r = g(JSON.stringify({ lines: [], ref_doc: [file] }));
ok(r.route === "CONTINUE" && r.request.ref_doc.length === 1, "request as a JSON string: ref_doc read", r);
for (const [what, bad] of [["a string", "a.jpeg"], ["a number entry", [1]], ["a nested array", [[file]]], ["101 files", Array(101).fill(file)],
  ["over 200 KB", [Object.assign({}, file, { pad: "x".repeat(200001) })]]]) {
  r = g({ lines: [], ref_doc: bad });
  ok(r.route === "REJECT" && /ref_doc/.test(r.message), "ref_doc " + what + " -> REJECT", r);
}

const entry = { toNo: "TRF-1", grId: "5", organizationId: "7", plantId: "8", dbNow: "2026-10-16 10:00:00", lockN: 1 };
const go = { route: "GO", rowCount: 1 };
let p = fns.submitPost(g({ lines: [{ id: "1", qty: 1 }], ref_doc: [file] }), entry, go);
ok(p.route === "QUEUE" && p.needDoc === "YES" && p.docToId === base.toId && p.refDoc[0].url === file.url, "post: attachments -> written with the lock", p);
ok(!/ref_doc/.test(p.jobRows[0].request_payload), "post: the job payload stays lines only", p.jobRows[0].request_payload);
p = fns.submitPost(g({ lines: [{ id: "1", qty: 1 }] }), entry, go);
ok(p.needDoc === "NO" && p.docToId === "" && Array.isArray(p.refDoc) && p.refDoc.length === 0, "post: no attachments -> nothing written", p);
p = fns.submitPost(g({ lines: [{ id: "1", qty: 1 }], ref_doc: [] }), entry, go);
ok(p.needDoc === "YES" && p.refDoc.length === 0, "post: [] -> the list is cleared", p);
p = fns.submitPost(g({ lines: [], ref_doc: [file] }), entry, { route: "STOP", code: "400", message: "x" });
ok(p.route === "STOP" && p.needDoc === "NO", "post: a refused confirmation writes no attachments", p);
console.log("submit ref_doc unit: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
