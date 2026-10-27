// IA_SAVE v14 - the ids of the Batch rows the add-node just inserted (read back next)
const ins = [{{node:add_node_OSbatch.data}}][0];
const ids = (Array.isArray(ins) ? ins : ins ? [ins] : []).map((r) => osS(r && typeof r === "object" ? r.id : r)).filter((v) => /^[0-9]{1,20}$/.test(v));
return { ids: ids.join(",") || "0", count: String(ids.length) };
