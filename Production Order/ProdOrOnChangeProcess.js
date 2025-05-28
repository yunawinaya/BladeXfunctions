(async () => {
  // Helper function to handle process table data and set BOM options
  const handleProcessTableData = async (processTable, materialTable) => {
    try {
      if (!processTable?.length || !materialTable?.length) {
        console.warn("No process table or material table data available");
        return;
      }

      // Extract unique process IDs (remove duplicates)
      const uniqueProcessIds = [
        ...new Set(
          processTable.map((item) => item.process_id).filter((id) => id)
        ),
      ];

      if (uniqueProcessIds.length === 0) {
        console.warn("No valid process IDs found in process table");
        return;
      }

      // Batch fetch all processes at once instead of individual queries
      const processPromises = uniqueProcessIds.map(async (id) => {
        try {
          const result = await db.collection("process").where({ id }).get();
          return result.data?.[0] || null;
        } catch (error) {
          console.error(`Failed to fetch process ${id}:`, error);
          return null;
        }
      });

      // Wait for all processes to be fetched
      const processResults = await Promise.all(processPromises);

      // Filter out null results
      const validProcessData = processResults.filter((data) => data !== null);

      if (validProcessData.length > 0) {
        // Set option data for each row in BOM table
        const optionPromises = materialTable.map((_, index) =>
          this.setOptionData(
            `table_bom.${index}.item_process_id`,
            validProcessData
          )
        );

        await Promise.all(optionPromises);
        console.log(
          `Loaded ${validProcessData.length} process options for ${materialTable.length} BOM rows`
        );
      } else {
        console.warn("No valid process data found for option setting");
      }
    } catch (error) {
      console.error("Error handling process table data:", error);
    }
  };

  // Helper function to fetch and map process route data
  const fetchAndMapProcessData = async (processId) => {
    try {
      const response = await db
        .collection("process_route")
        .where({ id: processId })
        .get();

      if (!response.data?.[0]) {
        throw new Error(`No process route found with ID: ${processId}`);
      }

      const processData = response.data[0];
      const processList = processData.process_table || [];
      const materialList = processData.mat_consumption_table || [];

      // Map material data to BOM format
      const mappedBomData = materialList.map((item) => ({
        material_id: item.bom_material_code,
        material_name: item.bom_material_name,
        material_category: item.bom_material_category,
        material_quantity: item.quantity,
        material_uom: item.base_uom,
        item_process_id: item.item_process_id || null,
      }));

      // Map process data to process route format
      const mappedProcessData = processList.map((item) => ({
        process_id: item.process_no,
        process_name: item.process_name,
        process_category: item.process_category,
      }));

      return {
        table_bom: mappedBomData,
        process_route_name: processData.process_route_name,
        table_process_route: mappedProcessData,
      };
    } catch (error) {
      console.error("Error fetching and mapping process data:", error);
      throw error;
    }
  };

  // Helper function to handle production order data for Edit/View mode
  const handleProductionOrderMode = async (
    productionOrderId,
    plantId,
    processId
  ) => {
    try {
      const response = await db
        .collection("production_order")
        .where({ id: productionOrderId, plant_id: plantId })
        .get();

      if (!response.data?.[0]) {
        throw new Error(
          `No production order found with ID: ${productionOrderId}`
        );
      }

      const productionOrderData = response.data[0];
      const productionProcessId = productionOrderData.process_route_no;

      if (processId && processId !== productionProcessId) {
        // Process route changed - fetch new data
        console.log("Process route changed, fetching new data");
        const mappedData = await fetchAndMapProcessData(processId);
        await this.setData(mappedData);

        // Update process options after setting data
        const updatedData = this.getValues();
        await handleProcessTableData(
          updatedData.table_process_route,
          updatedData.table_bom
        );
      } else {
        // Use existing production order data
        console.log("Using existing production order data");
        await this.setData({
          table_bom: productionOrderData.table_bom || [],
          process_route_name: productionOrderData.process_route_name || "",
          table_process_route: productionOrderData.table_process_route || [],
        });
      }
    } catch (error) {
      console.error("Error handling production order mode:", error);
      throw error;
    }
  };

  // Helper function to handle new/create mode
  const handleCreateMode = async (processId, plantId) => {
    try {
      console.log("Creating new production order with process route");
      const mappedData = await fetchAndMapProcessData(processId);
      await this.setData(mappedData);

      // Update process options after setting data
      await handleProcessTableData(
        mappedData.table_process_route,
        mappedData.table_bom
      );
    } catch (error) {
      console.error("Error handling create mode:", error);
      throw error;
    }
  };

  // Main execution
  try {
    // Extract and validate input data
    const allData = this.getValues();
    const processId = arguments[0]?.value;
    const pageStatus = this.getValue("page_status");
    const productionOrderId = this.getValue("id");
    const plantId = allData.plant_id;

    // Input validation
    if (!processId) {
      console.error("Missing required processId");
      return;
    }

    if (!plantId) {
      console.warn("No plant_id found in form data");
    }

    console.log("Processing production order:", {
      processId,
      pageStatus,
      productionOrderId,
      plantId,
    });

    // Handle different page modes
    if (pageStatus === "Edit" || pageStatus === "View") {
      if (!productionOrderId) {
        console.error("Missing production order ID for Edit/View mode");
        return;
      }
      await handleProductionOrderMode(productionOrderId, plantId, processId);
    } else {
      // Create/New mode
      await handleCreateMode(processId, plantId);
    }

    console.log("Production order processing completed successfully");
  } catch (error) {
    console.error("Error in production order handler:", error);
  }
})();
