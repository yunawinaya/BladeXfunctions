// expected_fp (IA1) of IA-2610-023 as the IA form computes it (tr_main.js trFp), from the stored rows
const fs = require("fs");
const path = require("path");
const SHARED = path.join(process.argv[2], "scratchpad/iatr/code/shared");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const src = strip(fs.readFileSync(path.join(SHARED, "iatr_rules.js"), "utf8")) + "\n" + strip(fs.readFileSync(path.join(SHARED, "iatr_ia.js"), "utf8"));
const api = new Function(src + "\nreturn { iatrIaFp, iatrBasis };")();
const head = JSON.parse(process.argv[3]);
const lines = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
console.log(api.iatrIaFp(api.iatrBasis(head), lines));
