(async () => {
  // Helper function to handle process table data
  const handleProcessTableData = async (processTable, materialTable) => {
    try {
      // Extract unique process IDs (remove duplicates)
      const uniqueProcessIds = [
        ...new Set(
          processTable.map((item) => item.process_no).filter((id) => id)
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
            [`mat_consumption_table.${i}.item_process_id`],
            validProcessData
          );
        }
        console.log(`Loaded ${validProcessData.length} process options`);
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

      // Update the form data
      const updateData = {
        [`process_table.${rowIndex}.process_name`]:
          processData.process_name || "",
        [`process_table.${rowIndex}.process_category`]:
          processData.process_category || "",
      };

      await this.setData(updateData);
      console.log("Process data updated successfully:", updateData);
    } catch (error) {
      console.error("Error handling current process data:", error);
      throw error;
    }
  };

  try {
    // Extract and validate input data
    const allData = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;

    // Input validation
    if (!lineItemData || rowIndex === undefined) {
      console.error("Missing required arguments: row or rowIndex");
      return;
    }

    const processId = lineItemData.process_no;
    const processTable = allData.process_table;
    const materialTable = allData.mat_consumption_table;

    if (!processId) {
      console.warn("No process_no found in line item data");
      return;
    } else {
      this.disabled(["mat_consumption_table.item_process_id"], false);
    }

    console.log("Processing:", { lineItemData, rowIndex, processId });

    // Handle process table data if available
    if (processTable?.length > 0) {
      await handleProcessTableData(processTable, materialTable);
    }

    // Handle current process data
    await handleCurrentProcessData(processId, rowIndex);
  } catch (error) {
    console.error("Error in process data handler:", error);
  }
})();
