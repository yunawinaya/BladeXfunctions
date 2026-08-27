// table_picking_items is a TREE: an item bundle is ONE row with the items under
// it as `children`. Every per-row loop below walks this flat view, because a
// nested item has no top-level index -- addressing it by one would write to a
// different row, or to nothing at all.
//
// Each entry carries the path that addresses its row, so this.setData,
// this.disabled, this.hide and this.setOptionData all reach a nested item the
// same way GR reaches its own nested children. A document with no bundles
// flattens to itself.
const flatPickingRows = (rows) => {
  const flat = [];

  (rows || []).forEach((row, index) => {
    flat.push({ row, path: `table_picking_items.${index}` });

    const children = Array.isArray(row.children) ? row.children : [];

    children.forEach((child, childIndex) => {
      flat.push({
        row: child,
        path: `table_picking_items.${index}.children.${childIndex}`,
      });
    });
  });

  return flat;
};

// Helper functions
const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const disabledField = async (status) => {
  if (status === "Completed") {
    this.disabled(
      [
        "sp_status",
        "plant_id",
        "sp_id",
        "movement_type",
        "ref_doc_type",
        "src_id",
        "src_no",
          "assigned_to",
        "created_by",
        "created_at",
        "organization_id",
        "ref_doc",
        "table_picking_items",
        "table_picking_records",
        "remarks",
        "remarks_2",
        "remarks_3",
      ],
      true,
    );

    this.hide([
      "button_save_as_draft",
      "button_inprogress",
      "button_completed",
    ]);

    // Disable table rows
    disableTableRows();
  } else {
    if (status === "Created") {
      this.hide(["button_save_as_draft"]);
    }
    this.disabled(["ref_doc"], false);
  }
};

const disableTableRows = () => {
  setTimeout(() => {
    const data = this.getValues();
    const rows = data.table_picking_items || [];

    flatPickingRows(rows).forEach(({ row, path }) => {
      const fieldNames = Object.keys(row).filter(
        (key) => key !== "picked_qty" && key !== "children",
      );

      const fieldsToDisable = fieldNames.map((field) => `${path}.${field}`);

      this.disabled(fieldsToDisable, true);
    });
  }, 1000);
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  const plant = this.getValue("plant_id");

  if (!plant) {
    if (deptId === organizationId) {
      const resPlant = await db
        .collection("blade_dept")
        .where({ parent_id: deptId })
        .get();

      if (!resPlant && resPlant.data.length === 0) {
        plantId = deptId;
      } else {
        plantId = "";
      }
    } else {
      plantId = deptId;
    }
  }

  this.setData({
    organization_id: organizationId,
    ...(!plant ? { plant_id: plantId } : {}),
    created_at: new Date().toISOString().split("T")[0],
  });
};

const viewSerialNumber = async () => {
  const table_picking_items = this.getValue("table_picking_items");
  const table_picking_records = this.getValue("table_picking_records");
  if (table_picking_items.length > 0) {
    for (const { row: picking } of flatPickingRows(table_picking_items)) {
      if (picking.is_serialized_item === 1) {
        await this.display([
          "table_picking_items.select_serial_number",
          "table_picking_items.serial_numbers",
        ]);
      }
    }
  }
  if (table_picking_records.length > 0) {
    for (const picking of table_picking_records) {
      if (picking.serial_numbers !== "" && picking.serial_numbers !== null) {
        await this.display("table_picking_records.serial_numbers");
      }
    }
  }
};

