// patch_cols.js <payload.json>: the header and line columns a planned completion changes
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const gd = JSON.parse(p.rows.filter((r) => r.step_name.split("|")[2] === "GD").map((r) => r.result_ref).join(""));
const lineCols = {};
for (const l of gd.lines) for (const k of Object.keys(l)) if (k !== "id") lineCols[k] = (lineCols[k] || 0) + 1;
console.log(JSON.stringify({ header: Object.keys(gd.header), lines: lineCols }));
