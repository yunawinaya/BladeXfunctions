// SO_AUTO_GD V2 facts input: the ids V2's own refusals depend on (handling units, pending reservations); run 0 when V2 is off
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const ID = /^[0-9]{1,20}$/;
const lineIds = {};
for (const p of [{{node:code_build.data.payloads}}][0] || []) {
  for (const l of (p && p.allData && p.allData.table_gd) || []) {
    for (const x of [l].concat(Array.isArray(l.children) ? l.children : [])) {
      if (ID.test(s(x && x.so_line_item_id))) lineIds[s(x.so_line_item_id)] = true;
    }
  }
}
const org = s([{{workflowparams:organization_id}}][0]);
const plant = s([{{workflowparams:plant_id}}][0]);
const ok = s([{{workflowparams:v2}}][0]) === "1" && ID.test(org) && ID.test(plant);
const ids = Object.keys(lineIds);
return {
  run: ok ? 1 : 0,
  orgSql: ok ? org : "0",
  plantSql: ok ? plant : "0",
  soLineIdsSql: ids.length ? ids.map((x) => "'" + x + "'").join(",") : "'0'",
};