const setSerialNumber = async () => {
  try {
    const table_picking_items = this.getValue("table_picking_items");

    // Check if table_picking_items exists and is an array
    if (
      !Array.isArray(table_picking_items) ||
      table_picking_items.length === 0
    ) {
      console.log("No picking items found or invalid data structure");
      return;
    }

    for (const [index, { row: picking, path }] of flatPickingRows(
      table_picking_items,
    ).entries()) {
      try {
        // Check if item is serialized
        if (picking.is_serialized_item === 1) {
          console.log(
            `Processing serialized item at index ${index}:`,
            picking.item_code || picking.id,
          );

          // Check if serial_numbers exists and is not empty
          if (
            !picking.serial_numbers ||
            picking.serial_numbers === null ||
            picking.serial_numbers === undefined ||
            typeof picking.serial_numbers !== "string" ||
            picking.serial_numbers.trim() === ""
          ) {
            console.warn(
              `No valid serial numbers found for item at index ${index}`,
            );
            continue;
          }

          console.log("Picking Serial Numbers", picking.serial_numbers);

          // Split and clean serial numbers
          const serialNumbers = picking.serial_numbers
            .split(",")
            .map((sn) => sn.trim())
            .filter((sn) => sn !== "");

          if (serialNumbers.length === 0) {
            console.warn(
              `No valid serial numbers after processing for item at index ${index}`,
            );
            continue;
          }

          console.log(
            `Setting ${serialNumbers.length} serial numbers for item at index ${index}:`,
            serialNumbers,
          );

          // Set option data for select dropdown
          await this.setOptionData(
            [`${path}.select_serial_number`],
            serialNumbers,
          );

          // Set the actual data
          await this.setData({
            [`${path}.select_serial_number`]:
              serialNumbers,
          });

          // Disable picked_qty + Pick UOM for serialized items (qty is driven
          // by the serial-number count, so UOM switching is meaningless here)
          await this.disabled(
            [
              `${path}.picked_qty`,
              `${path}.picking_uom`,
            ],
            true,
          );

          console.log(
            `Successfully set serial numbers for item at index ${index}`,
          );
        }
      } catch (itemError) {
        console.error(`Error processing item at index ${index}:`, itemError);
        // Continue with next item instead of breaking the entire function
        continue;
      }
    }
  } catch (error) {
    console.error("Error in setSerialNumber function:", error);
    // Don't throw error to prevent breaking the entire onMounted flow
  }
};

// The source movement lives in one of three collections; ref_doc_type picks it.
// db.collection() takes the DISPLAY name, which equals the dict_key here.
const SRC_COLLECTION = {
  "Location Transfer": "Location Transfer",
  "Plant Transfer": "Plant Transfer",
  "Miscellaneous Issue": "Miscellaneous Issue",
};

const disabledPickedQtyField = async () => {
  const srcIDs = srcIdList();
  const refDocType = await this.getValue("ref_doc_type");
  const collection = SRC_COLLECTION[refDocType];
  if (!collection || srcIDs.length === 0) return;

  const resGD = await Promise.all(
    srcIDs.map((srcId) => db.collection(collection).doc(srcId).get()),
  );

const gdData = resGD.map((gd) => gd.data[0]).filter(Boolean);
  const cancelledGD = gdData.filter(
    (src) => src.stock_movement_status === "Cancelled",
  );
  const tablePickingItems = this.getValue("table_picking_items");
  if (tablePickingItems.length > 0) {
    for (const { row: picking, path } of flatPickingRows(tablePickingItems)) {
      const cancelGD = cancelledGD.find((gd) => gd.id === picking.src_id);
      console.log("cancelGD", cancelGD);
      if (picking.line_status === "Cancelled" || cancelGD) {
        setTimeout(async () => {
          this.disabled(
            [
              `${path}.picked_qty`,
              `${path}.picking_uom`,
              `${path}.remark`,
              `${path}.select_serial_number`,
            ],
            true,
          );
        }, 100);
      }
    }
  }
};

// --- Pick UOM conversion helpers (mirror of GDdialogUOMchange.js) ----------
const convertBaseToAlt = (baseQty, tableUomConversion, uom) => {
  if (
    !Array.isArray(tableUomConversion) ||
    tableUomConversion.length === 0 ||
    !uom
  ) {
    return baseQty;
  }
  const conv = tableUomConversion.find((c) => c.alt_uom_id === uom);
  if (!conv || !conv.base_qty) return baseQty;
  return Math.round((baseQty / conv.base_qty) * 1000) / 1000;
};

const convertQuantityFromTo = (
  value,
  tableUomConversion,
  fromUOM,
  toUOM,
  baseUOM,
) => {
  if (!value || fromUOM === toUOM) return value;
  // current UOM -> base UOM
  let baseQty = value;
  if (fromUOM !== baseUOM) {
    const fromConv = (tableUomConversion || []).find(
      (c) => c.alt_uom_id === fromUOM,
    );
    if (fromConv && fromConv.base_qty) {
      baseQty = value * fromConv.base_qty;
    }
  }
  // base UOM -> target UOM
  return convertBaseToAlt(baseQty, tableUomConversion, toUOM);
};

