// PICKING_BULK_COMMIT - P5 build, one chunk of <= 25 deliveries: one Packing per Goods Delivery, created or refreshed
// (code_node_pMVdQBEQ + code_node_gudzrvMQ, Map lookups). Picked quantities come from the GD line's picked_temp_qty_data
// (Full Picking: every Picking), else from ALL of this Picking's records (the old path used only the records of the last
// confirmation). A create carries idempotency_key PKG|<gd_id>; a re-run finds it and takes the update path. The tally
// [deliveries that must have a Packing, failures] runs across the chunks.
const commitP5Build = function commitP5Build(entry, chunk, hdrRows, gdMasters, packings, huMasters, soMasters, recordRows, ruleRows, accRaw) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const rowsOf = (res) => list(res && typeof res === "object" && !Array.isArray(res) && "data" in res ? res.data : res);
  const parseJsonSafe = (v) => {
    if (Array.isArray(v)) return v;
    try { return v ? JSON.parse(v) : []; } catch (e) { return []; }
  };
  const flattenGdRows = (rows) => (rows || []).flatMap((row) => {
    const rest = Object.assign({}, row || {});
    delete rest.children;
    return [rest].concat(Array.isArray(row && row.children) ? row.children : []);
  });
  const DELIVERY_INFO_KEYS = ["di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company",
    "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date",
    "di_validity_of_collection", "di_tracking_number", "di_freight_charges"];
  const buildDeliveryInfo = (source) => {
    const fields = {};
    for (const k of DELIVERY_INFO_KEYS) fields[k] = source && source[k] !== undefined && source[k] !== null ? source[k] : "";
    return fields;
  };

  const picking = list(hdrRows).filter((r) => s(r.id))[0] || {};
  const rule = list(ruleRows)[0] || {};
  const gdById = new Map();
  for (const g of rowsOf(gdMasters)) gdById.set(s(g.id), g);
  const huById = new Map();
  for (const h of rowsOf(huMasters)) huById.set(s(h.id), h);
  const soById = new Map();
  for (const so of rowsOf(soMasters)) soById.set(s(so.id), so);
  const existingByGdId = new Map();
  for (const p of rowsOf(packings)) if (s(p.gd_id) && s(p.packing_status) !== "Cancelled" && !existingByGdId.has(s(p.gd_id))) existingByGdId.set(s(p.gd_id), p);
  const recordsByLine = new Map();
  for (const r of list(recordRows)) {
    const k = s(r.gd_line_id);
    if (!recordsByLine.has(k)) recordsByLine.set(k, []);
    recordsByLine.get(k).push(r);
  }
  const pickingGdIds = parseJsonSafe(picking.gd_no_json).filter(Boolean).map(String);
  const pickingIsSingleGd = Array.from(new Set(pickingGdIds)).length === 1;
  const pickCust = parseJsonSafe(picking.customer_id_json).filter(Boolean);
  const createdAt = new Date().toISOString().split("T")[0];

  const keyOf = (e) => (e.location_id || "no-loc") + "_" + (e.batch_id || "no-batch") + "_" + (e.handling_unit_id || "no-hu");
  const createRows = [];
  const updateRows = [];
  const expect = [];
  for (const gdId of chunk.gdIds || []) {
    const gd = gdById.get(s(gdId));
    const anyRow = (chunk.groups || {})[gdId] || {};
    if (!gd) continue;
    const tableItemSource = [];
    const huItems = [];
    for (const line of flattenGdRows(Array.isArray(gd.table_gd) ? gd.table_gd : [])) {
      if (!line.material_id) continue;
      if (line.picking_status === "Cancelled") continue;
      const tempArr = parseJsonSafe(line.temp_qty_data);
      if (!Array.isArray(tempArr) || tempArr.length === 0) continue;
      const pickedArr = parseJsonSafe(line.picked_temp_qty_data);
      const pickedByKey = {};
      if (Array.isArray(pickedArr) && pickedArr.length > 0) {
        for (const p of pickedArr) pickedByKey[keyOf(p)] = (pickedByKey[keyOf(p)] || 0) + (Number(p.gd_quantity) || 0);
      } else {
        for (const rec of recordsByLine.get(s(line.id)) || []) {
          const k = (s(rec.target_location) || s(rec.source_bin) || "no-loc") + "_" + (s(rec.target_batch) || s(rec.batch_no) || "no-batch") + "_" + (s(rec.handling_unit_id) || "no-hu");
          pickedByKey[k] = (pickedByKey[k] || 0) + (Number(rec.store_out_qty) || 0);
        }
      }
      for (const t of tempArr) {
        const allocated = Number(t.gd_quantity) || 0;
        if (allocated <= 0) continue;
        const pickedQty = pickedByKey[keyOf(t)] || 0;
        const remainingQty = Math.max(0, allocated - pickedQty);
        const common = {
          item_name: line.material_name, item_desc: line.gd_material_desc || "",
          item_uom: line.good_delivery_uom_id || line.gd_order_uom_id || "", batch_no: t.batch_id || "", bin_location: t.location_id || "",
          total_quantity: allocated, remark: line.line_remark_1 || "", remark_2: line.line_remark_2 || "", remark_3: line.line_remark_3 || "",
        };
        if (t.handling_unit_id) {
          huItems.push(Object.assign({ row_type: "item", handling_unit_id: t.handling_unit_id, id: line.id || "", item_id: t.material_id || line.material_id, item_code: t.material_id || line.material_id }, common, {
            hu_status: pickedQty >= allocated - 0.001 ? "Unpacked" : "Pending", so_id: line.line_so_id || "", so_no: line.line_so_no || "",
            so_line_id: line.so_line_item_id || "", gd_id: gdId, gd_no: gd.delivery_no || "", gd_line_id: line.id || "", to_id: s(picking.id), to_line_id: "",
          }));
        } else {
          tableItemSource.push(Object.assign({ item_id: line.material_id, item_code: line.material_id }, common, {
            picked_qty: pickedQty, remaining_qty: remainingQty, qty_to_pick: remainingQty,
            line_status: pickedQty <= 0 ? "Open" : remainingQty <= 0.001 ? "Fully Picked" : "Partially Picked",
            so_id: line.line_so_id || anyRow.so_id || "", so_no: line.line_so_no || anyRow.so_no || "", so_line_id: line.so_line_item_id || "",
            gd_id: gdId, gd_no: gd.delivery_no || anyRow.gd_no || "", gd_line_id: line.id || "", to_id: s(picking.id), to_line_id: "",
          }));
        }
      }
    }
    const deliveryInfo = buildDeliveryInfo(pickingIsSingleGd ? picking : gd);
    // HU rows: a header per HU (Unpacked only when every item is upstream-picked) followed by its items
    const huRows = [];
    const huOrder = [];
    for (const it of huItems) if (huOrder.indexOf(it.handling_unit_id) < 0) huOrder.push(it.handling_unit_id);
    for (const huId of huOrder) {
      const hu = huById.get(s(huId)) || {};
      const items = huItems.filter((it) => it.handling_unit_id === huId);
      huRows.push({ row_type: "header", handling_unit_id: huId, handling_no: hu.handling_no || "", hu_material_id: hu.hu_material_id || "", hu_type: hu.hu_type || "", hu_uom: hu.hu_uom || "", hu_status: items.every((it) => it.hu_status === "Unpacked") ? "Unpacked" : "Pending", storage_location: hu.storage_location || "", gross_weight: hu.gross_weight || 0, net_weight: hu.net_weight || 0, net_volume: hu.net_volume || 0 });
      for (const it of items) huRows.push(it);
    }
    if (tableItemSource.length === 0 && huRows.length === 0) continue;
    const existing = existingByGdId.get(s(gdId)) || null;
    expect.push(s(gdId));
    if (existing) {
      const existingHuSource = Array.isArray(existing.table_hu_source) ? existing.table_hu_source : [];
      const existingHuIds = {};
      for (const r of existingHuSource) if (r.row_type === "header" && r.handling_unit_id) existingHuIds[r.handling_unit_id] = true;
      const mergedHuSource = existingHuSource.slice();
      for (const r of huRows) {
        if (r.row_type === "header" && existingHuIds[r.handling_unit_id]) continue;
        if (r.row_type === "header") existingHuIds[r.handling_unit_id] = true;
        mergedHuSource.push(r);
      }
      // keep each surviving source row's own id: PackingRecomputeSource.js matches HU temp_data to it by line_item_id
      const srcKey = (r) => s(r.gd_line_id) + "|" + s(r.bin_location) + "|" + s(r.batch_no);
      const existingSrcId = {};
      for (const r of Array.isArray(existing.table_item_source) ? existing.table_item_source : []) if (r.id && !existingSrcId[srcKey(r)]) existingSrcId[srcKey(r)] = r.id;
      const rebuilt = tableItemSource.map((r) => (existingSrcId[srcKey(r)] ? Object.assign({}, r, { id: existingSrcId[srcKey(r)] }) : r));
      updateRows.push(Object.assign({ existing_packing_id: s(existing.id), gd_id: s(gdId), table_item_source: rebuilt, table_hu_source: mergedHuSource }, deliveryInfo));
    } else {
      const so = soById.get(s(anyRow.so_id)) || {};
      let soIdV = gd.so_id;
      if (Array.isArray(soIdV) && soIdV.length === 0) soIdV = null;
      soIdV = soIdV || anyRow.so_id;
      let cust = gd.customer_name || anyRow.customer_id || (pickCust.length === 1 ? pickCust[0] : null) || so.customer_name;
      if (Array.isArray(cust)) cust = cust.filter(Boolean)[0];
      createRows.push(Object.assign({
        packing_status: "Created", packing_no: "issued", packing_no_type: s(rule.rule_id), idempotency_key: "PKG|" + s(gdId),
        plant_id: gd.plant_id || picking.plant_id, organization_id: gd.organization_id || picking.organization_id || entry.organizationId,
        packing_mode: s(rule.packing_mode), created_by: s(picking.created_by), created_at: createdAt, gd_id: s(gdId), gd_no: gd.delivery_no || anyRow.gd_no || "",
        so_id: Array.isArray(soIdV) ? soIdV.filter(Boolean) : soIdV ? [soIdV] : [], so_no: gd.so_no || anyRow.so_no || "", to_id: s(picking.id),
        customer_id: cust ? [cust] : [], billing_address: gd.gd_billing_address || so.cust_billing_address || "",
        shipping_address: gd.gd_shipping_address || so.cust_shipping_address || "", remarks: gd.order_remark || "", remarks_2: gd.order_remark2 || "",
        remarks_3: gd.order_remark3 || "", table_item_source: tableItemSource, table_hu_source: huRows,
      }, deliveryInfo));
    }
  }
  // no numbering rule: nothing is created (the add-node would fail the run); the tally carries the reason to the check
  const noRule = createRows.length > 0 && !s(rule.rule_id);
  let acc = accRaw;
  if (typeof acc === "string") {
    try {
      acc = JSON.parse(acc);
    } catch (e) {
      acc = null;
    }
  }
  acc = Array.isArray(acc) && acc.length === 2 && Array.isArray(acc[0]) && Array.isArray(acc[1]) ? acc : [[], []];
  const fails = acc[1].slice();
  if (noRule) fails.push("no Packing numbering rule for the organization: " + createRows.length + " Packing(s) could not be created");
  return {
    route: noRule ? "FAIL" : "WRITE", createRows: noRule ? [] : createRows, updateRows: updateRows, hasCreates: createRows.length && !noRule ? "YES" : "NO", hasUpdates: updateRows.length ? "YES" : "NO",
    acc: [acc[0].concat(expect), fails],
    result_message: noRule ? fails[fails.length - 1] : createRows.length + " Packing(s) to create, " + updateRows.length + " to refresh",
  };
};
const entry = [{{node:code_node_PCentry.data}}][0];
const chunk = [{{node:code_node_PCp5chunk.data}}][0];
const res = commitP5Build(entry, chunk, [{{node:sql_node_PCp5hdr.data}}][0], [{{node:search_node_PCp5gd.data}}][0], [{{node:search_node_PCp5pack.data}}][0], [{{node:search_node_PCp5hu.data}}][0], [{{node:search_node_PCp5so.data}}][0], [{{node:sql_node_PCp5recs.data}}][0], [{{node:sql_node_PCp5rule.data}}][0], [{{node:get_cache_PCp5acc.data}}][0]);
console.log("commit P5 build", JSON.stringify({ route: res.route, creates: res.createRows.length, updates: res.updateRows.length, message: res.result_message }));
return res;
