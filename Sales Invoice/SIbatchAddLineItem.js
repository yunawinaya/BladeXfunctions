const checkExistingSOinSI = async (gdArray) => {
  const gdNumbersWithSI = new Set(); // Use Set to avoid duplicates

  await Promise.all(
    gdArray.flatMap((gd) =>
      gd.sales_order_id.map((soId) =>
        db
          .collection("sales_invoice")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "so_id", operator: "in", value: soId.id },
                { prop: "gd_no_display", operator: "isNull", value: null },
              ],
            },
          ])
          .get()
          .then((response) => {
            if (response.data[0]) {
              // Only add gd number if PI exists
              gdNumbersWithSI.add(gd.goods_delivery_number);
            }
          }),
      ),
    ),
  );

  console.log("gd numbers with existing SIs:", Array.from(gdNumbersWithSI));
  return Array.from(gdNumbersWithSI);
};

const fetchSOLineItemData = async (soLineItemIDs) => {
  const resSOLineItem = await Promise.all(
    soLineItemIDs.map((lineId) =>
      db.collection("sales_order_axszx8cj_sub").doc(lineId).get(),
    ),
  );

  const soLineItemData = resSOLineItem.map((response) => response.data[0]);
  return soLineItemData;
};

// How a sales return is billed is a per-plant setting. The default, and what
// every setup row does today, is a credit note raised after the fact. The other
// method nets the returned quantity off what is invoiced in the first place --
// the two are alternatives, since applying both credits the customer twice.
//
// Only the "Sales Return" timing is honoured: the delivery line carries the
// EXPECTED return quantity, written when the return is issued, and there is no
// received figure on it for the "Sales Return Receiving" timing to read.
// Scoped by ORGANISATION, not plant. plant_id on a sales invoice can hold an
// organisation rather than a plant -- the same as on a sales order, and that is
// what a document spanning several plants stores -- so a plant-keyed lookup finds
// nothing and the setting silently reads as off. Every plant row in an org is
// written with the same values by the setup page's save, so any row for the
// organisation answers the question.
const fetchDeductReturnQty = async (organizationId) => {
  if (!organizationId) return false;

  const res = await db
    .collection("sales_return_setup")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          { prop: "organization_id", operator: "equal", value: organizationId },
          { prop: "is_deleted", operator: "equal", value: 0 },
        ],
      },
    ])
    .get();

  const setup = res?.data?.[0];
  if (!setup) return false;

  // Unset until the column is configured, and unset means the credit note.
  return (
    setup.return_billing_method === "Deduct from Invoice" &&
    setup.trigger_by === "Sales Return"
  );
};

// The item-first pickers hand over rows built in the browser, which are not
// guaranteed to carry return_qty. Fetching by the PARENT document rather than
// by the selected line ids brings back that document's bundle children too, so
// one query covers every row the mapping below can reach.
const fetchReturnQtyMap = async (collection, prop, parentIds) => {
  const ids = [...new Set((parentIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();

  const res = await db
    .collection(collection)
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop, operator: "in", value: ids }],
      },
    ])
    .get();

  return new Map(
    (res?.data || []).map((line) => [
      String(line.id),
      parseFloat(line.return_qty) || 0,
    ]),
  );
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
// place the Document - SO / Document - GD paths take them from. Both tree
// shapes are covered, since groupBundleRows reattaches flat rows as well as
// returning nested ones untouched.
const fetchBundleChildren = async (collection, docId, tableField, lineId, getItemId) => {
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

  const { childrenOf } = groupBundleRows(rows, getItemId);

  return (childrenOf.get(lineIndex) || []).map((index) => rows[index]);
};

