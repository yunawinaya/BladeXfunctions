// Setting page (1909260299874861057): the Item Assembly Setup tile (RESERVED_REQUEST_PLAN.md Task 2 addendum 2) - one tile appended
// last in the Picking / Putaway / Packing card, opening the Item Assembly Setup page (2115734457942458370) as Picking Setup does;
// the output minus that tile and its event == the pinned v87.
//   node scratchpad/iatr/test/test_setting_tile.js
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const H = require(path.join(REPO, "scratchpad", "smv2", "lib", "harness.js"));
const base = JSON.parse(fs.readFileSync(path.join(REPO, "scratchpad", "iatr", "base", "rr_SETTING_v87.json"), "utf8"));
const outPath = path.join(REPO, "Item Assembly & BOM", "Setup", "SettingPage.json");
if (!fs.existsSync(outPath)) {
  console.log("FAIL the Setting page build is missing: " + outPath);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(outPath, "utf8"));
const find = (n, key) => {
  if (Array.isArray(n)) {
    for (const v of n) {
      const r = find(v, key);
      if (r) return r;
    }
  } else if (n && typeof n === "object") {
    if (n.key === key) return n;
    for (const v of Object.values(n)) {
      const r = find(v, key);
      if (r) return r;
    }
  }
  return null;
};
const keysOf = (d) => {
  const ks = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.key === "string" && n.type) ks.push(n.key);
      Object.values(n).forEach(walk);
    }
  };
  walk(d.list);
  return ks.concat(d.config.eventScript.map((e) => e.key));
};

const row = find(out.list, "ndvvfxls");
const baseRow = find(base.list, "ndvvfxls");
H.eq("the card row keeps its tiles in order and gains one, last", row.list.slice(0, -1).map((c) => c.key), baseRow.list.map((c) => c.key));
const tile = row.list[row.list.length - 1];
H.eq("  the new tile is a 120px flex holding one html card", [tile.type, tile.options.width, tile.list.length, tile.list[0].type], ["flex", "120px", 1, "html"]);
const html = tile.list[0];
H.eq("  its card reads Item Assembly Setup, with a lucide icon", [/<p>Item Assembly Setup<\/p>/.test(html.options.defaultValue), /api\.iconify\.design\/lucide\/boxes\.svg/.test(html.options.defaultValue)], [true, true]);
H.eq("  model / remoteFunc / remoteOption follow each key", [tile.model, tile.options.remoteFunc, tile.options.remoteOption, html.model, html.options.remoteFunc, html.options.remoteOption],
  ["flex_" + tile.key, "func_" + tile.key, "option_" + tile.key, "html_" + html.key, "func_" + html.key, "option_" + html.key]);
const ev = out.config.eventScript.filter((e) => e.key === tile.events.onClick)[0];
H.eq("the tile's click is bound by key to onClick_item_assembly_setup", ev && ev.name, "onClick_item_assembly_setup");
H.eq("  it opens the Item Assembly Setup page as a dialog, as Picking Setup does", ev && [/routeMode:\s*"dialog"/.test(ev.func), /source_id:\s*"2115734457942458370"/.test(ev.func), /this\.routeLocation\(/.test(ev.func), ev.type], [true, true, true, "js"]);
const ks = keysOf(out);
H.eq("every widget and event key is unique, the new ones 8 characters", [ks.length === new Set(ks).size, [tile.key, html.key, ev && ev.key].every((k) => /^[a-z0-9]{8}$/.test(k || ""))], [true, true]);
const strip = JSON.parse(JSON.stringify(out));
const r2 = find(strip.list, "ndvvfxls");
r2.list.pop();
strip.config.eventScript = strip.config.eventScript.filter((e) => e.key !== tile.events.onClick);
H.eq("the output minus the tile and its event == the pinned v87", JSON.stringify(strip), JSON.stringify(base));
H.done();
