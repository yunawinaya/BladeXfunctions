// GET_ITEM_UNIT_PRICE_BULK - Resolve: every line through the rule sequence, first rule with an answer wins (the classic's
// Loop Item Data x Loop Config Sequence with its three Map nodes), then "Map return data". The expressions are the
// classic's; only the reads changed (one SQL per source instead of one per line and rule). Where the classic's node threw
// (item or UOM row missing, quantity that broke its SQL) the line goes on instead of failing the whole request.
const resolvePrices = function resolvePrices(itemData, keys, plan, itemRows, histRows, tagRows) {
  const list = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []).filter((r) => r);
  const parseConv = (v) => {
    if (Array.isArray(v)) return v;
    if (!v) return [];
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      return [];
    }
  };
  const SOURCE = { "Last Quotation Price": "SQT", "Last Sales Order Price": "SO", "Last Sales Invoice Price": "SI",
    "Last Purchase Requisition Price": "PREQ", "Last Purchase Order Price": "PO", "Last Purchase Invoice Price": "PI" };
  const items = {};
  for (const it of list(itemRows)) if (!(String(it.id) in items)) items[String(it.id)] = it;
  const hist = {};
  for (const h of list(histRows)) hist[h.src + "|" + h.item_id + "|" + h.uom_id] = h;
  const tags = {};
  for (const t of list(tagRows)) (tags[t.item_id + "|" + t.uom_id] = tags[t.item_id + "|" + t.uom_id] || []).push(t);
  // the classic put the line's quantity into its SQL as text: a number or numeric text compares, null / missing is SQL
  // NULL (only a row without limits passes); text that broke the SQL there is treated as missing here
  const sqlQty = (v) => {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
    return null;
  };
  const bound = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  // (min <= q OR min = 0) AND (max >= q OR max = 0), SQL three-valued: a NULL limit never passes
  const inRange = (t, q) => {
    const lo = bound(t.min_order_qty);
    const hi = bound(t.max_order_qty);
    if (lo === null || hi === null || isNaN(lo) || isNaN(hi)) return false;
    return (lo === 0 || (q !== null && lo <= q)) && (hi === 0 || (q !== null && hi >= q));
  };
  // what the classic's Redis round trip and node outputs keep: no undefined, null or NaN values
  const clean = (o) => {
    const out = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === undefined || v === null || (typeof v === "number" && !isFinite(v))) continue;
      out[k] = v;
    }
    return out;
  };
  const documentType = keys.document_type;
  const sdOrProcurement = documentType === "sd" ? "sales" : "purchase";
  const sequence = list(plan.sequence);
  const redisData = [];
  for (const currentLineItem of Array.isArray(itemData) ? itemData : []) {
    if (!currentLineItem || typeof currentLineItem !== "object") continue;
    const itemRow = items[String(currentLineItem.item_id)];
    const conv = itemRow ? parseConv(itemRow.uom_conversion_json) : [];
    const itemUOM = conv.find((uom) => String(uom.alt_uom_id) === String(currentLineItem.uom_id)) || null;
    const u = itemUOM || {};
    const pairKey = String(currentLineItem.item_id) + "|" + String(currentLineItem.uom_id);
    let data = null;
    for (const step of sequence) {
      const rules = step && typeof step === "object" ? step.rules : undefined;
      if (SOURCE[rules]) {
        const latest = hist[SOURCE[rules] + "|" + pairKey];
        if (!latest) continue;
        data = {
          ...currentLineItem,
          from: rules,
          unit_price: latest.unit_price || currentLineItem.unit_price || 0,
          from_historical: 1,
          max_price: parseFloat(u[`${sdOrProcurement}_max_price`] || 0),
          min_price: parseFloat(u[`${sdOrProcurement}_min_price`] || 0),
          max_qty: parseFloat(u[`max_${sdOrProcurement}_qty`] || 0),
          min_qty: parseFloat(u[`min_${sdOrProcurement}_qty`] || 0),
        };
      } else if (rules === "Customer Price Tag" || rules === "Supplier Price Tag") {
        if (keys.needFetch !== "Yes") continue;
        const q = sqlQty(currentLineItem.quantity);
        const priceTagData = (tags[pairKey] || []).filter((t) => inRange(t, q));
        if (priceTagData.length === 0) continue;
        data = {
          ...currentLineItem,
          from: rules,
          use_price_tag: true,
          unit_price: priceTagData[0].unit_price || currentLineItem.unit_price || 0,
          from_historical: 0,
          max_price: priceTagData[0].max_price || 0,
          min_price: priceTagData[0].min_price || 0,
          min_qty: parseFloat(u[`min_${sdOrProcurement}_qty`] || 0),
          max_qty: parseFloat(u[`max_${sdOrProcurement}_qty`] || 0),
          quantity: parseFloat(currentLineItem.quantity || 0),
          discount: priceTagData[0].discount || currentLineItem.discount || 0,
          discount_uom: priceTagData[0].discount_type || currentLineItem.discount_uom,
          tax_rate: priceTagData[0].tax || currentLineItem.tax_rate,
          tax_percent: priceTagData[0].tax_percent || currentLineItem.tax_percent,
        };
      } else if (rules === "Default Sales Unit Price" || rules === "Default Purchase Unit Price") {
        if (!itemUOM) continue;
        data = {
          ...currentLineItem,
          from: rules,
          use_price_tag: false,
          unit_price: itemUOM[`${sdOrProcurement}_unit_price`] || currentLineItem.unit_price || 0,
          from_historical: 0,
          max_price: itemUOM[`${sdOrProcurement}_max_price`] || 0,
          min_price: itemUOM[`${sdOrProcurement}_min_price`] || 0,
          min_qty: itemUOM[`min_${sdOrProcurement}_qty`] || 0,
          max_qty: itemUOM[`max_${sdOrProcurement}_qty`] || 0,
          quantity: parseFloat(currentLineItem.quantity || 0),
          discount: currentLineItem.discount || 0,
          discount_uom: currentLineItem.discount_uom,
          tax_rate: itemUOM[`mat_${sdOrProcurement}_tax_id`] || currentLineItem.tax_rate,
          tax_percent: itemUOM[`${sdOrProcurement}_tax_percent`] || currentLineItem.tax_percent,
        };
      } else {
        continue;
      }
      break;
    }
    if (data) redisData.push(clean(data));
  }

  // Map return data (verbatim)
  const workflowItemData = itemData || [];
  const hasUsePriceTag = redisData.some((item) => item.use_price_tag === true);
  const roundTo4 = (val) => {
    if (val === undefined || val === null || val === "") return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : Math.round(num * 10000) / 10000;
  };
  let isPriceDifferent = false;
  let isDiscountDifferent = false;
  let isDiscountUomDifferent = false;
  let isTaxRateDifferent = false;
  let isTaxPercentDifferent = false;
  if (redisData.length > 0 && workflowItemData.length > 0) {
    for (const redisItem of redisData) {
      const workflowItem = workflowItemData.find((item) => item.item_id === redisItem.item_id && item.line_index === redisItem.line_index);
      if (workflowItem) {
        const redisPrice = roundTo4(redisItem?.unit_price);
        const workflowPrice = roundTo4(workflowItem?.unit_price);
        if (redisPrice !== workflowPrice && redisPrice !== 0) isPriceDifferent = true;
        if (roundTo4(redisItem?.discount) !== roundTo4(workflowItem?.discount)) isDiscountDifferent = true;
        if ((redisItem?.discount_uom || null) !== (workflowItem?.discount_uom || null)) isDiscountUomDifferent = true;
        if (roundTo4(redisItem?.tax_rate) !== roundTo4(workflowItem?.tax_rate)) isTaxRateDifferent = true;
        if (roundTo4(redisItem?.tax_percent) !== roundTo4(workflowItem?.tax_percent)) isTaxPercentDifferent = true;
      }
    }
  }
  const needOverwrite = hasUsePriceTag || isPriceDifferent || isDiscountDifferent || isDiscountUomDifferent || isTaxRateDifferent || isTaxPercentDifferent ? "Yes" : "No";
  return { data: redisData, needOverwrite: needOverwrite };
};
const res = resolvePrices([{{workflowparams:item_data}}][0], [{{node:code_node_UPkeys.data}}][0], [{{node:code_node_UPplan.data}}][0],
  [{{node:sql_node_UPitems.data}}][0], [{{node:sql_node_UPhist.data}}][0], [{{node:sql_node_UPtag.data}}][0]);
console.log("prices", JSON.stringify({ lines: ([{{workflowparams:item_data}}][0] || []).length, priced: res.data.length, needOverwrite: res.needOverwrite }));
return res;
