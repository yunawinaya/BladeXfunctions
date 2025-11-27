// Helper functions
const generatePrefix = (prefixData) => {
  const now = new Date();
  let prefixToShow = prefixData.current_prefix_config;

  prefixToShow = prefixToShow.replace("prefix", prefixData.prefix_value);
  prefixToShow = prefixToShow.replace("suffix", prefixData.suffix_value);
  prefixToShow = prefixToShow.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  prefixToShow = prefixToShow.replace(
    "day",
    String(now.getDate()).padStart(2, "0")
  );
  prefixToShow = prefixToShow.replace("year", now.getFullYear());
  prefixToShow = prefixToShow.replace(
    "running_number",
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0")
  );

  return prefixToShow;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("packing")
    .where({ packing_no: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix({
      ...prefixData,
      running_number: runningNumber,
    });
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Packing number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Packing",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    return null;
  }

  return prefixEntry.data[0];
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  if (prefixData && prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    return prefixToShow;
  }

  return null;
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Packing",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1
      });
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const updateSOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      // Filter duplicated so_id (remove null/undefined)
      const uniqueSOIds = [
        ...new Set(tableItems.map((item) => item.so_id).filter(Boolean)),
      ];

      // Filter duplicated so_line_id (remove null/undefined)
      const uniqueSOLineIds = [
        ...new Set(tableItems.map((item) => item.so_line_id).filter(Boolean)),
      ];

      // Update so status
      await Promise.all(
        uniqueSOIds.map((soId) =>
          db.collection("sales_order_axszx8cj_sub").doc(soId).update({
            packing_status: "Created",
          })
        )
      );

      // Update so_line status
      await Promise.all(
        uniqueSOLineIds.map((soLineId) =>
          db.collection("sales_order_line").doc(soLineId).update({
            packing_status: "Created",
          })
        )
      );
    }
  } catch (error) {
    console.error("Error updating SO status:", error);
    throw error;
  }
};

const updateGDStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      // Filter duplicated gd_id (remove null/undefined)
      const uniqueGDIds = [
        ...new Set(tableItems.map((item) => item.gd_id).filter(Boolean)),
      ];

      // Filter duplicated gd_line_id (remove null/undefined)
      const uniqueGDLineIds = [
        ...new Set(tableItems.map((item) => item.gd_line_id).filter(Boolean)),
      ];

      // Update gd status
      await Promise.all(
        uniqueGDIds.map((gdId) =>
          db.collection("goods_delivery").doc(gdId).update({
            packing_status: "Created",
          })
        )
      );

      // Update gd_line status
      await Promise.all(
        uniqueGDLineIds.map((gdLineId) =>
          db
            .collection("goods_delivery_fwii8mvb_sub")
            .doc(gdLineId)
            .update({
              packing_status: "Created",
            })
        )
      );
    }
  } catch (error) {
    console.error("Error updating GD status:", error);
    throw error;
  }
};

const updateTOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      // Filter duplicated to_id (remove null/undefined)
      const uniqueTOIds = [
        ...new Set(tableItems.map((item) => item.to_id).filter(Boolean)),
      ];

      // Filter duplicated to_line_id (remove null/undefined)
      const uniqueTOLineIds = [
        ...new Set(tableItems.map((item) => item.to_line_id).filter(Boolean)),
      ];

      // Update to status
      await Promise.all(
        uniqueTOIds.map((toId) =>
          db.collection("picking_plan").doc(toId).update({
            packing_status: "Created",
          })
        )
      );

      // Update to_line status
      await Promise.all(
        uniqueTOLineIds.map((toLineId) =>
          db.collection("picking_plan_fwii8mvb_sub").doc(toLineId).update({
            packing_status: "Created",
          })
        )
      );
    }
  } catch (error) {
    console.error("Error updating TO status:", error);
    throw error;
  }
};

(async () => {
  try {
    const data = arguments[0].pickingData;

    // Validate picking items exist
    if (!data.table_picking_items || data.table_picking_items.length === 0) {
      throw new Error("No picking items found to create packing");
    }

    const soId = data.table_picking_items[0].so_id;

    // Fetch sales order data with is_deleted filter
    const soResult = await db
      .collection("sales_order")
      .where({ id: soId, is_deleted: 0 })
      .get();

    if (!soResult.data || soResult.data.length === 0) {
      throw new Error(`Sales Order not found for ID: ${soId}`);
    }

    const soData = soResult.data[0];

    // Generate prefix
    const packingPrefix = await setPrefix(data.organization_id);

    // Transform table_picking_items to table_items
    const tableItems = data.table_picking_items.map((pickingItem) => {
      // Destructure to exclude pending_process_qty and picked_qty
      const {
        pending_process_qty: _pending_process_qty,
        picked_qty: _picked_qty,
        qty_to_pick,
        ...restFields
      } = pickingItem;

      // Return transformed item with quantity from qty_to_pick
      return {
        ...restFields,
        quantity: qty_to_pick,
      };
    });

    // Get gd_id and to_id from first picking item
    const firstPickingItem = data.table_picking_items[0];

    let packingData = {
      packing_status: "Created",
      plant_id: data.plant_id,
      packing_no: packingPrefix,
      so_id: soId,
      gd_id: firstPickingItem.gd_id || "",
      to_id: firstPickingItem.to_id || "",
      so_no: data.so_no || "",
      gd_no: firstPickingItem.gd_no || "",
      customer_id: soData.customer_name,
      billing_address: soData.cust_billing_address || "",
      shipping_address: soData.cust_shipping_address || "",
      packing_mode: "Basic",
      created_by: data.created_by,
      created_at: new Date().toISOString().split("T")[0],
      organization_id: data.organization_id,
      table_items: tableItems,
    };

    // Add packing record to database
    await db.collection("packing").add(packingData);

    // Update prefix running number
    if (packingPrefix) {
      const prefixData = await getPrefixData(data.organization_id);
      if (prefixData) {
        await updatePrefix(data.organization_id, prefixData.running_number);
      }
    }

    // Update related document statuses
    if (packingData.so_id && packingData.so_id !== "") {
      await updateSOStatus(packingData);
    }
    if (packingData.gd_id && packingData.gd_id !== "") {
      await updateGDStatus(packingData);
    }
    if (packingData.to_id && packingData.to_id !== "") {
      await updateTOStatus(packingData);
    }

    this.$message.success("Packing created successfully");
    console.log("Packing created successfully");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
