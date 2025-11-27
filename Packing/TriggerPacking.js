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
      "Could not generate a unique Transfer Order number after maximum attempts"
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

const updateSOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated so_id
      const uniqueSOIds = [...new Set(tableItems.map((item) => item.so_id))];

      //filter duplicated so_line_id
      const uniqueSOLineIds = [
        ...new Set(tableItems.map((item) => item.so_line_id)),
      ];

      //update so status
      for (const soId of uniqueSOIds) {
        await db.collection("sales_order_axszx8cj_sub").doc(soId).update({
          packing_status: "Created",
        });
      }

      //update so_line status
      for (const soLineId of uniqueSOLineIds) {
        await db.collection("sales_order_line").doc(soLineId).update({
          packing_status: "Created",
        });
      }
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
      //filter duplicated gd_id
      const uniqueGDIds = [...new Set(tableItems.map((item) => item.gd_id))];

      //filter duplicated gd_line_id
      const uniqueGDLineIds = [
        ...new Set(tableItems.map((item) => item.gd_line_id)),
      ];

      //update gd status
      for (const gdId of uniqueGDIds) {
        await db.collection("good_delivery").doc(gdId).update({
          packing_status: "Created",
        });
      }

      //update gd_line status
      for (const gdLineId of uniqueGDLineIds) {
        await db
          .collection("goods_delivery_fwii8mvb_sub")
          .doc(gdLineId)
          .update({
            packing_status: "Created",
          });
      }
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
      //filter duplicated to_id
      const uniqueTOIds = [...new Set(tableItems.map((item) => item.to_id))];

      //filter duplicated to_line_id
      const uniqueTOLineIds = [
        ...new Set(tableItems.map((item) => item.to_line_id)),
      ];

      //update to status
      for (const toId of uniqueTOIds) {
        await db.collection("picking_plan").doc(toId).update({
          packing_status: "Created",
        });
      }

      //update to_line status
      for (const toLineId of uniqueTOLineIds) {
        await db.collection("picking_plan_fwii8mvb_sub").doc(toLineId).update({
          packing_status: "Created",
        });
      }
    }
  } catch (error) {
    console.error("Error updating TO status:", error);
    throw error;
  }
};

(async () => {
  try {
    const data = arguments[0].pickingData;
    const packingPrefix = await setPrefix(data.organization_id);
    const soId = data.table_picking_items[0].so_id;

    const soData = await db
      .collection("sales_order")
      .where({ id: soId })
      .get()
      .then((res) => {
        return res.data[0];
      });

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

    let packingData = {
      packing_status: "Created",
      plant_id: data.plant_id,
      packing_no: packingPrefix,
      so_id: soId,
      gd_id: data.gd_no || "",
      to_id: data.to_no || "",
      so_no: data.so_no || "",
      gd_no: data.delivery_no || "",
      customer_id: soData.customer_name,
      billing_address: soData.cust_billing_address || "",
      shipping_address: soData.cust_shipping_address || "",
      packing_mode: "Basic",
      created_by: data.created_by,
      created_at: new Date().toISOString().split("T")[0],
      organization_id: data.organization_id,
      table_items: tableItems,
    };

    await db.collection("packing").add(packingData);

    if (packingData.so_id && packingData.so_id !== "") {
      await updateSOStatus(packingData);
    }
    if (packingData.gd_id && packingData.gd_id !== "") {
      await updateGDStatus(packingData);
    }
    if (packingData.to_id && packingData.to_id !== "") {
      await updateTOStatus(packingData);
    }
    console.log("Packing created successfully");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
