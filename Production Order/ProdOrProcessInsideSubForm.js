(async () => {
  // Helper function to handle process table data
  const handleProcessTableData = async (processTable, materialTable) => {
    try {
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

      if (validProcessData.length > 0 && materialTable.length > 0) {
        for (let i = 0; i < materialTable.length; i++) {
          await this.setOptionData(
            `table_bom.${i}.item_process_id`,
            validProcessData
          );
        }
        console.log(
          `Loaded ${validProcessData.length} process options for BOM table`
        );
      } else {
        console.warn("No valid process data found for option setting");
      }
    } catch (error) {
      console.error("Error handling process table data:", error);
    }
  };

  // Helper function to handle current process data
  const handleCurrentProcessData = async (processId, rowIndex) => {
    try {
      const result = await db
        .collection("process")
        .where({ id: processId })
        .get();

      if (!result.data?.[0]) {
        console.warn(`No process found with ID: ${processId}`);
        return;
      }

      const processData = result.data[0];

      // Validate required fields exist
      if (!processData.process_name || !processData.process_category) {
        console.warn("Process data missing required fields:", processData);
      }

      // Update the form data for process route table
      const updateData = {
        [`table_process_route.${rowIndex}.process_name`]:
          processData.process_name || "",
        [`table_process_route.${rowIndex}.process_category`]:
          processData.process_category || "",
      };

      await this.setData(updateData);

      // Set option data for BOM table
      await this.setOptionData(
        `table_bom.${rowIndex}.item_process_id`,
        processData
      );

      console.log("Process data updated successfully:", updateData);
      console.log("Option data set for table_bom process selection");
    } catch (error) {
      console.error("Error handling current process data:", error);
      throw error;
    }
  };

  try {
    // Extract and validate input data
    const allData = this.getValues();
    const processId = arguments[0]?.value;
    const rowIndex = arguments[0]?.rowIndex;
    const materialId = allData.material_id;
    const processTable = allData.table_process_route;
    const materialTable = allData.table_bom;

    // Input validation
    if (!processId || rowIndex === undefined) {
      console.error(
        "Missing required arguments: value (processId) or rowIndex"
      );
      return;
    }

    if (!materialId) {
      console.warn("No material_id found in form data");
    }

    console.log("Processing:", {
      processId,
      rowIndex,
      materialId,
      processTableLength: processTable?.length || 0,
    });

    // Handle process table data if available (for setting options)
    if (processTable?.length > 0) {
      await handleProcessTableData(processTable, materialTable);
    }

    // Handle current process data (for updating current row)
    await handleCurrentProcessData(processId, rowIndex);
  } catch (error) {
    console.error("Error in process route handler:", error);
  }
})();
