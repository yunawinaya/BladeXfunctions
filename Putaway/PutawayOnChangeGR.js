(async () => {
  try {
    const grNo = await this.getValue("gr_no");
    const plantId = await this.getValue("plant_id");

    const fetchSerialNumber = async () => {
      try {
        const table_putaway_item = this.getValue("table_putaway_item");
        
        if (!Array.isArray(table_putaway_item) || table_putaway_item.length === 0) {
          console.log("No putaway items found for serial number fetching");
          return;
        }

        for (const [index, putaway] of table_putaway_item.entries()) {
          if (putaway.is_serialized_item === 1) {
            const resSerialNumber = await db
              .collection("serial_number")
              .where({ transaction_no: grNo, plant_id: plantId })
              .get();
            if (resSerialNumber.data && resSerialNumber.data.length > 0) {
              putaway.serial_numbers = resSerialNumber.data
                .map((serial) => serial.system_serial_number)
                .join(", ");
              await this.setData({
                [`table_putaway_item.${index}.serial_numbers`]:
                  putaway.serial_numbers,
              });
            }
          }
        }
      } catch (error) {
        console.error("Error fetching serial numbers:", error);
      }
    };

    const viewSerialNumber = async () => {
      const table_putaway_item = this.getValue("table_putaway_item");
      const table_putaway_records = this.getValue("table_putaway_records");
      if (table_putaway_item.length > 0) {
        for (const putaway of table_putaway_item) {
          if (putaway.is_serialized_item === 1) {
            await this.display("table_putaway_item.select_serial_number");
          }
        }
      }
      if (table_putaway_records.length > 0) {
        for (const putaway of table_putaway_records) {
          if (
            putaway.serial_numbers !== "" &&
            putaway.serial_numbers !== null
          ) {
            await this.display("table_putaway_records.serial_numbers");
          }
        }
      }
    };

    const setSerialNumber = async () => {
      try {
        const table_putaway_item = this.getValue("table_putaway_item");

        // Check if table_putaway_item exists and is an array
        if (
          !Array.isArray(table_putaway_item) ||
          table_putaway_item.length === 0
        ) {
          console.log("No putaway items found or invalid data structure");
          return;
        }

        for (const [index, putaway] of table_putaway_item.entries()) {
          try {
            // Check if item is serialized
            if (putaway.is_serialized_item === 1) {
              console.log(
                `Processing serialized item at index ${index}:`,
                putaway.item_code || putaway.id
              );

              // Check if serial_numbers exists and is not empty
              if (
                !putaway.serial_numbers ||
                putaway.serial_numbers === null ||
                putaway.serial_numbers === undefined ||
                typeof putaway.serial_numbers !== "string" ||
                putaway.serial_numbers.trim() === ""
              ) {
                console.warn(
                  `No valid serial numbers found for item at index ${index}`
                );
                continue;
              }

              // Split and clean serial numbers
              const serialNumbers = putaway.serial_numbers
                .split(",")
                .map((sn) => sn.trim())
                .filter((sn) => sn !== "");

              if (serialNumbers.length === 0) {
                console.warn(
                  `No valid serial numbers after processing for item at index ${index}`
                );
                continue;
              }

              console.log(
                `Setting ${serialNumbers.length} serial numbers for item at index ${index}:`,
                serialNumbers
              );

              // Set option data for select dropdown
              await this.setOptionData(
                [`table_putaway_item.${index}.select_serial_number`],
                serialNumbers
              );

              // Set the actual data
              await this.setData({
                [`table_putaway_item.${index}.select_serial_number`]:
                  serialNumbers,
              });

              // Disable putaway_qty field for serialized items
              await this.disabled(
                [`table_putaway_item.${index}.putaway_qty`],
                true
              );

              console.log(
                `Successfully set serial numbers for item at index ${index}`
              );
            }
          } catch (itemError) {
            console.error(
              `Error processing item at index ${index}:`,
              itemError
            );
            // Continue with next item instead of breaking the entire function
            continue;
          }
        }
      } catch (error) {
        console.error("Error in setSerialNumber function:", error);
        // Don't throw error to prevent breaking the entire onMounted flow
      }
    };

    const grData = await db
      .collection("goods_receiving")
      .where({ id: grNo })
      .get()
      .then((response) => {
        if (response.data && response.data.length > 0) {
          return response.data[0];
        }
        return null;
      });

    if (!grData) {
      console.error(`Goods Receiving with ID ${grNo} not found`);
      return;
    }

    if (!grData.table_gr || !Array.isArray(grData.table_gr) || grData.table_gr.length === 0) {
      console.error("No GR items found in the goods receiving record");
      return;
    }

    let tablePutawayItem = [];

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    for (const [index, item] of grData.table_gr.entries()) {
      try {
        // Skip items without item_id
        if (!item.item_id) {
          console.log(`Skipping item at index ${index} - no item_id`);
          continue;
        }

        const resItem = await db
          .collection("Item")
          .where({ id: item.item_id })
          .get();
          
        if (!resItem || !resItem.data || resItem.data.length === 0) {
          console.warn(`Item ${item.item_id} not found in Item collection`);
          continue;
        }

        const itemData = resItem.data[0];
        if (
          (itemData.receiving_inspection === 0 &&
            item.inv_category === "Quality Inspection") ||
          item.inv_category !== "Quality Inspection"
        ) {
          let batchNo = null;

          if (item.item_batch_no && item.item_batch_no !== "-") {
            try {
              const resBatch = await db
                .collection("batch")
                .where({
                  batch_number: item.item_batch_no,
                  organization_id: organizationId,
                })
                .get();
              batchNo = resBatch?.data?.[0] || null;
            } catch (batchError) {
              console.warn(`Error fetching batch ${item.item_batch_no}:`, batchError);
            }
          }

          tablePutawayItem.push({
            line_index: index + 1,
            item_code: item.item_id,
            item_name: item.item_name || "",
            item_desc: item.item_desc || "",
            batch_no: batchNo?.id || "",
            source_inv_category: item.inv_category || "",
            target_inv_category: "Unrestricted",
            received_qty: item.received_qty || 0,
            item_uom: item.item_uom || "",
            source_bin: item.location_id || "",
            qty_to_putaway: item.received_qty || 0,
            pending_process_qty: item.received_qty || 0,
            putaway_qty: 0,
            target_location: "",
            remark: "",
            qi_no: null,
            line_status: "Open",
            po_no: item.line_po_id || "",
            is_split: "No",
            parent_or_child: "Parent",
            parent_index: index,
            unit_price: item.unit_price || 0,
            total_price: (item.unit_price || 0) * (item.received_qty || 0),
            is_serialized_item: item.is_serialized_item || 0,
          });
        }
      } catch (itemError) {
        console.error(`Error processing GR item at index ${index}:`, itemError);
        continue;
      }
    }

    await this.setData({
      receiving_no: grData.gr_no || "",
      table_putaway_item: tablePutawayItem,
      supplier_id: grData.supplier_name || "",
      created_by: this.getVarGlobal("nickname") || "",
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      organization_id: organizationId,
    });

    console.log(`Successfully created putaway with ${tablePutawayItem.length} items from GR ${grData.gr_no}`);

    // Wait for setData to complete (if needed by the platform)
    // Then process serial numbers in proper sequence
    try {
      await fetchSerialNumber();
      await viewSerialNumber();  
      await setSerialNumber();
      
      // Trigger putaway strategy after all serial number processing is complete
      this.triggerEvent("func_getPutawayStrategy");
    } catch (serialError) {
      console.error("Error processing serial numbers:", serialError);
      // Still trigger strategy even if serial processing fails
      this.triggerEvent("func_getPutawayStrategy");
    }
  } catch (error) {
    console.error("Error fetching Goods Receiving:", error);
  }
})();
