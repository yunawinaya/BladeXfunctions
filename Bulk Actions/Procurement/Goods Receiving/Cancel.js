// Bulk Cancel Created GRs - Reverses PO quantity reservations
(async () => {
  try {
    this.showLoading();

    // 1. Get selected records from list component
    const listID = "custom_fnns00ze";
    let selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    // 2. Filter for Created status only
    const createdGRs = selectedRecords.filter(
      (item) => item.gr_status === "Created"
    );

    // 3. Validate selection
    if (createdGRs.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one Created goods receiving."
      );
      return;
    }

    // 4. Show confirmation dialog
    const grNumbers = createdGRs.map((item) => item.gr_no);

    await this.$confirm(
      `You've selected ${grNumbers.length} goods receiving(s) to cancel.<br><br>` +
        `<strong>Goods Receiving Numbers:</strong><br>` +
        `${grNumbers.join(", ")}<br><br>` +
        `This will reverse the PO quantity reservations. Do you want to proceed?`,
      "Cancel Created Goods Receiving",
      {
        confirmButtonText: "Yes, Cancel GRs",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }
    ).catch(() => {
      this.hideLoading();
      console.log("User clicked Cancel");
      throw new Error();
    });

    // 5. Group GRs by PO for efficient updates
    const groupGRsByPO = (createdGRs) => {
      const grsByPO = new Map();

      for (const gr of createdGRs) {
        // Get all PO IDs for this GR (can be multiple)
        const poIds = Array.isArray(gr.po_id) ? gr.po_id : [gr.po_id];

        for (const poId of poIds) {
          if (!grsByPO.has(poId)) {
            grsByPO.set(poId, []);
          }
          grsByPO.get(poId).push(gr);
        }
      }

      return grsByPO;
    };

    const grsByPO = groupGRsByPO(createdGRs);

    console.log(
      `Processing ${createdGRs.length} Created GRs affecting ${grsByPO.size} PO(s)`
    );

    // 6. Reverse PO quantities
    const reversePOQuantities = async (poId, grs) => {
      try {
        // Fetch the PO
        const resPO = await db
          .collection("purchase_order")
          .where({ id: poId })
          .get();

        if (!resPO.data || !resPO.data.length) {
          console.warn(`Purchase order ${poId} not found`);
          return;
        }

        const poDoc = resPO.data[0];
        const updatedPoItems = [...poDoc.table_po];

        // Calculate total quantities to reverse per line item
        const quantityReversals = new Map(); // po_line_item_id -> total_qty_to_reverse

        for (const gr of grs) {
          for (const grLine of gr.table_gr) {
            const lineId = grLine.po_line_item_id;
            const qty = parseFloat(grLine.received_qty || 0);

            quantityReversals.set(
              lineId,
              (quantityReversals.get(lineId) || 0) + qty
            );
          }
        }

        // Apply reversals to PO line items
        for (let i = 0; i < updatedPoItems.length; i++) {
          const poLine = updatedPoItems[i];
          const reversalQty = quantityReversals.get(poLine.id) || 0;

          if (reversalQty > 0) {
            const currentCreatedQty = parseFloat(
              poLine.created_received_qty || 0
            );
            const newCreatedQty = Math.max(0, currentCreatedQty - reversalQty);

            updatedPoItems[i] = {
              ...poLine,
              created_received_qty: newCreatedQty,
            };

            console.log(
              `Reversed ${reversalQty} from PO line ${poLine.id}: ` +
                `${currentCreatedQty} -> ${newCreatedQty}`
            );
          }
        }

        // Determine new gr_status for the PO after cancelling these GRs
        // After reversing quantities, check if any created_received_qty remains
        // If created_received_qty > 0, it means there are still other Created GRs
        const hasRemainingCreatedGRs = updatedPoItems.some(
          (item) => (item.created_received_qty || 0) > 0
        );

        // Calculate new gr_status based on line items
        const allCompleted = updatedPoItems.every(
          (item) => (item.received_qty || 0) >= (item.quantity || 0)
        );
        const anyProcessing = updatedPoItems.some(
          (item) =>
            (item.received_qty || 0) > 0 &&
            (item.received_qty || 0) < (item.quantity || 0)
        );

        let newGRStatus;

        if (hasRemainingCreatedGRs) {
          // If there are still Created GRs, keep status as "Created"
          newGRStatus = "Created";
        } else if (allCompleted) {
          newGRStatus = "Fully Received";
        } else if (anyProcessing) {
          newGRStatus = "Partially Received";
        } else {
          // No Created GRs and no received quantities - set to "Cancelled"
          // This indicates GRs were created but then cancelled
          newGRStatus = "Cancelled";
        }

        // Update PO with reversed quantities and new gr_status
        const updateData = {
          table_po: updatedPoItems,
        };

        // Update gr_status if it changed
        if (newGRStatus !== poDoc.gr_status) {
          updateData.gr_status = newGRStatus;
          console.log(
            `Updating PO ${poId} gr_status from "${poDoc.gr_status}" to "${newGRStatus}"`
          );
        }

        await db.collection("purchase_order").doc(poDoc.id).update(updateData);

        console.log(`Successfully reversed quantities for PO ${poId}`);
      } catch (error) {
        console.error(`Error reversing quantities for PO ${poId}:`, error);
        throw error;
      }
    };

    // 7. Process each PO group and update GR statuses
    let successCount = 0;
    let failCount = 0;
    const failedGRs = [];

    // First, reverse all PO quantities
    for (const [poId, grs] of grsByPO) {
      try {
        await reversePOQuantities(poId, grs);
      } catch (error) {
        console.error(`Failed to reverse PO ${poId}:`, error);
        // Continue with other POs even if one fails
      }
    }

    // Then, update all GR statuses to Cancelled
    for (const gr of createdGRs) {
      try {
        await db.collection("goods_receiving").doc(gr.id).update({
          gr_status: "Cancelled",
        });
        successCount++;
        console.log(`Cancelled GR ${gr.gr_no}`);
      } catch (error) {
        failCount++;
        failedGRs.push(gr.gr_no);
        console.error(`Failed to cancel ${gr.gr_no}:`, error);
      }
    }

    // 8. Refresh and notify
    this.refresh();
    this.hideLoading();

    if (failCount > 0) {
      this.$message.warning(
        `Cancelled ${successCount} GR(s). Failed: ${failCount} (${failedGRs.join(
          ", "
        )})`
      );
    } else {
      this.$message.success(
        `Successfully cancelled ${successCount} goods receiving(s).`
      );
    }
  } catch (error) {
    this.hideLoading();
    if (error.message) {
      this.$message.error(error.message);
    }
    console.error("Error in bulk cancel process:", error);
  }
})();
