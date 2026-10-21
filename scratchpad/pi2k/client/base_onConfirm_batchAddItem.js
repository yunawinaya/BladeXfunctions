const checkExistingPOinPI = async (grArray, referenceType) => {
  const grNumbersWithPI = new Set(); // Use Set to avoid duplicates

  if (referenceType === "Item - GR") {
    await Promise.all(
      grArray.flatMap((gr) =>
        db
          .collection("purchase_invoice")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "po_id", operator: "in", value: gr.purchase_order_id },
                { prop: "gr_no_display", operator: "isNull", value: null },
              ],
            },
          ])
          .get()
          .then((response) => {
            if (response.data[0]) {
              // Only add GR number if PI exists
              grNumbersWithPI.add(gr.goods_receiving_number);
            }
          }),
      ),
    );
  } else {
    await Promise.all(
      grArray.flatMap((gr) =>
        gr.purchase_order_id.map((poId) =>
          db
            .collection("purchase_invoice")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "po_id", operator: "in", value: poId.id },
                  { prop: "gr_no_display", operator: "isNull", value: null },
                ],
              },
            ])
            .get()
            .then((response) => {
              if (response.data[0]) {
                // Only add GR number if PI exists
                grNumbersWithPI.add(gr.goods_receiving_number);
              }
            }),
        ),
      ),
    );
  }

  console.log("GR numbers with existing PIs:", Array.from(grNumbersWithPI));
  return Array.from(grNumbersWithPI);
};

const fetchPOLineItemData = async (poLineItemIDs) => {
  const resPOLineItem = await Promise.all(
    poLineItemIDs.map((lineId) =>
      db.collection("purchase_order_2ukyuanr_sub").doc(lineId).get(),
    ),
  );

  const poLineItemData = resPOLineItem.map((response) => response.data[0]);
  return poLineItemData;
};

// A selected document's lines arrive as one flat array — an item bundle's
// parent row and its items are siblings, not nested — so the tree is rebuilt
// here. A bundle row is the one carrying a bundle but no item of its own; the
// item rows carry both.
//
// Three ways a child points back at its parent are handled, because which one
// is present depends on where the rows came from:
//
//   1. already nested under `children`, when the document was read from the DB
//   2. parent_id / parent_fm_key on the child row
//   3. neither — a bundle row followed by its item rows, which is what a tree
//      looks like once it has been flattened and lost its links
//
// Returns { childrenOf, claimed }: childrenOf maps a parent's index to its
// children's indexes, and claimed holds every index now owned by a parent, so
// the caller can skip those rows rather than invoicing them twice.
const groupBundleRows = (rows, getItemId) => {
  const childrenOf = new Map();
  const claimed = new Set();

  const isBundleRow = (row) => !!row.item_bundle_id && !getItemId(row);
  const isBundleItem = (row) => !!row.item_bundle_id && !!getItemId(row);

  let openParent = null;

  rows.forEach((row, index) => {
    if (isBundleRow(row)) {
      // Already a tree: nothing to reattach.
      if (Array.isArray(row.children) && row.children.length > 0) {
        openParent = null;
        return;
      }

      childrenOf.set(index, []);
      openParent = index;
      return;
    }

    if (!isBundleItem(row)) {
      openParent = null; // a plain line closes the bundle above it
      return;
    }

    let parentIndex = null;

    rows.forEach((candidate, candidateIndex) => {
      if (parentIndex !== null || !childrenOf.has(candidateIndex)) return;

      const byId =
        row.parent_id != null &&
        candidate.id != null &&
        String(row.parent_id) === String(candidate.id);
      const byKey =
        row.parent_fm_key != null &&
        candidate.fm_key != null &&
        String(row.parent_fm_key) === String(candidate.fm_key);

      if (byId || byKey) parentIndex = candidateIndex;
    });

    // No link on the row: it belongs to the bundle it follows, as long as that
    // is the same bundle.
    if (
      parentIndex === null &&
      openParent !== null &&
      String(rows[openParent].item_bundle_id) === String(row.item_bundle_id)
    ) {
      parentIndex = openParent;
    }

    if (parentIndex === null) return; // orphan: invoiced as a line of its own

    childrenOf.get(parentIndex).push(index);
    claimed.add(index);
  });

  console.log("item bundle grouping", {
    rows: rows.length,
    bundles: childrenOf.size,
    claimed: claimed.size,
  });

  return { childrenOf, claimed };
};

