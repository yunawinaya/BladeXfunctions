const main = async () => {
  try {
    const self = this;
    const allData = self.getValues();
    const materialId = allData.material_id;
    const newValue = arguments[0]?.value;
    const plantId = allData.plant_id;
    const pageStatus = this.getValue("page_status");
    const productionOrderId = this.getValue("id");
    const planType = allData.plan_type;
    // Safely access fieldModel.item
    const fieldModel = arguments[0]?.fieldModel || {};
    const {
      material_desc,
      based_uom,
      purchase_unit_price,
      table_uom_conversion,
      mat_purchase_tax_id,
      item_batch_management,
    } = fieldModel.item || {};

    // Debug arguments[0]
    console.log("arguments[0]:", arguments[0]);

    if (newValue) {
      await self.setData({ planned_qty: 1 });
    } else {
      await self.setData({ planned_qty: 0 });
    }

    const fetchUoms = async () => {
      try {
        let uomData = [];

        if (based_uom) {
          try {
            const baseUomResponse = await db
              .collection("unit_of_measurement")
              .where({ id: based_uom })
              .get();

            if (baseUomResponse?.data && baseUomResponse.data.length > 0) {
              uomData = uomData.concat(baseUomResponse.data);
            } else {
              console.warn(`Base UOM with ID ${based_uom} not found`);
            }
          } catch (baseUomError) {
            console.error("Error fetching base UOM:", baseUomError);
          }
        }

        if (
          table_uom_conversion &&
          Array.isArray(table_uom_conversion) &&
          table_uom_conversion.length > 0
        ) {
          const uomPromises = table_uom_conversion.map((item) => {
            if (!item.alt_uom_id) {
              console.warn(
                "Missing alt_uom_id in UOM conversion table item:",
                item
              );
              return Promise.resolve([]);
            }

            return db
              .collection("unit_of_measurement")
              .where({ id: item.alt_uom_id })
              .get()
              .then((res) => res?.data || [])
              .catch((error) => {
                console.error(
                  `Error fetching alt UOM ${item.alt_uom_id}:`,
                  error
                );
                return [];
              });
          });

          const uomResults = await Promise.all(uomPromises);

          uomResults.forEach((result) => {
            if (Array.isArray(result) && result.length > 0) {
              uomData = uomData.concat(result);
            }
          });
        }

        const uniqueUomData = Array.from(
          new Map(uomData.map((item) => [item.id, item])).values()
        );

        console.log("Collected UOM data:", uniqueUomData);

        await self.setOptionData("planned_qty_uom", uniqueUomData);

        if (based_uom) {
          await self.setData({ planned_qty_uom: based_uom });
        }

        return uniqueUomData;
      } catch (error) {
        console.error("Error in fetchUoms:", error);
        // Still return an empty array to prevent further errors
        return [];
      }
    };

    // Function to fetch and filter sales orders
    const fetchSalesOrders = async () => {
      try {
        // Only reset if table_sales_order is empty to avoid overwriting row-specific options
        if (!self.getValues().table_sales_order?.length) {
          self.setData({ "table_sales_order.sales_order_id": [] });
        }
        const response = await db
          .collection("sales_order")
          .where({ plant_name: plantId })
          .get();
        const salesOrderData = response.data || [];

        // Deduplicate sales orders
        const uniqueSalesOrders = Array.from(
          new Map(salesOrderData.map((so) => [so.id, so])).values()
        );

        // Filter by materialId
        const filteredSalesOrders = uniqueSalesOrders.filter((salesOrder) =>
          salesOrder.table_so.some((item) => item.item_name === newValue)
        );
        console.log("Filtered Sales Orders:", filteredSalesOrders);

        const fieldPath = "table_sales_order.sales_order_id";
        const hasData = filteredSalesOrders.length > 0;
        self.disabled([fieldPath], !hasData);

        if (!hasData) {
          const button = document.querySelector(
            ".el-row .el-button.el-button--primary.el-button--small.is-link"
          );
          if (button) {
            button.style.display = "none";
            self.display(["utext_7bt2y1qa"], true);
          }
        } else {
          document.querySelector(
            ".el-row .el-button.el-button--primary.el-button--small.is-link"
          ).style.display = "inline-block";
          self.hide(["utext_7bt2y1qa"], true);
        }

        // Set options only for new rows or if not set by addrow.js
        if (!self.getOptionData(fieldPath)?.length) {
          self.setOptionData(fieldPath, filteredSalesOrders);
        }
      } catch (error) {
        console.error("Error fetching sales orders:", error);
        self.showError?.("Failed to load sales orders");
        return [];
      }
    };

    // Function to reset form data
    const resetFormData = () => {
      self.setData({
        table_sales_order: [],
        process_route_no: "",
        process_source: "",
        table_process_route: [],
        table_bom: [],
      });
    };

    // Function to normalize production order data
    const normalizeProductionData = (data = {}) => ({
      table_sales_order: Array.isArray(data.table_sales_order)
        ? data.table_sales_order
        : [],
      process_route_no: String(data.process_route_no || ""),
      process_source: String(data.process_source || ""),
      table_process_route: Array.isArray(data.table_process_route)
        ? data.table_process_route
        : [],
      table_bom: Array.isArray(data.table_bom) ? data.table_bom : [],
    });

    // Main logic
    if (pageStatus === "Edit" || (pageStatus === "View" && productionOrderId)) {
      const response = await db
        .collection("production_order")
        .where({ id: productionOrderId })
        .get();

      const productionOrderData = response.data?.[0];
      if (!productionOrderData) {
        throw new Error("Production order not found");
      }

      const productionMaterialId = productionOrderData.material_id;
      const res = await db
        .collection("Item")
        .where({ id: productionMaterialId })
        .get();
      const materialData = res.data;
      const isBatchManagement = materialData[0].item_batch_management;
      // Check if item is batch-managed
      if (isBatchManagement) {
        console.log("item_batch_management", isBatchManagement);
        isBatchManagement === 0
          ? this.hide(["batch_id"], true)
          : this.display(["batch_id"], true);
      } else {
        console.log("Item Batch Management Status: Not available");
        this.hide(["batch_id"], true); // Default to hiding if undefined
      }
      if (newValue && newValue !== productionMaterialId) {
        // console.log("Material ID changed:", { productionMaterialId, newValue });
        resetFormData();
        await fetchUoms();
        if (planType) {
          if (planType === "Make to Order") {
            this.display(["card_prodorder_so"], true);

            // await fetchSalesOrders();
          } else {
            this.hide(["card_prodorder_so"], true);
          }
        }
      } else {
        // console.log("Production Order Data:", productionOrderData);
        const normalizedData = normalizeProductionData(productionOrderData);
        self.setData(normalizedData);
        await fetchUoms();
        if (planType) {
          if (planType === "Make to Order") {
            this.display(["card_prodorder_so"], true);
            // await fetchSalesOrders();
          } else {
            this.hide(["card_prodorder_so"], true);
          }
        }
      }
    } else {
      // console.log("New production order");
      resetFormData();
      await fetchUoms();
      if (planType) {
        if (planType === "Make to Order") {
          //   await fetchSalesOrders();
          this.display(["card_prodorder_so"], true);
        } else {
          this.hide(["card_prodorder_so"], true);
        }
      }
    }
  } catch (error) {
    console.error("Error in main execution:", error);
    // Optionally show user-friendly error message
    self.showError?.("An error occurred while processing the production order");
  }
};

main();
