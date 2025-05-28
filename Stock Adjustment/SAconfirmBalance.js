(async () => {
  try {
    const allData = this.getValues();
    const temporaryData = allData.sa_item_balance.table_item_balance;
    const rowIndex = allData.sa_item_balance.row_index;
    const page_status = allData.page_status;

    // Exit early if in View mode
    if (page_status === "View") {
      this.closeDialog("sa_item_balance");
      return;
    }

    // Get UOM information - adjust field name based on your data structure
    const materialUOMid = allData.sa_item_balance.material_uom; // Adjust field name as needed
    const gdUOM = await db
      .collection("unit_of_measurement")
      .where({ id: materialUOMid })
      .get()
      .then((res) => {
        return res.data[0]?.uom_name || "PCS"; // Default to PCS if not found
      });

    let isValid = true; // Flag to track validation status

    // Filter out items with quantity 0 and sum up sa_quantity values
    const totalSaQuantity = temporaryData
      .filter((item) => (item.sa_quantity || 0) > 0) // Skip if quantity is 0 or falsy
      .reduce((sum, item) => {
        const category_type = item.category;
        const movementType = item.movement_type;
        const quantity = item.sa_quantity || 0;

        // Define quantity fields
        const unrestricted_field = item.unrestricted_qty || 0;
        const reserved_field = item.reserved_qty || 0;
        const quality_field = item.qualityinsp_qty || 0;
        const blocked_field = item.blocked_qty || 0;

        // Validate only if movementType is "Out"
        if (movementType === "Out" && quantity > 0) {
          let selectedField;

          switch (category_type) {
            case "Unrestricted":
              selectedField = unrestricted_field;
              break;
            case "Reserved":
              selectedField = reserved_field;
              break;
            case "Quality Inspection":
              selectedField = quality_field;
              break;
            case "Blocked":
              selectedField = blocked_field;
              break;
            default:
              this.setData({ error_message: "Invalid category type" });
              isValid = false;
              return sum; // Return current sum without adding
          }

          // Check if selected field has enough quantity
          if (selectedField < quantity) {
            this.setData({
              error_message: `Quantity in ${category_type} is not enough to Adjust`,
            });
            isValid = false;
            return sum; // Return current sum without adding
          }
        }

        // Add to sum if validation passes or if movement is "In"
        return sum + quantity;
      }, 0);

    console.log("Total SA quantity:", totalSaQuantity);

    const formatFilteredData = async (temporaryData) => {
      try {
        // Filter data to only include items with quantity > 0
        const filteredData = temporaryData.filter(
          (item) => (item.sa_quantity || 0) > 0
        );

        // Return empty string if no filtered data
        if (filteredData.length === 0) {
          return "Total: 0 " + gdUOM + "\nDETAILS:\nNo items to display";
        }

        // Get unique location IDs from filtered data
        const locationIds = [
          ...new Set(filteredData.map((item) => item.location_id)),
        ];

        // Get unique batch IDs (filter out null/undefined values) from filtered data
        const batchIds = [
          ...new Set(
            filteredData
              .map((item) => item.batch_id)
              .filter((batchId) => batchId != null && batchId !== "")
          ),
        ];

        // Fetch locations in parallel
        const locationPromises = locationIds.map(async (locationId) => {
          try {
            const resBinLocation = await db
              .collection("bin_location")
              .where({ id: locationId })
              .get();

            return {
              id: locationId,
              name:
                resBinLocation.data?.[0]?.bin_location_combine ||
                `Location ID: ${locationId}`,
            };
          } catch (error) {
            console.error(`Error fetching location ${locationId}:`, error);
            return { id: locationId, name: `${locationId} (Error)` };
          }
        });

        // Fetch batches in parallel (only if there are batch IDs)
        const batchPromises = batchIds.map(async (batchId) => {
          try {
            const resBatch = await db
              .collection("batch")
              .where({ id: batchId })
              .get();

            return {
              id: batchId,
              name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
            };
          } catch (error) {
            console.error(`Error fetching batch ${batchId}:`, error);
            return { id: batchId, name: `${batchId} (Error)` };
          }
        });

        const [locations, batches] = await Promise.all([
          Promise.all(locationPromises),
          Promise.all(batchPromises),
        ]);

        const categoryMap = {
          Blocked: "BLK",
          Reserved: "RES",
          Unrestricted: "UNR",
          "Quality Inspection": "QIP",
          "In Transit": "INT",
        };

        // Create lookup maps
        const locationMap = locations.reduce((map, loc) => {
          map[loc.id] = loc.name;
          return map;
        }, {});

        const batchMap = batches.reduce((map, batch) => {
          map[batch.id] = batch.name;
          return map;
        }, {});

        // Calculate total from filtered data only
        const totalQty = filteredData.reduce(
          (sum, item) => sum + (item.sa_quantity || 0),
          0
        );

        let summary = `Total: ${totalQty} ${gdUOM}\nDETAILS:\n`;

        // Process only filtered data for details
        const details = filteredData
          .map((item, index) => {
            const locationName =
              locationMap[item.location_id] || item.location_id;
            const qty = item.sa_quantity || 0;

            // Use category
            const category = item.category;
            const categoryAbbr = categoryMap[category] || category || "UNR";

            let itemDetail = `${
              index + 1
            }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr})`;

            // Add batch info on a new line if batch exists
            if (item.batch_id) {
              const batchName = batchMap[item.batch_id] || item.batch_id;
              itemDetail += `\n[${batchName}]`;
            }

            return itemDetail;
          })
          .join("\n");

        return summary + details;
      } catch (error) {
        console.error("Error in formatFilteredData:", error);
        return `Total: 0 ${gdUOM}\n\nDETAILS:\nError formatting data`;
      }
    };

    const formattedString = await formatFilteredData(temporaryData);
    console.log("📋 Formatted string:", formattedString);

    // Only update data and close dialog if all validations pass
    if (isValid) {
      this.setData({
        [`subform_dus1f9ob.${rowIndex}.total_quantity`]: totalSaQuantity,
      });
      this.setData({
        [`subform_dus1f9ob.${rowIndex}.balance_index`]: temporaryData,
      });
      this.setData({
        [`subform_dus1f9ob.${rowIndex}.adj_summary`]: formattedString,
      });
      this.setData({
        [`dialog_index.table_index`]: temporaryData,
      });

      console.log("temporaryData", temporaryData);

      // Clear the error message
      this.setData({
        error_message: "",
      });

      this.closeDialog("sa_item_balance");
    }
  } catch (error) {
    console.error("Error in stock adjustment process:", error);

    // Set error message for user
    this.setData({
      error_message:
        "An error occurred while processing the adjustment. Please try again.",
    });

    // Optionally show user-friendly error message
    if (this.$message) {
      this.$message.error(
        "Failed to process stock adjustment. Please try again."
      );
    }
  }
})();