// The item pickers hand over one line at a time, and a bundle's items are not
// on that row. They are read back from the source document instead — the same
// place the Document - PO / Document - GR paths take them from. Both tree
// shapes are covered, since groupBundleRows reattaches flat rows as well as
// returning nested ones untouched.
const fetchBundleChildren = async (collection, docId, tableField, lineId) => {
  if (!docId || !lineId) {
    return [];
  }

  const res = await db.collection(collection).doc(docId).get();
  const rows = res?.data?.[0]?.[tableField] || [];

  const lineIndex = rows.findIndex((row) => String(row.id) === String(lineId));

  if (lineIndex === -1) {
    console.log("bundle line not found in", collection, docId, lineId);
    return [];
  }

  const line = rows[lineIndex];

  if (Array.isArray(line.children) && line.children.length > 0) {
    return line.children;
  }

  const { childrenOf } = groupBundleRows(rows, (row) => row.item_id);

  return (childrenOf.get(lineIndex) || []).map((index) => rows[index]);
};

const processData = async (tablePI, referenceType) => {
  this.display("po_no_display");
  if (referenceType.endsWith("GR")) {
    this.display("gr_no_display");
  } else {
    this.hide("gr_no_display");
  }

  for (const [index, pi] of tablePI.entries()) {
    if (pi.tax_percent && pi.tax_percent >= 0) {
      this.disabled([`table_pi.${index}.tax_percent`], false);
    } else {
      this.disabled([`table_pi.${index}.tax_percent`], true);
    }

    if (referenceType.endsWith("GR")) {
      this.display(`table_pi.goods_receiving_no`);
    } else {
      this.hide(`table_pi.goods_receiving_no`);
    }
  }
};

// Custom fields follow the source document: each line takes its source line's, the header the first source's.
const CF_READ_CHUNK = 500;

const asCustomFields = (value) => {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (e) {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const hasCustomFields = (value) =>
  Object.values(asCustomFields(value)).some((v) => v !== null && v !== undefined && v !== "");

const cfRefId = (value) =>
  value && typeof value === "object" ? value.id || null : value || null;

const withChildren = (rows) =>
  (rows || []).flatMap((row) => [row, ...(Array.isArray(row?.children) ? row.children : [])]);

const readCustomFields = async (collection, column, ids) => {
  const found = new Map();
  const chunks = [];
  for (let i = 0; i < ids.length; i += CF_READ_CHUNK) chunks.push(ids.slice(i, i + CF_READ_CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      const res = await db
        .collection(collection)
        .filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: chunk }] }])
        .field(column)
        .limit(chunk.length)
        .get();
      for (const row of res?.data || []) found.set(String(row.id), row[column]);
    }),
  );
  return found;
};

