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

// true: GET_ITEM_UNIT_PRICE_BULK (same contract); false: GET_ITEM_UNIT_PRICE.
const USE_UNIT_PRICE_BULK = true;
const UNIT_PRICE_WORKFLOW_ID = USE_UNIT_PRICE_BULK
  ? "2110564019682578434"
  : "2067818102244966401";

const copyRow = (row) =>
  Array.isArray(row.children)
    ? { ...row, children: row.children.map(copyRow) }
    : { ...row };

(async () => {
  const currentItemArray = arguments[0].itemArray;
  const poLineItems = this.getValue("table_po");
  const itemArray = [];
  const supplierID = this.getValue("po_supplier_id");
  const plantID = this.getValue("po_plant");

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  const stamp = Date.now().toString(36);

  for (const [index, item] of currentItemArray.entries()) {
    let defaultPurchaseDetail = item.table_uom_conversion.find(
      (uom) => uom.purchase_default_uom === 1,
    );

    if (!defaultPurchaseDetail) {
      defaultPurchaseDetail = item.table_uom_conversion.find(
        (uom) => uom.alt_uom_id === item.based_uom,
      );
    }

    const poItem = {
      item_id: item.id,
      item_name: item.material_name,
      item_desc: resolveItemDesc(item, supplierID),
      unit_price: defaultPurchaseDetail.purchase_unit_price || 0,
      item_category_id: item.item_category,
      tax_preference: defaultPurchaseDetail.mat_purchase_tax_id || null,
      tax_percent: defaultPurchaseDetail.purchase_tax_percent || null,
      quantity_uom: defaultPurchaseDetail.alt_uom_id || null,
      further_description: item.further_description,
      min_quantity: defaultPurchaseDetail.min_purchase_qty || 0,
      max_quantity: defaultPurchaseDetail.max_purchase_qty || 0,
      alt_uom: JSON.stringify(item.table_uom_conversion),
      // the price lookup finds its lines by key, wherever they sit by then
      fm_key:
        stamp + index.toString(36) + Math.random().toString(36).slice(2, 6),
    };

    itemArray.push(poItem);
  }

  await this.setData({
    table_po: [...poLineItems, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  const keyByLine = {};
  const taxKeys = new Set();

  itemArray.forEach((poItem, index) => {
    keyByLine[poLineItems.length + index] = poItem.fm_key;

    if (currentItemArray[index].mat_purchase_tax_id) taxKeys.add(poItem.fm_key);
  });

  // Lines of items with a header purchase tax keep Tax Rate open, as before.
  const openTaxPercent = (done) => {
    const paths = [];

    (this.getValue("table_po") || []).forEach((row, index) => {
      if (
        taxKeys.has(row.fm_key) &&
        !row.tax_preference &&
        !done.has(row.fm_key)
      ) {
        paths.push(`table_po.${index}.tax_percent`);
        done.add(row.fm_key);
      }
    });

    if (paths.length > 0) this.disabled(paths, false);
  };
  const taxOpened = new Set();

  setTimeout(async () => {
    await this.triggerEvent("syncBundleChildButtons");

    openTaxPercent(taxOpened);

    await this.runWorkflow(
      UNIT_PRICE_WORKFLOW_ID,
      {
        document_type: "PO",
        supp_cust_id: supplierID,
        plant_id: plantID,
        item_data: itemArray.map((item, index) => {
          return {
            item_id: item.item_id,
            unit_price: item.unit_price,
            line_index: poLineItems.length + index,
            uom_id: item.quantity_uom,
            tax_rate: item.tax_preference || null,
            tax_percent: item.tax_percent || null,
          };
        }),
      },
      async (result) => {
        console.log("result", result);
        const updates = {};

        for (const item of result.data.data) {
          const key = keyByLine[item.line_index];

          if (key === undefined) continue;

          updates[key] = {
            unit_price: item.unit_price,
            quantity_uom: item.uom_id,
            tax_preference: item.tax_rate,
            tax_percent: item.tax_percent,
            from_historical: item.from_historical,
            max_price: item.max_price,
            min_price: item.min_price,
            quantity: item.quantity,
            min_qty: item.min_qty,
            max_qty: item.max_qty,
            discount: item.discount,
            discount_uom: item.discount_uom,
          };
        }

        const rows = (this.getValue("table_po") || []).map((row) =>
          updates[row.fm_key]
            ? Object.assign(copyRow(row), updates[row.fm_key])
            : copyRow(row),
        );
        const header = this.triggerEvent("POcalculation", { calcRows: rows });

        await this.setData({ table_po: rows, ...header });

        openTaxPercent(taxOpened);
      },
      (error) => {
        console.log("error", error);
      },
    );
  }, 50);
})();