// Base-UOM units per 1 unit of `uom` (the conversion factor; 1 when uom is the
// base UOM itself or has no conversion entry). The workflow funnel uses the
// order/picking pair (picking_base_qty / order_base_qty) to convert the picked
// qty back to the order UOM exactly, without re-fetching the item master.
const getBaseQtyForUom = (uom, basedUom, tableUomConversion) => {
  if (!uom) return 1;
  if (String(uom) === String(basedUom)) return 1;
  const c = (tableUomConversion || []).find((x) => x.alt_uom_id === uom);
  return c && c.base_qty ? c.base_qty : 1;
};

// Fetch the item master + UOM names for every distinct material in the picking
// table, cache the conversion data on window.pickingUOMCache (read by the
// validator / onChange handlers), populate the per-row Pick UOM dropdown with
// the item's valid UOMs (base + alternates), and seed the read-only alt-UOM
// display columns (to_pick_alt / pending_alt). Quantities themselves stay in
// the order UOM — only the picker-facing display is in the chosen Pick UOM.
const enrichPickingUOM = async () => {
  try {
    const rows = this.getValue("table_picking_items") || [];
    if (rows.length === 0) return;

    // Flat: a bundle's items are the rows carrying materials, so reading the top
    // level alone left them out of the cache entirely -- their conversion data was
    // never fetched and every conversion silently fell back to identity.
    const flatRows = flatPickingRows(rows);

    const materialIds = [
      ...new Set(
        flatRows
          .filter((e) => e.row.row_type !== "header" && e.row.item_code)
          .map((e) => String(e.row.item_code)),
      ),
    ];
    if (materialIds.length === 0) return;

    // Batched item master fetch (one doc().get() per distinct material).
    const itemResults = await Promise.all(
      materialIds.map((id) =>
        db
          .collection("Item")
          .doc(id)
          .get()
          .catch(() => null),
      ),
    );

    // Cache each item's conversion data (base UOM + conversion table) on
    // window.pickingUOMCache. The picking_uom DROPDOWN OPTIONS are populated by
    // the form's own item-bound datasource, so we don't build/override them
    // here — this cache only feeds the conversion math used by the validator,
    // the Pick UOM onChange handler, hu_select, and the scalars/displays below.
    if (!window.pickingUOMCache) window.pickingUOMCache = {};
    itemResults.forEach((res, i) => {
      const item = res && res.data && res.data[0] ? res.data[0] : null;
      if (!item) return;
      window.pickingUOMCache[materialIds[i]] = {
        based_uom: item.based_uom,
        table_uom_conversion: Array.isArray(item.table_uom_conversion)
          ? item.table_uom_conversion
          : [],
      };
    });

    // Apply per-row: default Pick UOM, conversion scalars, alt-UOM displays.
    const updates = {};
    for (const { row, path } of flatRows) {
      if (row.row_type === "header") continue;

      // The bundle row carries no material and no UOM -- its Pick UOM column is
      // disabled for exactly that reason -- so there is nothing to convert. Its
      // alt-UOM displays mirror the canonical quantities, which are already
      // counted in bundles. Without this the row fell out of the loop and read 0
      // beside its own items.
      if (!row.item_code) {
        updates[`${path}.to_pick_alt`] = parseFloat(row.qty_to_pick) || 0;
        updates[`${path}.pending_alt`] =
          parseFloat(row.pending_process_qty) || 0;
        continue;
      }
      const matId = String(row.item_code);
      const cache = window.pickingUOMCache[matId];
      if (!cache) continue;

      const orderUom = String(row.item_uom);
      const pickingUom = row.picking_uom ? String(row.picking_uom) : orderUom;

      if (!row.picking_uom) {
        updates[`${path}.picking_uom`] = orderUom;
      }

      // Exact conversion factors carried to the workflow funnel (see comment on
      // getBaseQtyForUom). order_base_qty is fixed per line (item_uom never
      // changes); picking_base_qty tracks the chosen Pick UOM.
      updates[`${path}.order_base_qty`] = getBaseQtyForUom(
        orderUom,
        cache.based_uom,
        cache.table_uom_conversion,
      );
      updates[`${path}.picking_base_qty`] = getBaseQtyForUom(
        pickingUom,
        cache.based_uom,
        cache.table_uom_conversion,
      );

      updates[`${path}.to_pick_alt`] = convertQuantityFromTo(
        parseFloat(row.qty_to_pick) || 0,
        cache.table_uom_conversion,
        orderUom,
        pickingUom,
        cache.based_uom,
      );
      updates[`${path}.pending_alt`] = convertQuantityFromTo(
        parseFloat(row.pending_process_qty) || 0,
        cache.table_uom_conversion,
        orderUom,
        pickingUom,
        cache.based_uom,
      );
    }

    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }
  } catch (error) {
    console.error("enrichPickingUOM error:", error);
  }
};