// The header's new custom fields, or null to leave them. replaceHeader: the PI had no lines before this add.
const fillPiCustomFields = async (newRows, selection, replaceHeader) => {
  const rows = withChildren(newRows);
  const knownGr = new Map();
  const knownPo = new Map();
  for (const doc of selection) {
    for (const line of withChildren(doc.table_gr)) {
      if (line && "custom_fields_d7o7rdkd" in line) knownGr.set(String(line.id), line["custom_fields_d7o7rdkd"]);
    }
    for (const line of withChildren(doc.table_po)) {
      if (line && "custom_fields_va4w0xz3" in line) knownPo.set(String(line.id), line["custom_fields_va4w0xz3"]);
    }
  }

  // A combined split line (no gr_line_id) takes its PO line's.
  const grLineOf = (row) => String(cfRefId(row.gr_line_id) || "");
  const poLineOf = (row) => String(cfRefId(row.po_line_id) || "");
  const grIds = [...new Set(rows.map(grLineOf))].filter((id) => id && !knownGr.has(id));
  const poIds = [...new Set(rows.filter((row) => !grLineOf(row)).map(poLineOf))].filter(
    (id) => id && !knownPo.has(id),
  );

  const first = rows.find((row) => cfRefId(row.line_gr_id) || cfRefId(row.line_po_id));
  const source = !first
    ? null
    : cfRefId(first.line_gr_id)
      ? { collection: "goods_receiving", column: "custom_fields_e9609s2l", id: String(cfRefId(first.line_gr_id)) }
      : { collection: "purchase_order", column: "custom_fields_b3w85tmv", id: String(cfRefId(first.line_po_id)) };
  const readHeader =
    Boolean(source) && (replaceHeader || !hasCustomFields(this.getValue("custom_fields_d10wd6ob")));

  const [grLines, poLines, header] = await Promise.all([
    grIds.length > 0 ? readCustomFields("goods_receiving_eg6l4ywi_sub", "custom_fields_d7o7rdkd", grIds) : new Map(),
    poIds.length > 0 ? readCustomFields("purchase_order_2ukyuanr_sub", "custom_fields_va4w0xz3", poIds) : new Map(),
    readHeader ? readCustomFields(source.collection, source.column, [source.id]) : new Map(),
  ]);

  for (const [id, value] of grLines) knownGr.set(id, value);
  for (const [id, value] of poLines) knownPo.set(id, value);
  for (const row of rows) {
    row["custom_fields_y78jfz24"] = asCustomFields(
      grLineOf(row) ? knownGr.get(grLineOf(row)) : knownPo.get(poLineOf(row)),
    );
  }

  const sourceHeader = readHeader ? header.get(source.id) : null;
  return hasCustomFields(sourceHeader) ? asCustomFields(sourceHeader) : null;
};

