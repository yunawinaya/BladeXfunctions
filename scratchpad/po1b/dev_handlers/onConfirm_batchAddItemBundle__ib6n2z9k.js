// Batch Add for Item Bundles — the bundle twin of po_onConfirm_batchAddItem.js.
//
// arguments[0].itemArray only carries { id, ib_no }: the bundle selection page
// keeps its payload thin, so every bundle is re-fetched here in full.
//
// Each bundle lands as ONE tree row in table_po, with the bundle's table_ib
// lines as that row's children. Child rows use the same table_po field names as
// a normal PO line. On the bundle row the item code is left empty — a bundle is
// not an item — and the bundle id goes to item_bundle_id instead. Children carry
// item_bundle_id too, so a line can be traced back to its bundle on its own.
//
// Prices are taken from the bundle itself (a bundle fixes its own quantities,
// UOMs and unit prices), so the price-history workflow the item batch add runs
// is deliberately NOT called here.

// Pick the description this supplier has bound to the item on the Item master.
// Reads table_sup_item_bind (supplier_id / item_description) -- NOT the customer
// twin. An item may carry several rows for the same supplier: take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, supplierId) => {
  const fallback = item?.material_desc || "";
  if (!supplierId || Array.isArray(supplierId)) return fallback;

  const binds = Array.isArray(item?.table_sup_item_bind)
    ? item.table_sup_item_bind
    : [];
  const wanted = String(supplierId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.supplier_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_description ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};

(async () => {
  const currentItemArray = arguments[0].itemArray;
  const poLineItems = this.getValue("table_po") || [];
  const itemArray = [];
  const supplierID = this.getValue("po_supplier_id");

  const organizationId =
    this.getVarGlobal("deptParentId") === "0"
      ? this.getVarSystem("deptIds")
      : this.getVarGlobal("deptParentId");

  if (!currentItemArray || currentItemArray.length === 0) {
    this.$alert("Please select at least one item bundle.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  console.log("currentItemArray", currentItemArray);

  // Step 1 — re-fetch the bundles. The selection payload has only id + ib_no.
  const resItemBundles = await Promise.all(
    currentItemArray.map((itemBundle) =>
      db.collection("item_bundle").doc(itemBundle.id).get(),
    ),
  );

  const itemBundleData = resItemBundles
    .map((response) => response.data?.[0])
    .filter(Boolean);

  console.log("itemBundleData", itemBundleData);

  if (itemBundleData.length === 0) {
    this.$alert("Item bundle not found.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  // Step 2 — the bundle line only stores price / uom / qty. item_category and
  // table_uom_conversion live on the Item master, so pull those in one query.
  const itemIds = [
    ...new Set(
      itemBundleData
        .flatMap((itemBundle) =>
          Array.isArray(itemBundle.table_ib) ? itemBundle.table_ib : [],
        )
        .map((line) => line.item_id)
        .filter(Boolean),
    ),
  ];

  const itemMap = new Map();

  if (itemIds.length > 0) {
    const resItems = await db
      .collection("Item")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "id", operator: "in", value: itemIds },
            {
              prop: "organization_id",
              operator: "equal",
              value: organizationId,
            },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get();

    (resItems.data || []).forEach((item) => {
      itemMap.set(item.id, item);
    });

    console.log(`fetched ${itemMap.size} of ${itemIds.length} bundle items`);
  }

  // Step 3 — one tree row per bundle, its table_ib lines as children.
  for (const itemBundle of itemBundleData) {
    const bundleLines = Array.isArray(itemBundle.table_ib)
      ? itemBundle.table_ib
      : [];

    const children = bundleLines.map((line) => {
      const item = itemMap.get(line.item_id) || {};

      if (!itemMap.has(line.item_id)) {
        console.log("item master not found for bundle line", line.item_id);
      }

      return {
        item_id: line.item_id,
        item_bundle_id: itemBundle.id,
        item_name: line.item_name || item.material_name || "",
        item_desc: line.item_description || resolveItemDesc(item, supplierID),
        quantity: line.quantity || 0,
        bundle_ratio: line.quantity || 0,
        unit_price: line.purchase_unit_price || 0,
        // Tax is set per item on the bundle, not on the bundle as a whole, so
        // each line brings its own rate across.
        tax_preference: line.mat_purchase_tax_id || null,
        tax_percent: line.purchase_tax_percent ?? null,
        item_category_id: item.item_category,
        quantity_uom: line.uom_id || item.based_uom || null,
        table_uom_conversion: item.table_uom_conversion,
        // The UOM dropdown on a PO line reads its options from alt_uom, which
        // the item batch add fills in after setData. Nested child rows are not
        // reachable by that path, so it is set here instead.
        alt_uom: JSON.stringify(item.table_uom_conversion || []),
        further_description: line.further_description,
        min_price: line.purchase_min_price || 0,
        max_price: line.purchase_max_price || 0,
      };
    });

    // purchase_net_total is the bundle's own sum of quantity * purchase price,
    // so one bundle priced at that total keeps the PO totals right without
    // double counting the children.
    itemArray.push({
      item_id: "",
      item_bundle_id: itemBundle.id,
      item_name: itemBundle.ib_no || "",
      item_desc: itemBundle.description || "",
      quantity: 1,
      unit_price: itemBundle.purchase_net_total || 0,
      children,
    });
  }

  console.log("itemArray", itemArray);

  await this.setData({
    table_po: [...poLineItems, ...itemArray],
  });

  setTimeout(async () => {
    await this.triggerEvent("POcalculation");
    await this.triggerEvent("syncBundleChildButtons");
  }, 50);
})();