const HU_SELECT_ALLOWED_POLICIES = ["FULL_HU_PICK", "NO_SPLIT"];

// Stock Picking rides on picking_setup: one master switch per movement type, so a
// stock-movement row can never be mistaken for the GD row by readers that take
// data[0]. Which switch applies is decided by this picking's ref_doc_type.
const SP_REQUIRED_FLAG = {
  "Location Transfer": "lot_picking_required",
  "Plant Transfer": "pt_picking_required",
  "Miscellaneous Issue": "msi_picking_required",
};

// stock_picking.src_id is a scalar varchar, but the same field is a json array on
// the GD-side picking it was modelled on. Normalise so either shape works, and fall
// back to the line-level src_id, which is the authoritative per-row source anyway.
const srcIdList = () => {
  const raw = this.getValue("src_id");
  const fromHeader = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (fromHeader.length > 0) return fromHeader;
  const rows = this.getValue("table_picking_items") || [];
  return [
    ...new Set(
      rows
        .flatMap((r) => [r, ...(Array.isArray(r.children) ? r.children : [])])
        .map((r) => r && r.src_id)
        .filter(Boolean),
    ),
  ];
};

const fetchStockPickingSetup = async () => {
  try {
    const res = await db
      .collection("picking_setup")
      .where({ plant_id: this.getValue("plant_id") })
      .get();
    const setup = res.data && res.data.length > 0 ? res.data[0] : null;
    if (!setup) return null;
    const flag = SP_REQUIRED_FLAG[this.getValue("ref_doc_type")];
    return flag && setup[flag] === 1 ? setup : null;
  } catch (error) {
    console.error("fetchStockPickingSetup error:", error);
    return null;
  }
};

const createHeaderRows = async () => {
  const rows = this.getValue("table_picking_items") || [];
  if (rows.length === 0) return;

  if (rows.some((r) => r.row_type === "header")) return;

  const newRows = [];
  let lastHuId = null;

  for (const row of rows) {
    const huId = row.handling_unit_id;
    if (huId && huId !== lastHuId) {
      newRows.push({
        row_type: "header",
        handling_unit_id: huId,
        hu_select: 0,
      });
      lastHuId = huId;
    } else if (!huId) {
      lastHuId = null;
    }
    newRows.push({ ...row, row_type: "item" });
  }

  if (newRows.length !== rows.length) {
    await this.setData({ table_picking_items: newRows });
  }

  // Re-applied after the rows are replaced: a re-render brings the per-row
  // add-child-record control back, and a bundle's items come from the bundle
  // definition, never from the user.
  this.getComponent("table_picking_items")?.hideChildRecord();
};