(async () => {
  const previousReferenceType = this.getValue("reference_type");
  // The selection now comes from the batch add page rather than off a dialog
  // on this form, so it arrives as the payload of the triggerEvent the page's
  // Confirm button fires.
  const { itemArray, referenceType } = arguments[0];
  const currentItemArray = itemArray;

  let existingPI = this.getValue("table_pi");

  const supplierName = this.getValue("supplier_name");

  let tablePI = [];
  let purchaseOrderNumber = [];
  let poId = [];
  let goodsReceivingNumber = [];
  let grId = [];

  if (currentItemArray.length === 0) {
    this.$alert(
      "Please select at least one purchase order / goods receiving / item.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );

    return;
  }

  if (previousReferenceType && previousReferenceType !== referenceType) {
    await this.$confirm(
      `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Reference Type Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingPI = [];
  }

  const uniqueSuppliers = new Set(
    currentItemArray.map((item) =>
      referenceType.startsWith("Document")
        ? item.supplier_id
        : item.supplier.id,
    ),
  );
  const allSameSupplier = uniqueSuppliers.size === 1;

  if (!allSameSupplier) {
    this.$alert(
      "Invoiced item(s) from more than two different suppliers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    return;
  }
  if (supplierName && supplierName !== [...uniqueSuppliers][0]) {
    await this.$confirm(
      `You've selected a different supplier than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Supplier Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingPI = [];
  }

  if (referenceType === "Document - GR" || referenceType === "Item - GR") {
    const existingGRNumbers = await checkExistingPOinPI(
      currentItemArray,
      referenceType,
    );

    if (existingGRNumbers && existingGRNumbers.length > 0) {
      this.parentGenerateForm.$alert(
        `Purchase Order(s) in the ${existingGRNumbers.join(
          ", ",
        )} has existing Purchase Invoice(s). Please choose different Goods Receiving(s).`,
        "Existing Purchase Invoice(s) Detected",
        {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: false,
        },
      );

      this.hideLoading();
      return;
    }
  }
  // The page has already closed itself by the time this runs.
  this.showLoading();

  switch (referenceType) {
    case "Document - PO":
      for (const po of currentItemArray) {
        // An item bundle is one line on the order with the bundle's items
        // beneath it, and it is invoiced the same way — the bundle row is the
        // line, its items ride along as children.
        const mapPOLine = (poItem) => {
          const record = {
            material_id: poItem.item_id || "",
            material_name: poItem.item_name,
            item_desc: poItem.item_desc || "",
            purchase_order_no: po.purchase_order_number,
            order_qty: poItem.quantity,
            more_desc: poItem.more_desc || "",
            line_remark_1: poItem.line_remark_1 || "",
            line_remark_2: poItem.line_remark_2 || "",
            received_qty: poItem.received_qty,
            invoice_qty: poItem.quantity - poItem.invoice_qty,
            quantity_uom: poItem.quantity_uom,
            order_unit_price: poItem.unit_price,
            order_discount: poItem.discount,
            discount_uom: poItem.discount_uom,
            tax_percent: poItem.tax_percent,
            tax_preference: poItem.tax_preference,
            tax_inclusive: poItem.tax_inclusive,
            po_line_id: poItem.id,
            gr_line_id: "",
            available_inv_qty: poItem.quantity - poItem.invoice_qty,
            line_po_id: po.purchase_order_id,
            line_gr_id: "",
            item_bundle_id: poItem.item_bundle_id || "",
            item_category_id: poItem.item_category_id,
            tariff_id: poItem.tariff_id,
            further_description: poItem.further_description,
          };

          return record;
        };

        const { childrenOf, claimed } = groupBundleRows(
          po.table_po,
          (row) => row.item_id,
        );

        po.table_po.forEach((poItem, index) => {
          if (claimed.has(index)) return; // already nested under its bundle

          const record = mapPOLine(poItem);

          // Nested to begin with, or reattached from the flat rows.
          const nested = Array.isArray(poItem.children) ? poItem.children : [];
          const regrouped = (childrenOf.get(index) || []).map(
            (childIndex) => po.table_po[childIndex],
          );
          const bundleChildren = nested.length > 0 ? nested : regrouped;

          if (bundleChildren.length > 0) {
            record.children = bundleChildren.map(mapPOLine);
          }

          tablePI.push(record);
        });
      }

      break;

    case "Document - GR":
      for (const gr of currentItemArray) {
        // Filter out child rows - only count parent/regular/split-parent rows for invoicing
        // Child rows are inventory-level detail (per-bin, per-HU); parent has the total received_qty
        const grLines = gr.table_gr.filter(
          (item) => item.parent_or_child !== "Child",
        );

        const poLineItemIDs = grLines.map((item) => item.po_line_item_id);

        const poLineItemData = await fetchPOLineItemData(poLineItemIDs);
        console.log("poLineItemData", poLineItemData);

        // An item bundle cannot be split, so a bundle row never reaches the
        // consolidation below. Its items are siblings in grLines, which means
        // their PO lines are already sitting in poLineItemData at their own
        // index — no second fetch needed.
        const { childrenOf, claimed } = groupBundleRows(
          grLines,
          (row) => row.item_id,
        );

        // Consolidate is_parent_split=1 rows (parent_or_child === "Split-Parent")
        // that share a po_line_item_id into ONE combined PI line. The combined
        // line carries gr_line_id === "" (the save-back's "combined" signal) and
        // sums received/remaining. The per-split breakdown is re-derived from the
        // GR document at save time and invoiced qty distributed fill-order.
        const splitGroups = new Map();
        for (const [index, grItem] of grLines.entries()) {
          // Already nested under its bundle row below; not a line of its own.
          if (claimed.has(index)) continue;

          const poLine = poLineItemData[index];
          const remaining = grItem.received_qty - (grItem.invoice_qty || 0);

          if (grItem.parent_or_child === "Split-Parent") {
            const key = grItem.po_line_item_id;
            const existing = splitGroups.get(key);
            if (!existing) {
              splitGroups.set(key, {
                material_id: grItem.item_id || "",
                material_name: grItem.item_name,
                item_desc: grItem.item_desc || "",
                more_desc: grItem.more_desc || "",
                order_qty: grItem.ordered_qty,
                received_qty: grItem.received_qty || 0,
                purchase_order_no: grItem.line_po_no,
                goods_receiving_no: gr.goods_receiving_number,
                line_remark_1: grItem.line_remark_1 || "",
                line_remark_2: grItem.line_remark_2 || "",
                invoice_qty: remaining,
                quantity_uom: grItem.item_uom,
                order_unit_price: grItem.unit_price,
                order_discount: poLine.discount,
                discount_uom: poLine.discount_uom,
                tax_percent: poLine.tax_percent,
                tax_preference: poLine.tax_preference,
                tax_inclusive: poLine.tax_inclusive,
                gr_line_id: "",
                po_line_id: grItem.po_line_item_id,
                available_inv_qty: remaining,
                line_po_id: grItem.line_po_id,
                line_gr_id: gr.goods_receiving_id,
                item_category_id: grItem.item_category_id,
                tariff_id: grItem.tariff_id,
                further_description: grItem.further_description,
              });
            } else {
              existing.received_qty =
                existing.received_qty + (grItem.received_qty || 0);
              existing.invoice_qty = existing.invoice_qty + remaining;
              existing.available_inv_qty = existing.invoice_qty;
            }
          } else {
            // A bundle's items are invoiced under the bundle line rather than
            // as lines of their own. Each takes its price and tax from its own
            // PO line; the bundle row has none, which is what the calculation
            // sums them onto it for.
            // Nested to begin with, or reattached from the flat rows — in
            // which case the child's PO line is poLineItemData at its own
            // index, since it is a row of grLines like any other.
            const nested = Array.isArray(grItem.children)
              ? grItem.children.map((child) => ({ child, childPOLine: null }))
              : [];
            const regrouped = (childrenOf.get(index) || []).map(
              (childIndex) => ({
                child: grLines[childIndex],
                childPOLine: poLineItemData[childIndex],
              }),
            );

            const children = (nested.length > 0 ? nested : regrouped).map(
              ({ child, childPOLine: fetched }) => {
                const childPOLine = fetched || {};
                const childRemaining =
                  child.received_qty - (child.invoice_qty || 0);

                return {
                  material_id: child.item_id || "",
                  material_name: child.item_name,
                  item_desc: child.item_desc || "",
                  more_desc: child.more_desc || "",
                  order_qty: child.ordered_qty,
                  received_qty: child.received_qty,
                  purchase_order_no: child.line_po_no,
                  goods_receiving_no: gr.goods_receiving_number,
                  line_remark_1: child.line_remark_1 || "",
                  line_remark_2: child.line_remark_2 || "",
                  invoice_qty: childRemaining,
                  quantity_uom: child.item_uom,
                  order_unit_price: child.unit_price,
                  order_discount: childPOLine.discount,
                  discount_uom: childPOLine.discount_uom,
                  tax_percent: childPOLine.tax_percent,
                  tax_preference: childPOLine.tax_preference,
                  tax_inclusive: childPOLine.tax_inclusive,
                  gr_line_id: child.id,
                  po_line_id: child.po_line_item_id,
                  available_inv_qty: childRemaining,
                  line_po_id: child.line_po_id,
                  line_gr_id: gr.goods_receiving_id,
                  item_bundle_id: child.item_bundle_id || "",
                  item_category_id: child.item_category_id,
                  tariff_id: child.tariff_id,
                  further_description: child.further_description,
                };
              },
            );

            tablePI.push({
              material_id: grItem.item_id || "",
              material_name: grItem.item_name,
              item_desc: grItem.item_desc || "",
              more_desc: grItem.more_desc || "",
              order_qty: grItem.ordered_qty,
              received_qty: grItem.received_qty,
              purchase_order_no: grItem.line_po_no,
              goods_receiving_no: gr.goods_receiving_number,
              line_remark_1: grItem.line_remark_1 || "",
              line_remark_2: grItem.line_remark_2 || "",
              invoice_qty: remaining,
              quantity_uom: grItem.item_uom,
              order_unit_price: grItem.unit_price,
              order_discount: poLine.discount,
              discount_uom: poLine.discount_uom,
              tax_percent: poLine.tax_percent,
              tax_preference: poLine.tax_preference,
              tax_inclusive: poLine.tax_inclusive,
              gr_line_id: grItem.id,
              po_line_id: grItem.po_line_item_id,
              available_inv_qty: remaining,
              line_po_id: grItem.line_po_id,
              line_gr_id: gr.goods_receiving_id,
              item_bundle_id: grItem.item_bundle_id || "",
              item_category_id: grItem.item_category_id,
              tariff_id: grItem.tariff_id,
              further_description: grItem.further_description,
              ...(children.length > 0 ? { children } : {}),
            });
          }
        }
        for (const rec of splitGroups.values()) {
          tablePI.push(rec);
        }
      }
      break;

    case "Item - PO":
      for (const poItem of currentItemArray) {
        const newTablePIRecord = {
          material_id: poItem.item?.id || "",
          material_name: poItem.item?.material_name,
          item_desc: poItem.item_desc || "",
          purchase_order_no: poItem.purchase_order.purchase_order_no,
          order_qty: poItem.ordered_qty,
          more_desc: poItem.more_desc || "",
          line_remark_1: poItem.line_remark_1 || "",
          line_remark_2: poItem.line_remark_2 || "",
          received_qty: poItem.received_qty,
          invoice_qty: poItem.ordered_qty - poItem.invoice_qty,
          quantity_uom: poItem.item_uom,
          order_unit_price: poItem.unit_price,
          order_discount: poItem.order_discount,
          discount_uom: poItem.discount_uom,
          tax_percent: poItem.tax_percent,
          tax_preference: poItem.tax_preference,
          tax_inclusive: poItem.tax_inclusive,
          po_line_id: poItem.purchase_order_line_id,
          gr_line_id: "",
          available_inv_qty: poItem.ordered_qty - poItem.invoice_qty,
          line_po_id: poItem.purchase_order.id,
          line_gr_id: "",
          item_bundle_id: poItem.item_bundle_id || "",
          item_category_id: poItem.item?.item_category,
          tariff_id: poItem.tariff_id,
          further_description: poItem.further_description,
        };

        // A bundle line has no item of its own — its items are invoiced under
        // it, so they come across as this line's children.
        if (poItem.item_bundle_id) {
          const bundleChildren = poItem.children?.length
            ? poItem.children
            : await fetchBundleChildren(
                "purchase_order",
                poItem.purchase_order?.id,
                "table_po",
                poItem.purchase_order_line_id,
              );

          if (bundleChildren.length > 0) {
            newTablePIRecord.children = bundleChildren.map((child) => ({
              material_id: child.item_id || "",
              material_name: child.item_name,
              item_desc: child.item_desc || "",
              purchase_order_no: poItem.purchase_order.purchase_order_no,
              order_qty: child.quantity,
              more_desc: child.more_desc || "",
              line_remark_1: child.line_remark_1 || "",
              line_remark_2: child.line_remark_2 || "",
              received_qty: child.received_qty,
              invoice_qty: child.quantity - (child.invoice_qty || 0),
              quantity_uom: child.quantity_uom,
              order_unit_price: child.unit_price,
              order_discount: child.discount,
              discount_uom: child.discount_uom,
              tax_percent: child.tax_percent,
              tax_preference: child.tax_preference,
              tax_inclusive: child.tax_inclusive,
              po_line_id: child.id,
              gr_line_id: "",
              available_inv_qty: child.quantity - (child.invoice_qty || 0),
              line_po_id: poItem.purchase_order.id,
              line_gr_id: "",
              item_bundle_id: child.item_bundle_id || "",
              item_category_id: child.item_category_id,
              tariff_id: child.tariff_id,
              further_description: child.further_description,
            }));
          }
        }

        tablePI.push(newTablePIRecord);
      }
      break;

    case "Item - GR":
      {
        // Consolidate is_parent_split=1 rows (parent_or_child === "Split-Parent")
        // sharing a po_line within the SAME GR into one combined PI line (gr_line_id
        // === ""); non-split rows stay 1:1. Save-back re-derives the split breakdown.
        const splitGroups = new Map();
        for (const grItem of currentItemArray.filter(
          (item) => item.parent_or_child !== "Child",
        )) {
          // Persisted running total on the GR line is `invoice_qty` (written by
          // the PI save-back). Fall back to the legacy `invoiced_qty` alias so
          // this works regardless of which name the selection dialog passes.
          const remaining =
            grItem.received_qty -
            (grItem.invoice_qty || grItem.invoiced_qty || 0);

          if (grItem.parent_or_child === "Split-Parent") {
            const key = `${grItem.goods_receiving_id}::${grItem.po_line_item?.id}`;
            const existing = splitGroups.get(key);
            if (!existing) {
              splitGroups.set(key, {
                material_id: grItem.item?.id || "",
                material_name: grItem.item?.material_name,
                item_desc: grItem.item_desc || "",
                more_desc: grItem.more_desc || "",
                order_qty: grItem.ordered_qty,
                received_qty: grItem.received_qty || 0,
                purchase_order_no: grItem.line_po_no,
                goods_receiving_no: grItem.goods_receiving_number,
                line_remark_1: grItem.line_remark_1 || "",
                line_remark_2: grItem.line_remark_2 || "",
                invoice_qty: remaining,
                quantity_uom: grItem.uom,
                order_unit_price: grItem.po_line_item?.unit_price,
                order_discount: grItem.po_line_item?.discount,
                discount_uom: grItem.po_line_item?.discount_uom,
                tax_percent: grItem.po_line_item?.tax_percent,
                tax_preference: grItem.po_line_item?.tax_preference,
                tax_inclusive: grItem.po_line_item?.tax_inclusive,
                gr_line_id: "",
                po_line_id: grItem.po_line_item?.id,
                available_inv_qty: remaining,
                line_po_id: grItem.line_po_id,
                line_gr_id: grItem.goods_receiving_id,
                item_category_id: grItem.item_category_id,
                tariff_id: grItem.tariff_id,
                further_description: grItem.further_description,
              });
            } else {
              existing.received_qty =
                existing.received_qty + (grItem.received_qty || 0);
              existing.invoice_qty = existing.invoice_qty + remaining;
              existing.available_inv_qty = existing.invoice_qty;
            }
          } else {
            const record = {
              material_id: grItem.item?.id || "",
              material_name: grItem.item?.material_name,
              item_desc: grItem.item_desc || "",
              more_desc: grItem.more_desc || "",
              order_qty: grItem.ordered_qty,
              received_qty: grItem.received_qty,
              purchase_order_no: grItem.line_po_no,
              goods_receiving_no: grItem.goods_receiving_number,
              line_remark_1: grItem.line_remark_1 || "",
              line_remark_2: grItem.line_remark_2 || "",
              invoice_qty: remaining,
              quantity_uom: grItem.uom,
              order_unit_price: grItem.po_line_item?.unit_price,
              order_discount: grItem.po_line_item?.discount,
              discount_uom: grItem.po_line_item?.discount_uom,
              tax_percent: grItem.po_line_item?.tax_percent,
              tax_preference: grItem.po_line_item?.tax_preference,
              tax_inclusive: grItem.po_line_item?.tax_inclusive,
              gr_line_id: grItem.goods_receiving_line_id,
              po_line_id: grItem.po_line_item?.id,
              available_inv_qty: remaining,
              line_po_id: grItem.line_po_id,
              line_gr_id: grItem.goods_receiving_id,
              item_bundle_id: grItem.item_bundle_id || "",
              item_category_id: grItem.item_category_id,
              tariff_id: grItem.tariff_id,
              further_description: grItem.further_description,
            };

            // A bundle line has no item of its own — its items are invoiced
            // under it, so they come across as this line's children.
            if (grItem.item_bundle_id) {
              const bundleChildren = grItem.children?.length
                ? grItem.children
                : await fetchBundleChildren(
                    "goods_receiving",
                    grItem.goods_receiving_id,
                    "table_gr",
                    grItem.goods_receiving_line_id,
                  );

              if (bundleChildren.length > 0) {
                // A GR line carries no discount or tax: those live on the PO
                // line behind it, so each item's PO line is fetched.
                const childPOLines = new Map(
                  (
                    await fetchPOLineItemData(
                      bundleChildren
                        .map((child) => child.po_line_item_id)
                        .filter((lineId) => lineId),
                    )
                  )
                    .filter((line) => line)
                    .map((line) => [line.id, line]),
                );

                record.children = bundleChildren.map((child) => {
                  const childPOLine =
                    childPOLines.get(child.po_line_item_id) || {};
                  const childRemaining =
                    child.received_qty - (child.invoice_qty || 0);

                  return {
                    material_id: child.item_id || "",
                    material_name: child.item_name,
                    item_desc: child.item_desc || "",
                    more_desc: child.more_desc || "",
                    order_qty: child.ordered_qty,
                    received_qty: child.received_qty,
                    purchase_order_no: child.line_po_no,
                    goods_receiving_no: grItem.goods_receiving_number,
                    line_remark_1: child.line_remark_1 || "",
                    line_remark_2: child.line_remark_2 || "",
                    invoice_qty: childRemaining,
                    quantity_uom: child.item_uom,
                    order_unit_price: child.unit_price,
                    order_discount: childPOLine.discount,
                    discount_uom: childPOLine.discount_uom,
                    tax_percent: childPOLine.tax_percent,
                    tax_preference: childPOLine.tax_preference,
                    tax_inclusive: childPOLine.tax_inclusive,
                    gr_line_id: child.id,
                    po_line_id: child.po_line_item_id,
                    available_inv_qty: childRemaining,
                    line_po_id: child.line_po_id,
                    line_gr_id: grItem.goods_receiving_id,
                    item_bundle_id: child.item_bundle_id || "",
                    item_category_id: child.item_category_id,
                    tariff_id: child.tariff_id,
                    further_description: child.further_description,
                  };
                });
              }
            }

            tablePI.push(record);
          }
        }
        for (const rec of splitGroups.values()) {
          tablePI.push(rec);
        }
      }
      break;
  }

  // Dedup key:
  // - GR-based single line -> gr:<gr_line_id> (unique per GR sub-row)
  // - combined split-parent line (gr_line_id empty, has line_gr_id)
  //   -> grc:<line_gr_id>:<po_line_id> (unique per GR + PO line)
  // - PO-based line -> po:<po_line_id>
  const dedupKey = (pi) => {
    if (pi.gr_line_id && pi.gr_line_id !== "") return `gr:${pi.gr_line_id}`;
    if (pi.line_gr_id && pi.line_gr_id !== "")
      return `grc:${pi.line_gr_id}:${pi.po_line_id}`;
    return `po:${pi.po_line_id}`;
  };
  // table_pi is a tree: a bundle is one row with its items under `children`. The
  // keys have to be read off every row, not just the top level -- an item already
  // sitting under a bundle was invisible to the dedupe, so re-adding the same
  // goods receiving laid its items down a second time as new top-level rows.
  const flattenPiRows = (rows) => {
    const flat = [];

    for (const row of rows || []) {
      flat.push(row);

      for (const child of Array.isArray(row.children) ? row.children : []) {
        flat.push(child);
      }
    }

    return flat;
  };

  const existingKeys = new Set(flattenPiRows(existingPI).map(dedupKey));

  // A bundle goes on the invoice whole or not at all, so it is dropped when any
  // part of it is already there.
  const alreadyPresent = (pi) =>
    flattenPiRows([pi]).some((row) => existingKeys.has(dedupKey(row)));

  tablePI = tablePI.filter(
    (pi) => pi.invoice_qty !== 0 && !alreadyPresent(pi),
  );

  const latestTablePI = [...existingPI, ...tablePI];

  // Flat as well: a bundle's items reference a purchase order and a goods
  // receiving of their own, and those would otherwise never reach the header.
  const latestFlatPI = flattenPiRows(latestTablePI);

  poId = [...new Set(latestFlatPI.map((pi) => pi.line_po_id))];
  purchaseOrderNumber = [
    ...new Set(latestFlatPI.map((pi) => pi.purchase_order_no)),
  ];

  grId = [...new Set(latestFlatPI.map((pi) => pi.line_gr_id))];
  goodsReceivingNumber = [
    ...new Set(latestFlatPI.map((pi) => pi.goods_receiving_no)),
  ];

  console.log("tablePI", tablePI);
  const headerCustomFields = await fillPiCustomFields(tablePI, currentItemArray, existingPI.length === 0);
  await this.setData({
    supplier_name: referenceType.startsWith("Document")
      ? currentItemArray[0].supplier_id
      : currentItemArray[0].supplier.id,
    table_pi: [...existingPI, ...tablePI],
    po_no_display: purchaseOrderNumber.join(", "),
    po_id: poId,
    gr_no_display: goodsReceivingNumber.join(", "),
    gr_id: grId,
    reference_type: referenceType,
    ...(headerCustomFields ? { custom_fields_d10wd6ob: headerCustomFields } : {}),
  });

  setTimeout(async () => {
    await processData(tablePI, referenceType);
  }, 50);

  this.triggerEvent("PIcalculation", { PIlineItem: tablePI });
  this.triggerEvent("onChange_supplier");

  this.hideLoading();
})();
