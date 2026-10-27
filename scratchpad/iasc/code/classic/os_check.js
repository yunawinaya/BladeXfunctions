// IA_SAVE v14 - a completion's output split (osCompletion): the rows checked for the item, every bin a live bin of the IA's plant;
// STOP = 401 before any write. A System Settings split numbers its groups next (one GENERATE_BATCH call each)
const m = [{{node:code_node_OSmerge.data}}][0] || {};
const a = [{{node:code_fillback.data.allData}}][0] || {};
const items = [{{node:search_items.data.data}}][0] || [];
const res = osCompletion(m, a, items, osJ([{{node:sql_node_OSbins.data}}][0]), [{{system:uid}}][0]);
console.log("ia output split check", JSON.stringify({ route: res.route, kind: res.kind, gen: res.gen, groups: res.groups.length }));
return { route: res.route, message: res.message, kind: res.kind, split: res.split, output_split: res.output_split, groups: res.groups, gen: res.gen,
  genGroups: res.genGroups, cacheKey: res.cacheKey };
