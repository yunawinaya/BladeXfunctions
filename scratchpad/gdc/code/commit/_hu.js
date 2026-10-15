// handling units: GD_UNUSED_FN_NEW's Branch 5 (loop_IVqrLffH) replayed on rows read now. Per entry, in order: the HU's
// total_quantity minus the qty (atomic_count_node_MtBduaPJ), then its item rows of that material - and batch, when the entry
// has one (the node drops a null condition) - minus the qty, drained in id order (atomic_count_node_9GwpVap5). Not enough
// (or no row) = the classic node fails. rules = { hu, item }: the tenant's number rule of each column ({ dp, mode }), or null
const huIdCmp = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const huRound = (v, r) => (r && r.dp !== null && r.dp !== undefined ? roundDec(v, r.dp, r.mode) : q8(v));
const huReplay = function huReplay(entries, huRows, itemRows, rules) {
  const R = rules || {};
  const hus = {};
  for (const h of huRows) if (String(h.is_deleted) === "0") hus[s(h.id)] = { id: s(h.id), before: q8(h.total_quantity), now: q8(h.total_quantity) };
  const items = itemRows.filter((r) => String(r.is_deleted) === "0")
    .map((r) => ({ id: s(r.id), hu: s(r.handling_unit_id), mat: s(r.material_id), batch: s(r.batch_id), before: q8(r.quantity), now: q8(r.quantity) }))
    .sort((a, b) => huIdCmp(a.id, b.id));
  const short = [];
  for (const e of entries) {
    const q = q8(e.deliver_quantity);
    if (!(q > 0)) continue;
    const huId = s(e.handling_unit_id);
    const hu = hus[huId];
    if (!hu) {
      short.push("handling unit " + huId + " not found");
      continue;
    }
    if (hu.now - q < -1e-9) short.push("handling unit " + huId + " holds " + hu.now + ", " + q + " delivered");
    else hu.now = huRound(hu.now - q, R.hu);
    const batch = s(e.batch_id);
    const mine = items.filter((r) => r.hu === huId && r.mat === s(e.material_id) && (!batch || r.batch === batch));
    const have = q8(mine.reduce((t, r) => t + Math.max(0, r.now), 0));
    if (have - q < -1e-9) {
      short.push("handling unit " + huId + " holds " + have + " of material " + s(e.material_id) + (batch ? " batch " + batch : "") + ", " + q + " delivered");
      continue;
    }
    let left = q;
    for (const r of mine) {
      if (left <= 1e-9) break;
      const take = Math.min(Math.max(0, r.now), left);
      if (!(take > 0)) continue;
      r.now = huRound(r.now - take, R.item);
      left = q8(left - take);
    }
  }
  const pair = (r) => ({ id: r.id, before: r.before, after: r.now });
  return {
    short: short,
    hus: Object.keys(hus).map((k) => hus[k]).filter((h) => Math.abs(h.now - h.before) > 1e-9).map(pair),
    items: items.filter((r) => Math.abs(r.now - r.before) > 1e-9).map(pair),
  };
};
// the tenant's rules for the two columns: "Handling Unit Qty" binds handling_unit.total_quantity (schema numberRule); the item
// table's quantity has none; a per-column rule (scope 2) wins. decimals, precision_rule 1/2/3, store_raw_value = no rounding
const HU_TABLE = "2036736671686529026";
const HU_ITEM_TABLE = "2036977712276639745";
const huRules = function huRules(rows) {
  let keyed = null;
  const column = {};
  for (const r of list(rows)) {
    const mode = Number(r.precision_rule);
    const dp = Number(r.decimal_places);
    if ([1, 2, 3].indexOf(mode) < 0 || !(dp >= 0)) continue;
    const rule = Number(r.store_raw_value) === 1 || dp >= 8 ? { dp: null, mode: mode } : { dp: dp, mode: mode };
    if (s(r.scope_type) === "2") column[s(r.table_id) + "." + s(r.field_name)] = rule;
    else if (s(r.rule_key) === "Handling Unit Qty") keyed = rule;
  }
  const hu = HU_TABLE + ".total_quantity";
  const item = HU_ITEM_TABLE + ".quantity";
  return { hu: column[hu] !== undefined ? column[hu] : keyed, item: column[item] !== undefined ? column[item] : null };
};
const huParse = (rows) => list(rows).map((r) => parseJ(r.j)).filter((o) => o && o.id);
