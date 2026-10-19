// PICKING_BULK_COMMIT - P5 tally: after every chunk, the deliveries that must now have one live Packing (the read-back's
// ids) and whether a chunk could not be built
const commitP5Expect = function commitP5Expect(raw, gate) {
  let acc = raw;
  if (typeof acc === "string") {
    try {
      acc = JSON.parse(acc);
    } catch (e) {
      acc = null;
    }
  }
  acc = Array.isArray(acc) && acc.length === 2 && Array.isArray(acc[0]) && Array.isArray(acc[1]) ? acc : [[], []];
  const ids = Array.from(new Set(acc[0].map(String).filter((g) => /^[0-9]{1,20}$/.test(g)))).sort();
  const fails = acc[1].map(String);
  const g = gate || {};
  return {
    route: fails.length ? "FAIL" : "WRITE", expectSql: ids.length ? ids.map((x) => "'" + x + "'").join(",") : "'0'", expectCount: ids.length,
    result_message: fails.length ? fails.join("; ") : ids.length + " Goods Delivery(ies) packed in " + (Number(g.chunkCount) || 0) + " chunk(s)",
  };
};
const res = commitP5Expect([{{node:get_cache_PCp5accEnd.data}}][0], [{{node:code_node_PCp5gate.data}}][0]);
console.log("commit P5 tally", JSON.stringify({ route: res.route, expect: res.expectCount, message: res.result_message }));
return res;
