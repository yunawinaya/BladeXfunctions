// Over-receive tolerance by UOM (first row per UOM, like find()); 0 = none.
const toleranceEntry = (uomRows) => {
  const entry = {};
  const seen = new Set();
  (uomRows || []).forEach((conv) => {
    if (seen.has(conv.alt_uom_id)) return;
    seen.add(conv.alt_uom_id);
    if (conv.over_receive_tolerance) {
      entry[conv.alt_uom_id] = conv.over_receive_tolerance;
    }
  });
  return Object.keys(entry).length > 0 ? entry : 0;
};

// Item map cached in _data by func_processGRLineItem, else one projected read.
const getOverReceiveTolerance = async (itemId, uomId) => {
  const key = String(itemId);
  let entry = ((this.models["_data"] || {}).gr_item_tol || {})[key];

  if (entry === undefined) {
    const { data } = await db
      .collection("Item")
      .field("table_uom_conversion")
      .where({ id: itemId })
      .get();
    if (!data || data.length === 0) return 0;

    entry = toleranceEntry(data[0].table_uom_conversion);
    const store = this.models["_data"] || {};
    this.models["_data"] = {
      ...store,
      gr_item_tol: { ...(store.gr_item_tol || {}), [key]: entry },
    };
  }

  return (entry && entry[uomId]) || 0;
};