const applyHUVisibility = async () => {
  const rows = this.getValue("table_picking_items") || [];
  if (rows.length === 0) return;

  // Flat: a bundle's items carry the handling units, so a bundle whose items are
  // HU-allocated would otherwise read as "no HU anywhere" and lose the column.
  const flatRows = flatPickingRows(rows);

  // No row carries a handling_unit_id — hide the HU column and skip the rest.
  if (!flatRows.some((e) => e.row.handling_unit_id)) {
    await this.hide("table_picking_items.handling_unit_id");
    return;
  }

  // HUs are atomic packaging units — once an HU is selected to pick, all of
  // its contents move together. Manual partial entry on HU items would let a
  // user pick half an HU, which corrupts downstream Packing state (Packing's
  // "Pick HU" snapshots the whole HU). Force atomic HU selection for every
  // split_policy. The HU_SELECT_ALLOWED_POLICIES const is kept for reference
  // but no longer gates the UI.
  const huSelectEnabled = true;

  // handling_unit_id + hu_select: enable column-wide so they can be shown
  // on header rows; we then per-row hide them on item rows. (Some platforms
  // require column-level display before per-row display takes effect.)
  await this.display("table_picking_items.handling_unit_id");
  if (huSelectEnabled) {
    await this.display("table_picking_items.hu_select");
  }

  const HU_FIELDS = ["handling_unit_id", "hu_select"];
  // The bundle row is a header-like line carrying `children`; an item row is the
  // better sample for the field list.
  const sampleEntry =
    flatRows.find((e) => e.row.row_type !== "header" && e.row.item_code) ||
    flatRows.find((e) => e.row.row_type !== "header");
  const itemFields = sampleEntry
    ? Object.keys(sampleEntry.row).filter(
        (k) => !HU_FIELDS.includes(k) && k !== "row_type" && k !== "children",
      )
    : [];

  // picked_qty has a validator rule and remark accepts input — disable them
  // on header rows so they don't trigger validation or accept input while hidden
  const HEADER_DISABLE_FIELDS = ["picked_qty", "picking_uom", "remark"];

  for (const { row, path } of flatRows) {
    if (row.row_type === "header") {
      for (const f of itemFields) {
        await this.hide(`${path}.${f}`);
      }
      if (huSelectEnabled) {
        await this.display(`${path}.hu_select`);
      }
      for (const f of HEADER_DISABLE_FIELDS) {
        await this.disabled(`${path}.${f}`, true);
      }
    } else {
      await this.hide(`${path}.handling_unit_id`);
      if (huSelectEnabled) {
        // hu_select column was just enabled at column level; explicitly hide
        // on item rows so the checkbox only renders on HU header rows.
        await this.hide(`${path}.hu_select`);
      }
    }
  }

  // Under whole-HU policies, picked_qty on HU-allocated item rows is driven
  // by the header's hu_select — disable manual entry. Loose item rows (no
  // handling_unit_id) stay editable. Header rows were already disabled above.
  if (huSelectEnabled) {
    for (const { row, path } of flatRows) {
      if (row.row_type !== "header" && row.handling_unit_id) {
        await this.disabled(
          [
            `${path}.picked_qty`,
            `${path}.picking_uom`,
          ],
          true,
        );
      }
    }
  }
};

const applySetup = async (pickingSetup) => {
  try {
    if (!pickingSetup) return;
    await this.display(["button_completed"]);
  } catch (error) {
    console.error(error);
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("sp_status");
    console.log("Debug", status, this.getValues());

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    console.log("pageStatus", pageStatus);
    await this.setData({ page_status: pageStatus });

    // Children under a line come from an item bundle, never from the user, so
    // the per-row add-child-record control has nothing to add here. Hidden the
    // same way SO, PP, PO, GR, PI, GD and Putaway hide theirs.
    this.getComponent("table_picking_items")?.hideChildRecord();

    console.log("pageStatusData", this.getValue("page_status"));

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);
        this.disabled("assigned_to", false);
        this.setData({
          page_status: pageStatus,
          created_by: this.getVarGlobal("nickname"),
          movement_type: "Picking",
        });

        await setPlant(organizationId);

        const convertFromGD = this.getValue("plant_id");

        if (convertFromGD) {
          await viewSerialNumber();
          await setSerialNumber();
        }
        {
          const pickingSetup = await fetchStockPickingSetup();
          await createHeaderRows();
          await applyHUVisibility();
          await enrichPickingUOM();
          await applySetup(pickingSetup);
        }
        break;

      case "Edit":
        // this.setData({
        //   "table_picking_items.picked_qty": 0,
        //   "table_picking_items.remark": "",
        // });
        if (status !== "Draft") {
          this.hide(["src_id", "button_save_as_draft", "button_created"]);
        }
        await disabledField(status);
        await showStatusHTML(status);
        await disabledPickedQtyField();
        await viewSerialNumber();
        await setSerialNumber();
        console.log(
          "table_picking_item onMounted",
          this.getValue("table_picking_items"),
        );
        {
          const pickingSetup = await fetchStockPickingSetup();
          await createHeaderRows();
          await applyHUVisibility();
          await enrichPickingUOM();
          await applySetup(pickingSetup);
        }
        break;

      case "View":
        this.hide(["src_id"]);
        this.display(["src_no"]);
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_created",
          "button_inprogress",
          "button_completed",
        ]);
        await viewSerialNumber();
        {
          const pickingSetup = await fetchStockPickingSetup();
          await createHeaderRows();
          await applyHUVisibility();
          await enrichPickingUOM();
          await applySetup(pickingSetup);
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("sp_id_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("sp_id");
  const { options } = params;

  const optionsData = this.getOptionData("sp_id_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("sp_id_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        sp_id_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ sp_id_type: defaultData.value });
    }
  }
}, 200);
