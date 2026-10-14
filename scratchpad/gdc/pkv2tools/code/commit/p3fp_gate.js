// PICKING_BULK_COMMIT - P3 pass gate (Full Picking): the recount state [settled, passes, values written, over plan] -> one
// more pass until a pass finds nothing to write
const p3fpGate = function p3fpGate(raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      v = null;
    }
  }
  const st = Array.isArray(v) && v.length >= 4 ? v.map((x) => Number(x) || 0) : [0, 0, 0, 0];
  return { route: st[0] === 1 ? "SKIP" : "GO", passes: st[1] };
};
const res = p3fpGate([{{node:get_cache_PCp3fpSt.data}}][0]);
console.log("commit P3 gate", JSON.stringify(res));
return res;
