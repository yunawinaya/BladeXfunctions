(async () => {
  try {
    console.log("Starting stock adjustment process"); // Log function start
    const allData = this.getValues();
    console.log("allData:", allData); // Log allData to inspect structure
    const temporaryData = allData.sa_item_balance.table_item_balance;
    const rowIndex = allData.sa_item_balance.row_index;
    const page_status = allData.page_status;
    const quantityUOM = allData.sa_item_balance.uom_id;
    const selectedUOM = allData.sa_item_balance.material_uom;
    console.log("temporaryData:", temporaryData); // Log temporaryData
    console.log("rowIndex:", rowIndex); // Log rowIndex
    console.log("page_status:", page_status); // Log page_status

    // Exit early if in View mode
    if (page_status === "View") {
      console.log("Exiting early due to View mode"); // Log early exit
      this.closeDialog("sa_item_balance");
      return;
    }

    // Get UOM information
    const materialUOMid = allData.sa_item_balance.material_uom;
    console.log("materialUOMid:", materialUOMid); // Log materialUOMid
    const gdUOM = await db
      .collection("unit_of_measurement")
      .where({ id: materialUOMid })
      .get()
      .then((res) => {
        console.log("UOM query result:", res.data); // Log UOM query result
        return res.data[0]?.uom_name || "PCS";
      });
    console.log("gdUOM:", gdUOM); // Log resolved UOM

    // Get item data to check for serial/batch management
    const materialId = allData.sa_item_balance.material_id;
    let itemData = null;
    try {
      const itemResponse = await db
        .collection("Item")
        .where({ material_code: materialId })
        .get();
      itemData = itemResponse.data[0];
      console.log("itemData for serial/batch management:", itemData); // Log item data
    } catch (error) {
      console.error("Error fetching item data:", error);
    }

    let isValid = true; // Flag to track validation status
    console.log("Initial isValid:", isValid); // Log initial isValid

    // Convert quantities back to quantityUOM if user changed UOM
    let processedTemporaryData = temporaryData;

    if (selectedUOM !== quantityUOM) {
      console.log("Converting quantities back from selectedUOM to quantityUOM");
      console.log("From UOM:", selectedUOM, "To UOM:", quantityUOM);

      // Get item data for conversion
      const itemDataForConversion = await db
        .collection("Item")
        .where({ material_code: materialId })
        .get()
        .then((res) => res.data[0]);
      const tableUOMConversion = itemDataForConversion.table_uom_conversion;
      const baseUOM = itemDataForConversion.based_uom;

      const convertQuantityFromTo = (
        value,
        table_uom_conversion,
        fromUOM,
        toUOM,
        baseUOM
      ) => {
        if (!value || fromUOM === toUOM) return value;

        // First convert from current UOM back to base UOM
        let baseQty = value;
        if (fromUOM !== baseUOM) {
          const fromConversion = table_uom_conversion.find(
            (conv) => conv.alt_uom_id === fromUOM
          );
          if (fromConversion && fromConversion.alt_qty) {
            baseQty = value / fromConversion.alt_qty;
          }
        }

        // Then convert from base UOM to target UOM
        if (toUOM !== baseUOM) {
          const toConversion = table_uom_conversion.find(
            (conv) => conv.alt_uom_id === toUOM
          );
          if (toConversion && toConversion.alt_qty) {
            return Math.round(baseQty * toConversion.alt_qty * 1000) / 1000;
          }
        }

        return baseQty;
      };

      const quantityFields = [
        "blocked_qty",
        "reserved_qty",
        "unrestricted_qty",
        "qualityinsp_qty",
        "intransit_qty",
        "balance_quantity",
        "sa_quantity", // Include sa_quantity in conversion
      ];

      processedTemporaryData = temporaryData.map((record, index) => {
        const convertedRecord = { ...record };

        quantityFields.forEach((field) => {
          if (convertedRecord[field]) {
            const originalValue = convertedRecord[field];
            convertedRecord[field] = convertQuantityFromTo(
              convertedRecord[field],
              tableUOMConversion,
              selectedUOM,
              quantityUOM,
              baseUOM
            );
            console.log(
              `Record ${index} ${field}: ${originalValue} -> ${convertedRecord[field]}`
            );
          }
        });

        return convertedRecord;
      });

      console.log(
        "Converted temporary data back to quantityUOM:",
        processedTemporaryData
      );
    }

    // Filter out items with quantity 0 and sum up sa_quantity values
    const totalSaQuantity = processedTemporaryData
      .filter((item) => {
        const isValidItem =
          item.sa_quantity && item.sa_quantity > 0 ? true : false;
        console.log("Filtering item:", item, "isValidItem:", isValidItem); // Log each filtered item
        return isValidItem;
      })
      .reduce((sum, item) => {
        const category_type = item.category;
        const movementType = item.movement_type;
        const quantity = item.sa_quantity || 0;
        console.log("Reducing item:", {
          category_type,
          movementType,
          quantity,
        }); // Log item details in reduce

        // Define quantity fields
        const unrestricted_field = item.unrestricted_qty || 0;
        const reserved_field = item.reserved_qty || 0;
        const quality_field = item.qualityinsp_qty || 0;
        const blocked_field = item.blocked_qty || 0;
        console.log("Quantity fields:", {
          unrestricted_field,
          reserved_field,
          quality_field,
          blocked_field,
        }); // Log quantity fields

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
              console.log("Invalid category_type:", category_type); // Log invalid category
              this.setData({ error_message: "Invalid category type" });
              isValid = false;
              return sum;
          }
          console.log("Selected field for", category_type, ":", selectedField); // Log selected field

          // Check if selected field has enough quantity
          if (selectedField < quantity) {
            console.log(`Insufficient quantity in ${category_type}:`, {
              selectedField,
              quantity,
            }); // Log quantity failure
            this.setData({
              error_message: `Quantity in ${category_type} is not enough to Adjust`,
            });
            isValid = false;
            return sum;
          }
        }

        return sum + quantity;
      }, 0);

    console.log("Total SA quantity:", totalSaQuantity); // Already present
    console.log("isValid after reduce:", isValid); // Log isValid after reduce

    const formatFilteredData = async (temporaryData, itemData) => {
      try {
        console.log("Starting formatFilteredData"); // Log function start
        // Filter data to only include items with quantity > 0
        const filteredData = temporaryData.filter(
          (item) => item.sa_quantity && item.sa_quantity > 0
        );
        console.log("filteredData:", filteredData); // Log filtered data

        // Return empty string if no filtered data
        if (filteredData.length === 0) {
          console.log("No filtered data, returning empty summary"); // Log empty case
          return "Total: 0 " + gdUOM + "\nDETAILS:\nNo items to display";
        }

        // Get unique location IDs
        const locationIds = [
          ...new Set(filteredData.map((item) => item.location_id)),
        ];
        console.log("locationIds:", locationIds); // Log location IDs

        // Get unique batch IDs
        const batchIds = [
          ...new Set(
            filteredData
              .map((item) => item.batch_id)
              .filter((batchId) => batchId != null && batchId !== "")
          ),
        ];
        console.log("batchIds:", batchIds); // Log batch IDs

        // Fetch locations in parallel
        const locationPromises = locationIds.map(async (locationId) => {
          try {
            console.log("Fetching location:", locationId); // Log location fetch
            const resBinLocation = await db
              .collection("bin_location")
              .where({ id: locationId })
              .get();
            console.log("Location query result:", resBinLocation.data); // Log location query result
            return {
              id: locationId,
              name:
                resBinLocation.data?.[0]?.bin_location_combine ||
                `Location ID: ${locationId}`,
            };
          } catch (error) {
            console.error(`Error fetching location ${locationId}:`, error); // Already present
            return { id: locationId, name: `${locationId} (Error)` };
          }
        });

        // Fetch batches in parallel
        const batchPromises = batchIds.map(async (batchId) => {
          try {
            console.log("Fetching batch:", batchId); // Log batch fetch
            const resBatch = await db
              .collection("batch")
              .where({ id: batchId })
              .get();
            console.log("Batch query result:", resBatch.data); // Log batch query result
            return {
              id: batchId,
              name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
            };
          } catch (error) {
            console.error(`Error fetching batch ${batchId}:`, error); // Already present
            return { id: batchId, name: `${batchId} (Error)` };
          }
        });

        const [locations, batches] = await Promise.all([
          Promise.all(locationPromises),
          Promise.all(batchPromises),
        ]);
        console.log("Fetched locations:", locations); // Log locations
        console.log("Fetched batches:", batches); // Log batches

        const categoryMap = {
          Blocked: "BLK",
          Reserved: "RES",
          Unrestricted: "UNR",
          "Quality Inspection": "QIP",
          "In Transit": "INT",
        };
        console.log("categoryMap:", categoryMap); // Log category map

        // Create lookup maps
        const locationMap = locations.reduce((map, loc) => {
          map[loc.id] = loc.name;
          return map;
        }, {});
        console.log("locationMap:", locationMap); // Log location map

        const batchMap = batches.reduce((map, batch) => {
          map[batch.id] = batch.name;
          return map;
        }, {});
        console.log("batchMap:", batchMap); // Log batch map

        // Calculate total from filtered data
        const totalQty = filteredData.reduce(
          (sum, item) => sum + (item.sa_quantity || 0),
          0
        );
        console.log("totalQty in formatFilteredData:", totalQty); // Log total quantity

        let summary = `Total: ${totalQty} ${gdUOM}\nDETAILS:\n`;
        console.log("Summary start:", summary); // Log summary start

        // Process only filtered data for details
        const details = filteredData
          .map((item, index) => {
            const locationName =
              locationMap[item.location_id] || item.location_id;
            const qty = item.sa_quantity || 0;
            const category = item.category;
            const categoryAbbr = categoryMap[category] || category || "UNR";
            console.log("Processing item detail:", {
              index,
              locationName,
              qty,
              category,
              categoryAbbr,
            }); // Log item detail

            const movementTypeLabel = item.movement_type === "In" ? "IN" : "OUT";
            let itemDetail = `${
              index + 1
            }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr}) - ${movementTypeLabel}`;

            // Add serial number info if item is serialized (following SMconfirmDialog pattern)
            if (
              itemData?.serial_number_management === 1 &&
              item.serial_number
            ) {
              itemDetail += `\nSerial: ${item.serial_number}`;
              console.log("Serial info:", {
                serial_number: item.serial_number,
              }); // Log serial info
            }

            // Add batch info if batch exists (following SMconfirmDialog pattern)
            if (item.batch_id) {
              const batchName = batchMap[item.batch_id] || item.batch_id;
              console.log("Batch info:", {
                batch_id: item.batch_id,
                batchName,
              }); // Log batch info

              // Conditional format based on serialization (like SMconfirmDialog)
              itemDetail += `\n${
                itemData?.serial_number_management === 1 ? "Batch: " : "["
              }${batchName}${
                itemData?.serial_number_management === 1 ? "" : "]"
              }`;
            }

            // Add remarks if they exist (following SMconfirmDialog pattern)
            if (item.remarks && item.remarks.trim() !== "") {
              itemDetail += `\nRemarks: ${item.remarks}`;
            }

            return itemDetail;
          })
          .join("\n");
        console.log("Details:", details); // Log details

        return summary + details;
      } catch (error) {
        console.error("Error in formatFilteredData:", error); // Already present
        return `Total: 0 ${gdUOM}\n\nDETAILS:\nError formatting data`;
      }
    };

    const formattedString = await formatFilteredData(
      processedTemporaryData,
      itemData
    );
    console.log("📋 Formatted string:", formattedString); // Already present

    // Filter processedTemporaryData to only include items with sa_quantity > 0 for saving
    const filteredDataForSave = processedTemporaryData.filter(
      (item) => item.sa_quantity && item.sa_quantity > 0
    );
    console.log("Filtered data for saving:", filteredDataForSave); // Log filtered data for save

    // Only update data and close dialog if all validations pass
    if (isValid) {
      console.log("isValid before setData:", isValid); // Log isValid before setData
      console.log("Data to set:", {
        total_quantity: totalSaQuantity,
        balance_index: JSON.stringify(filteredDataForSave),
        adj_summary: formattedString,
        table_index: filteredDataForSave,
      }); // Log data to be set
      this.setData({
        [`stock_adjustment.${rowIndex}.total_quantity`]: totalSaQuantity,
        [`stock_adjustment.${rowIndex}.balance_index`]:
          JSON.stringify(filteredDataForSave),
        [`stock_adjustment.${rowIndex}.adj_summary`]: formattedString,
        [`dialog_index.table_index`]: filteredDataForSave,
      });

      // Show unit_price only if there are "In" movement types
      const hasInMovement = filteredDataForSave.some(
        (item) => item.movement_type === "In"
      );
      if (hasInMovement) {
        this.display(`stock_adjustment.${rowIndex}.unit_price`);
        this.disabled(`stock_adjustment.${rowIndex}.unit_price`, false);
      } else {
        this.hide(`stock_adjustment.${rowIndex}.unit_price`);
        this.disabled(`stock_adjustment.${rowIndex}.unit_price`, true);
      }

      console.log("processedTemporaryData:", processedTemporaryData); // Already present
      console.log(
        "closeDialog exists:",
        typeof this.closeDialog === "function"
      ); // Log closeDialog check

      this.models["previous_material_uom"] = undefined;

      // Clear the error message
      this.setData({
        error_message: "",
      });
      console.log("Error message cleared"); // Log error message clear

      this.closeDialog("sa_item_balance");
      console.log("Called closeDialog('sa_item_balance')"); // Log dialog close attempt
    } else {
      console.log("Validation failed, dialog not closed"); // Log validation failure
    }
  } catch (error) {
    console.error("Error in stock adjustment process:", error); // Already present
    console.log("Setting error message due to catch"); // Log error message set
    this.setData({
      error_message:
        "An error occurred while processing the adjustment. Please try again.",
    });

    if (this.$message) {
      console.log("Showing error message via $message"); // Log $message call
      this.$message.error(
        "Failed to process stock adjustment. Please try again."
      );
    }
  }
})();