const processData = async (referenceType, latesttableSI) => {
  this.display(["so_no_display"]);
  if (referenceType.endsWith("GD")) {
    this.display("gd_no_display");
  } else {
    this.hide("gd_no_display");
  }

  for (const [index, si] of latesttableSI.entries()) {
    const result = si.tax_percent && si.tax_percent >= 0;
    this.disabled([`table_si.${index}.tax_percent`], !result);

    if (referenceType.endsWith("GD")) {
      this.display(`table_si.line_gd_no`);
    } else {
      this.hide(`table_si.line_gd_no`);
    }
  }
};

(async () => {
  try {
    const previousReferenceType = this.getValue("reference_type");
    const currentItemArray = arguments[0].itemArray;
    let existingSI = this.getValue("table_si");
    const referenceType = arguments[0].referenceType;

    const customerName = this.getValue("customer_id");

    let tableSI = [];
    let salesOrderNumber = [];
    let soId = [];
    let goodsDeliveryNumber = [];
    let gdId = [];

    // Validation: If no item selected, pop up error and return early
    if (currentItemArray.length === 0) {
      await this.$alert(
        "Please select at least one sales order / goods delivery / item.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );

      console.log("User clicked Cancel or closed the dialog");
      return;
    }

    // Validation: If reference type changed, pop up confirmation dialog to confirm with user, if confirmed, reset existing SI line items
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

      existingSI = [];
    }

    // Check Customer
    const uniqueCustomers = new Set(
      currentItemArray.map((item) =>
        referenceType.startsWith("Document")
          ? item.customer_id
          : item.customer.id,
      ),
    );
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      await this.$alert(
        "Invoiced item(s) from more than two different customers is not allowed.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );

      console.log("User clicked Cancel or closed the dialog");
      return;
    }
    if (customerName && customerName !== [...uniqueCustomers][0]) {
      await this.$confirm(
        `You've selected a different customer than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
        "Different Customer Detected",
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

      existingSI = [];
    }

    // If reference type is GD, check if selected GD has existing SI, if has, pop up dialog to inform user and return early
    if (referenceType === "Document - GD" || referenceType === "Item - GD") {
      const existingGDNumbers = await checkExistingSOinSI(currentItemArray);

      // if has existing purchase invoice, pop dialog and reset gr
      if (existingGDNumbers && existingGDNumbers.length > 0) {
        await this.$alert(
          `Sales Order(s) in the ${existingGDNumbers.join(
            ", ",
          )} has existing Sales Invoice(s). Please choose different Goods Delivery(s).`,
          "Existing Sales Invoice(s) Detected",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: false,
          },
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          throw new Error();
        });
      }
    }

    // TEMP GUARD: block combining internal-trading and non-internal documents in
    // one Sales Invoice. Internal = the source SO/GD has a "Linked" row in
    // document_linkage (created by the PO->SO / GD->GR internal-trading flows).
    // The reference type is uniform per SI (switching type resets the table
    // above), so we classify the SO for *-SO and the GD for *-GD.
    {
      const isGD = referenceType.endsWith("GD");

      // Collect the doc ids to classify: new selection + existing SI lines, so
      // adding a non-internal document onto an already-internal invoice is caught.
      const docIdSet = new Set();
      if (isGD) {
        for (const gd of currentItemArray) {
          if (gd.goods_delivery_id) docIdSet.add(gd.goods_delivery_id);
        }
        (existingSI || []).forEach(
          (l) => l.line_gd_id && docIdSet.add(l.line_gd_id),
        );
      } else {
        for (const so of currentItemArray) {
          const soId =
            referenceType === "Document - SO"
              ? so.sales_order_id
              : so.sales_order?.id;
          if (soId) docIdSet.add(soId);
        }
        (existingSI || []).forEach(
          (l) => l.line_so_id && docIdSet.add(l.line_so_id),
        );
      }

      const docIds = [...docIdSet];
      if (docIds.length > 0) {
        const linkRes = await db
          .collection("document_linkage")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                {
                  prop: isGD ? "source_doc_type" : "target_doc_type",
                  operator: "equal",
                  value: isGD ? "Goods Delivery" : "Sales Order",
                },
                {
                  prop: isGD ? "source_doc_id" : "target_doc_id",
                  operator: "in",
                  value: docIds,
                },
                { prop: "link_status", operator: "equal", value: "Linked" },
              ],
            },
          ])
          .get();

        const internalSet = new Set(
          (linkRes?.data || []).map((r) =>
            isGD ? r.source_doc_id : r.target_doc_id,
          ),
        );
        const internalCount = docIds.filter((id) => internalSet.has(id)).length;

        if (internalCount > 0 && internalCount < docIds.length) {
          await this.$alert(
            "Cannot combine internal trading and non-internal documents in the same Sales Invoice. Please select only one type.",
            "Error",
            { confirmButtonText: "OK", type: "error" },
          );
          return;
        }
      }
    }

    this.closeDialog("dialog_select_item");
    this.showLoading();

    const deductReturnQty = await fetchDeductReturnQty(
      this.getValue("organization_id"),
    );

    // Only the item-first modes need these; a selected document's lines are
    // read rows and carry return_qty already.
    const [returnedGDLine, returnedSOLine] = deductReturnQty
      ? await Promise.all([
          referenceType === "Item - GD"
            ? fetchReturnQtyMap(
                "goods_delivery_fwii8mvb_sub",
                "goods_delivery_id",
                currentItemArray.map((item) => item.goods_delivery_id),
              )
            : new Map(),
          referenceType === "Item - SO"
            ? fetchReturnQtyMap(
                "sales_order_axszx8cj_sub",
                "sales_order_id",
                currentItemArray.map((item) => item.sales_order?.id),
              )
            : new Map(),
        ])
      : [new Map(), new Map()];

    // Preferred from the row itself, which is exact when the row was read out of
    // a document, and otherwise from the map above.
    const returnedQty = (row, map, ...idKeys) => {
      if (!deductReturnQty) return 0;

      if (row.return_qty !== null && row.return_qty !== undefined) {
        return parseFloat(row.return_qty) || 0;
      }

      for (const key of idKeys) {
        if (row[key] && map.has(String(row[key]))) {
          return map.get(String(row[key]));
        }
      }

      return 0;
    };

    // Clamped: a line can be returned in full, and over-delivery tolerance can
    // push the subtraction below zero, which is not a quantity anyone can bill.
    const invoiceable = (delivered, invoiced, returned) =>
      Math.max(
        0,
        (parseFloat(delivered) || 0) -
          (parseFloat(invoiced) || 0) -
          (parseFloat(returned) || 0),
      );

    const gdReturned = (row) =>
      returnedQty(row, returnedGDLine, "goods_delivery_line_id", "id");
    const soReturned = (row) =>
      returnedQty(row, returnedSOLine, "sales_order_line_id", "id");

    switch (referenceType) {
      case "Document - SO":
        for (const so of currentItemArray) {
          // An item bundle is one line on the order with the bundle's items
          // beneath it, and it is invoiced the same way — the bundle row is the
          // line, its items ride along as children.
          const mapSOLine = (soItem) => {
            const record = {
              material_id: soItem.item_name || "",
              material_name: soItem.item_id,
              material_desc: soItem.so_desc || "",

              more_desc: soItem.more_desc || "",
              line_remark_1: soItem.line_remark_1 || "",
              line_remark_2: soItem.line_remark_2 || "",
              line_remark_3: soItem.line_remark_3 || "",

              line_so_no: so.sales_order_number,
              line_gd_no: "",

              so_order_quantity: soItem.so_quantity,
              so_order_uom_id: soItem.so_item_uom,
              good_delivery_quantity: soItem.delivered_qty,
              invoice_qty: invoiceable(
                soItem.so_quantity,
                soItem.invoice_qty,
                soReturned(soItem),
              ),
              available_inv_qty: invoiceable(
                soItem.so_quantity,
                soItem.invoice_qty,
                soReturned(soItem),
              ),
              invoice_qty_uom_id: soItem.so_item_uom,
              unit_price: soItem.so_item_price,
              si_discount: soItem.so_discount,
              si_discount_uom_id: soItem.so_discount_uom,
              si_tax_rate_id: soItem.so_tax_preference,
              tax_percent: soItem.so_tax_percentage,
              si_tax_inclusive: soItem.so_tax_inclusive,

              line_so_id: so.sales_order_id,
              so_line_id: soItem.id,
              line_gd_id: "",
              gd_line_id: "",
              item_category_id: soItem.item_category_id,
              custom_fields: soItem.custom_fields,
              tariff_id: soItem.tariff_id,
              trigger_calc: "No",
              further_description: soItem.further_description,
              item_bundle_id: soItem.item_bundle_id || "",
            };

            return record;
          };

          const { childrenOf, claimed } = groupBundleRows(
            so.table_so,
            (row) => row.item_name,
          );

          so.table_so.forEach((soItem, index) => {
            if (claimed.has(index)) return; // already nested under its bundle

            const record = mapSOLine(soItem);

            // Nested to begin with, or reattached from the flat rows.
            const nested = Array.isArray(soItem.children) ? soItem.children : [];
            const regrouped = (childrenOf.get(index) || []).map(
              (childIndex) => so.table_so[childIndex],
            );
            const bundleChildren = nested.length > 0 ? nested : regrouped;

            if (bundleChildren.length > 0) {
              record.children = bundleChildren.map(mapSOLine);
            }

            tableSI.push(record);
          });
        }

        break;

      case "Document - GD":
        for (const gd of currentItemArray) {
          const soLineItemIDs = gd.table_gd.map((gd) => gd.so_line_item_id);

          const soLineItemData = await fetchSOLineItemData(soLineItemIDs);
          console.log("soLineItemData", soLineItemData);

          // An item bundle is delivered as a whole, so a bundle row and its
          // items are siblings in table_gd — which means each item's order line
          // is already sitting in soLineItemData at its own index.
          const { childrenOf, claimed } = groupBundleRows(
            gd.table_gd,
            (row) => row.material_id,
          );

          // A delivery line carries no price, discount or tax: all three live on
          // the order line behind it, which is what soLine is.
          const mapGDLine = (gdItem, soLine) => {
            const record = {
              material_id: gdItem.material_id || "",
              material_name: gdItem.material_name,
              material_desc: gdItem.gd_material_desc || "",

              more_desc: gdItem.more_desc || "",
              line_remark_1: gdItem.line_remark_1 || "",
              line_remark_2: gdItem.line_remark_2 || "",
              line_remark_3: gdItem.line_remark_3 || "",

              line_so_no: gdItem.line_so_no,
              line_gd_no: gd.goods_delivery_number,

              so_order_quantity: gdItem.gd_order_quantity,
              so_order_uom_id: gdItem.good_delivery_uom_id,
              good_delivery_quantity: gdItem.gd_qty,
              invoice_qty: invoiceable(
                gdItem.gd_qty,
                gdItem.invoice_qty,
                gdReturned(gdItem),
              ),
              available_inv_qty: invoiceable(
                gdItem.gd_qty,
                gdItem.invoice_qty,
                gdReturned(gdItem),
              ),
              invoice_qty_uom_id: gdItem.good_delivery_uom_id,
              unit_price: soLine?.so_item_price,
              si_discount: soLine?.so_discount,
              si_discount_uom_id: soLine?.so_discount_uom,
              si_tax_rate_id: soLine?.so_tax_preference,
              tax_percent: soLine?.so_tax_percentage,
              si_tax_inclusive: soLine?.so_tax_inclusive,
              custom_fields: gdItem.custom_fields,
              line_so_id: gdItem.line_so_id,
              so_line_id: gdItem.so_line_item_id,
              line_gd_id: gd.goods_delivery_id,
              gd_line_id: gdItem.id,
              item_category_id: gdItem.item_category_id,
              tariff_id: gdItem.tariff_id,
              trigger_calc: "No",
              further_description: gdItem.further_description,
              item_bundle_id: gdItem.item_bundle_id || "",
            };

            return record;
          };

          for (const [index, gdItem] of gd.table_gd.entries()) {
            if (claimed.has(index)) continue; // already nested under its bundle

            const record = mapGDLine(gdItem, soLineItemData[index]);

            const nested = Array.isArray(gdItem.children) ? gdItem.children : [];

            // A row reattached from the flat list already has its order line at
            // its own index; a row that arrived nested is not in that list, so
            // its order line is fetched.
            const bundleChildren =
              nested.length > 0
                ? (
                    await fetchSOLineItemData(
                      nested.map((child) => child.so_line_item_id),
                    )
                  ).map((soLine, childIndex) => ({
                    row: nested[childIndex],
                    soLine,
                  }))
                : (childrenOf.get(index) || []).map((childIndex) => ({
                    row: gd.table_gd[childIndex],
                    soLine: soLineItemData[childIndex],
                  }));

            if (bundleChildren.length > 0) {
              record.children = bundleChildren.map(({ row, soLine }) =>
                mapGDLine(row, soLine),
              );
            }

            tableSI.push(record);
          }
        }
        break;

      case "Item - SO":
        for (const soItem of currentItemArray) {
          const newtableSIRecord = {
            material_id: soItem.item?.id || "",
            material_name: soItem.item?.material_name,
            material_desc: soItem.item_desc || "",

            more_desc: soItem.more_desc || "",
            line_remark_1: soItem.line_remark_1 || "",
            line_remark_2: soItem.line_remark_2 || "",
            line_remark_3: soItem.line_remark_3 || "",

            line_so_no: soItem.sales_order?.so_no,
            line_gd_no: "",

            so_order_quantity: soItem.so_quantity,
            so_order_uom_id: soItem.so_item_uom,
            good_delivery_quantity: soItem.delivered_qty,
            invoice_qty: invoiceable(
              soItem.so_quantity,
              soItem.invoice_qty,
              soReturned(soItem),
            ),
            available_inv_qty: invoiceable(
              soItem.so_quantity,
              soItem.invoice_qty,
              soReturned(soItem),
            ),
            invoice_qty_uom_id: soItem.so_item_uom,
            unit_price: soItem.so_item_price,
            si_discount: soItem.so_discount,
            si_discount_uom_id: soItem.so_discount_uom,
            si_tax_rate_id: soItem.so_tax_preference,
            tax_percent: soItem.so_tax_percentage,
            si_tax_inclusive: soItem.so_tax_inclusive,

            line_so_id: soItem.sales_order?.id,
            so_line_id: soItem.sales_order_line_id,
            line_gd_id: "",
            gd_line_id: "",
            item_category_id: soItem.item?.item_category,
            custom_fields: soItem.custom_fields,
            tariff_id: soItem.tariff_id,
            trigger_calc: "No",
            further_description: soItem.further_description,
            item_bundle_id: soItem.item_bundle_id || "",
          };

          // A bundle line has no item of its own — its items are invoiced under
          // it, so they come across as this line's children. They are read off
          // the order, where the fields carry their stored names.
          if (soItem.item_bundle_id) {
            const bundleChildren = soItem.children?.length
              ? soItem.children
              : await fetchBundleChildren(
                  "sales_order",
                  soItem.sales_order?.id,
                  "table_so",
                  soItem.sales_order_line_id,
                  (row) => row.item_name,
                );

            if (bundleChildren.length > 0) {
              newtableSIRecord.children = bundleChildren.map((child) => ({
                material_id: child.item_name || "",
                material_name: child.item_id,
                material_desc: child.so_desc || "",

                more_desc: child.more_desc || "",
                line_remark_1: child.line_remark_1 || "",
                line_remark_2: child.line_remark_2 || "",
                line_remark_3: child.line_remark_3 || "",

                line_so_no: soItem.sales_order?.so_no,
                line_gd_no: "",

                so_order_quantity: child.so_quantity,
                so_order_uom_id: child.so_item_uom,
                good_delivery_quantity: child.delivered_qty,
                invoice_qty: invoiceable(
                  child.so_quantity,
                  child.invoice_qty,
                  soReturned(child),
                ),
                available_inv_qty: invoiceable(
                  child.so_quantity,
                  child.invoice_qty,
                  soReturned(child),
                ),
                invoice_qty_uom_id: child.so_item_uom,
                unit_price: child.so_item_price,
                si_discount: child.so_discount,
                si_discount_uom_id: child.so_discount_uom,
                si_tax_rate_id: child.so_tax_preference,
                tax_percent: child.so_tax_percentage,
                si_tax_inclusive: child.so_tax_inclusive,

                line_so_id: soItem.sales_order?.id,
                so_line_id: child.id,
                line_gd_id: "",
                gd_line_id: "",
                item_category_id: child.item_category_id,
                custom_fields: child.custom_fields,
                tariff_id: child.tariff_id,
                trigger_calc: "No",
                further_description: child.further_description,
                item_bundle_id: child.item_bundle_id || "",
              }));
            }
          }

          tableSI.push(newtableSIRecord);
        }
        break;

      case "Item - GD":
        for (const gdItem of currentItemArray) {
          const newtableSIRecord = {
            material_id: gdItem.item?.id || "",
            material_name: gdItem.item?.material_name,
            material_desc: gdItem.item_desc || "",

            more_desc: gdItem.more_desc || "",
            line_remark_1: gdItem.line_remark_1 || "",
            line_remark_2: gdItem.line_remark_2 || "",
            line_remark_3: gdItem.line_remark_3 || "",

            line_so_no: gdItem.line_so_no,
            line_gd_no: gdItem.goods_delivery_number,

            so_order_quantity: gdItem.ordered_qty,
            so_order_uom_id: gdItem.uom,
            good_delivery_quantity: gdItem.delivered_qty,
            invoice_qty: invoiceable(
              gdItem.delivered_qty,
              gdItem.invoiced_qty,
              gdReturned(gdItem),
            ),
            available_inv_qty: invoiceable(
              gdItem.delivered_qty,
              gdItem.invoiced_qty,
              gdReturned(gdItem),
            ),
            invoice_qty_uom_id: gdItem.uom,
            unit_price: gdItem.so_line_item?.so_item_price,
            si_discount: gdItem.so_line_item?.so_discount,
            si_discount_uom_id: gdItem.so_line_item?.so_discount_uom,
            si_tax_rate_id: gdItem.so_line_item?.so_tax_preference,
            tax_percent: gdItem.so_line_item?.so_tax_percentage,
            si_tax_inclusive: gdItem.so_line_item?.so_tax_inclusive,

            line_so_id: gdItem.line_so_id,
            so_line_id: gdItem.so_line_item?.id,
            line_gd_id: gdItem.goods_delivery_id,
            gd_line_id: gdItem.goods_delivery_line_id,
            item_category_id: gdItem.item?.item_category,
            custom_fields: gdItem.custom_fields,
            tariff_id: gdItem.tariff_id,
            trigger_calc: "No",
            further_description: gdItem.further_description,
            item_bundle_id: gdItem.item_bundle_id || "",
          };

          // A bundle line has no item of its own — its items are invoiced under
          // it, so they come across as this line's children. A delivery line
          // carries no price or tax, so each item's own order line is fetched.
          if (gdItem.item_bundle_id) {
            const bundleChildren = gdItem.children?.length
              ? gdItem.children
              : await fetchBundleChildren(
                  "goods_delivery",
                  gdItem.goods_delivery_id,
                  "table_gd",
                  gdItem.goods_delivery_line_id,
                  (row) => row.material_id,
                );

            if (bundleChildren.length > 0) {
              const childSOLines = await fetchSOLineItemData(
                bundleChildren.map((child) => child.so_line_item_id),
              );

              newtableSIRecord.children = bundleChildren.map((child, i) => {
                const soLine = childSOLines[i];

                return {
                  material_id: child.material_id || "",
                  material_name: child.material_name,
                  material_desc: child.gd_material_desc || "",

                  more_desc: child.more_desc || "",
                  line_remark_1: child.line_remark_1 || "",
                  line_remark_2: child.line_remark_2 || "",
                  line_remark_3: child.line_remark_3 || "",

                  line_so_no: child.line_so_no,
                  line_gd_no: gdItem.goods_delivery_number,

                  so_order_quantity: child.gd_order_quantity,
                  so_order_uom_id: child.good_delivery_uom_id,
                  good_delivery_quantity: child.gd_qty,
                  invoice_qty: invoiceable(
                    child.gd_qty,
                    child.invoice_qty,
                    gdReturned(child),
                  ),
                  available_inv_qty: invoiceable(
                    child.gd_qty,
                    child.invoice_qty,
                    gdReturned(child),
                  ),
                  invoice_qty_uom_id: child.good_delivery_uom_id,
                  unit_price: soLine?.so_item_price,
                  si_discount: soLine?.so_discount,
                  si_discount_uom_id: soLine?.so_discount_uom,
                  si_tax_rate_id: soLine?.so_tax_preference,
                  tax_percent: soLine?.so_tax_percentage,
                  si_tax_inclusive: soLine?.so_tax_inclusive,

                  line_so_id: child.line_so_id,
                  so_line_id: child.so_line_item_id,
                  line_gd_id: gdItem.goods_delivery_id,
                  gd_line_id: child.id,
                  item_category_id: child.item_category_id,
                  custom_fields: child.custom_fields,
                  tariff_id: child.tariff_id,
                  trigger_calc: "No",
                  further_description: child.further_description,
                  item_bundle_id: child.item_bundle_id || "",
                };
              });
            }
          }

          tableSI.push(newtableSIRecord);
        }
        break;

      default:
        break;
    }

    tableSI = tableSI.filter(
      (si) =>
        si.invoice_qty !== 0 &&
        !existingSI.find((siItem) => siItem.so_line_id === si.so_line_id),
    );

    const latesttableSI = [...existingSI, ...tableSI];

    soId = [...new Set(latesttableSI.map((si) => si.line_so_id))];
    salesOrderNumber = [...new Set(latesttableSI.map((si) => si.line_so_no))];

    gdId = [...new Set(latesttableSI.map((si) => si.line_gd_id))];
    goodsDeliveryNumber = [
      ...new Set(latesttableSI.map((si) => si.line_gd_no)),
    ];

    console.log("tableSI", tableSI);
    await this.setData({
      customer_id: referenceType.startsWith("Document")
        ? currentItemArray[0].customer_id
        : currentItemArray[0].customer.id,
      so_no_display: salesOrderNumber.join(", "),
      so_id: soId,
      gd_no_display: goodsDeliveryNumber.join(", "),
      gd_id: gdId,
      table_si: [...existingSI, ...tableSI],
      reference_type: referenceType,
    });

    setTimeout(async () => {
      await processData(referenceType, latesttableSI);
    }, 50);

    for (const [index, item] of latesttableSI.entries()) {
      let Row = {};
      Row.row = item;
      Row.rowIndex = index;

      this.triggerEvent("SIcalculation", Row);
    }
    this.hideLoading();
  } catch (error) {
    console.error(error);
    this.hideLoading();
  }
})();
