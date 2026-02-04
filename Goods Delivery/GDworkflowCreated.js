const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

const getPrefixData = async (
  organizationId,
  documentType = "Transfer Order",
) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (
  organizationId,
  runningNumber,
  documentType = "Transfer Order",
) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1,
      });
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  try {
    let generated = prefixData.current_prefix_config;
    generated = generated.replace("prefix", prefixData.prefix_value);
    generated = generated.replace("suffix", prefixData.suffix_value);
    generated = generated.replace(
      "month",
      String(now.getMonth() + 1).padStart(2, "0"),
    );
    generated = generated.replace(
      "day",
      String(now.getDate()).padStart(2, "0"),
    );
    generated = generated.replace("year", now.getFullYear());
    generated = generated.replace(
      "running_number",
      String(runNumber).padStart(prefixData.padding_zeroes, "0"),
    );
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  collection = "transfer_order",
  prefix = "to_id",
) => {
  const existingDoc = await db
    .collection(collection)
    .where({ [prefix]: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (
  prefixData,
  organizationId,
  collection = "transfer_order",
  prefix = "to_id",
) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      collection,
      prefix,
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Transfer Order number after maximum attempts",
    );
  }

  return { prefixToShow, runningNumber };
};

const sendNotification = async (notificationParam) => {
  await this.runWorkflow(
    "1945684747032735745",
    notificationParam,
    async (res) => {
      console.log("Notification sent successfully:", res);
    },
  ).catch((err) => {
    console.error("Notification workflow execution failed:", err);
  });
};

const createOrUpdatePicking = async (
  gdData,
  gdId,
  organizationId,
  isUpdate = false,
  pickingSetupResponse,
) => {
  try {
    let pickingSetupData;

    try {
      if (!gdData.plant_id) {
        throw new Error("Plant ID is required for picking setup");
      }

      if (!pickingSetupResponse || !pickingSetupResponse.data) {
        throw new Error("Invalid response from picking setup query");
      }

      if (pickingSetupResponse.data.length === 0) {
        console.log(
          `No picking required for plant ${gdData.plant_id} - continuing without Transfer Order`,
        );
        return { pickingStatus: null };
      } else if (pickingSetupResponse.data.length > 1) {
        console.warn(
          `Multiple picking setups found for plant ${gdData.plant_id}, using first active one`,
        );
        pickingSetupData = pickingSetupResponse.data[0];
      } else {
        pickingSetupData = pickingSetupResponse.data[0];
      }
    } catch (error) {
      console.error("Error retrieving picking setup:", error.message);
      return { pickingStatus: null };
    }

    // Initialize picking status
    let pickingStatus = null;

    if (pickingSetupData) {
      if (pickingSetupData.auto_trigger_to === 1) {
        pickingStatus = "Created";
      } else {
        pickingStatus = "Not Created";
      }

      if (pickingSetupData.auto_trigger_to === 1) {
        // Check if we need to update existing Transfer Order
        if (isUpdate) {
          try {
            // Find existing Transfer Order for this GD
            const existingTOResponse = await db
              .collection("transfer_order")
              .where({
                ref_doc_type: "Goods Delivery",
                gd_no: [gdId],
                movement_type: "Picking",
                is_deleted: 0,
              })
              .get();

            if (existingTOResponse.data && existingTOResponse.data.length > 0) {
              const existingTO = existingTOResponse.data[0];
              console.log(`Found existing Transfer Order: ${existingTO.to_id}`);

              // Prepare updated picking items with grouping for serialized items
              const updatedPickingItemGroups = new Map();

              gdData.table_gd.forEach((item, gdLineIndex) => {
                if (item.temp_qty_data && item.material_id) {
                  try {
                    const tempData = parseJsonSafely(item.temp_qty_data);

                    tempData.forEach((tempItem) => {
                      const materialId =
                        tempItem.material_id || item.material_id;
                      // Create a grouping key based on item, batch, location, and GD line index to prevent merging separate lines
                      const groupKey = `${materialId}_${
                        tempItem.batch_id || "no-batch"
                      }_${tempItem.location_id}_line${gdLineIndex}`;

                      if (!updatedPickingItemGroups.has(groupKey)) {
                        // Create new group
                        updatedPickingItemGroups.set(groupKey, {
                          item_code: String(materialId),
                          item_name: item.material_name,
                          item_desc: item.gd_material_desc || "",
                          batch_no: tempItem.batch_id
                            ? String(tempItem.batch_id)
                            : null,
                          so_no: item.line_so_no,
                          gd_no: gdData.delivery_no,
                          so_id: item.line_so_id,
                          so_line_id: item.so_line_item_id,
                          gd_id: gdId,
                          gd_line_id: item.id,
                          qty_to_pick: 0,
                          item_uom: String(item.gd_order_uom_id),
                          source_bin: String(tempItem.location_id),
                          pending_process_qty: 0,
                          line_status: "Open",
                          serial_numbers: [],
                        });
                      }

                      const group = updatedPickingItemGroups.get(groupKey);
                      group.qty_to_pick += parseFloat(tempItem.gd_quantity);
                      group.pending_process_qty += parseFloat(
                        tempItem.gd_quantity,
                      );

                      // Add serial number if exists
                      if (tempItem.serial_number) {
                        group.serial_numbers.push(
                          String(tempItem.serial_number),
                        );
                      }
                    });
                  } catch (error) {
                    console.error(
                      `Error parsing temp_qty_data for picking: ${error.message}`,
                    );
                  }
                }
              });

              // Convert grouped items to picking items array
              const updatedPickingItems = [];
              updatedPickingItemGroups.forEach((group) => {
                // Format serial numbers with line breaks if any exist
                if (group.serial_numbers.length > 0) {
                  group.serial_numbers = group.serial_numbers.join(", ");
                  group.is_serialized_item = 1;
                } else {
                  delete group.serial_numbers;
                  group.is_serialized_item = 0;
                }

                updatedPickingItems.push(group);
              });

              let soNOs = [
                ...new Set(updatedPickingItems.map((pi) => pi.so_no)),
              ];

              // Update the existing Transfer Order
              await db
                .collection("transfer_order")
                .doc(existingTO.id)
                .update({
                  assigned_to: gdData.assigned_to,
                  table_picking_items: updatedPickingItems,
                  updated_by: this.getVarGlobal("nickname"),
                  updated_at: new Date().toISOString(),
                  ref_doc: gdData.gd_ref_doc,
                  so_no: soNOs.join(", "),
                  customerIDs: [gdData.customer_name],
                })
                .then(() => {
                  console.log(
                    `Transfer order ${existingTO.to_id} updated successfully`,
                  );
                })
                .catch((error) => {
                  console.error("Error updating transfer order:", error);
                  throw error;
                });

              // Notification handling (existing code remains the same)
              if (existingTO.assigned_to && gdData.assigned_to) {
                const oldAssigned = Array.isArray(existingTO.assigned_to)
                  ? existingTO.assigned_to
                  : [existingTO.assigned_to];

                const newAssigned = Array.isArray(gdData.assigned_to)
                  ? gdData.assigned_to
                  : [gdData.assigned_to];

                // Users who were removed
                const removedUsers = oldAssigned.filter(
                  (userId) => !newAssigned.includes(userId),
                );

                // Users who were added
                const addedUsers = newAssigned.filter(
                  (userId) => !oldAssigned.includes(userId),
                );

                console.log(`Removed users: ${removedUsers.join(", ")}`);
                console.log(`Added users: ${addedUsers.join(", ")}`);

                // Send cancellation notifications to removed users
                const cancellationPromises = removedUsers.map(
                  async (userId) => {
                    const notificationParam = {
                      title: "Picking Assignment Cancelled",
                      body: `Your picking task for Transfer Order: ${existingTO.to_id} has been cancelled.`,
                      userId: [userId],
                      data: {
                        docId: existingTO.to_id,
                        deepLink: `sudumobileexpo://picking/batch/${existingTO.to_id}`,
                        action: "cancelled",
                      },
                    };

                    try {
                      await sendNotification(notificationParam);
                      console.log(
                        `Cancellation notification sent to user: ${userId}`,
                      );
                    } catch (error) {
                      console.error(
                        `Failed to send cancellation notification to ${userId}:`,
                        error,
                      );
                    }
                  },
                );

                // Send new assignment notifications to added users
                const assignmentPromises = addedUsers.map(async (userId) => {
                  const notificationParam = {
                    title: "New Picking Assignment",
                    body: `You have been assigned a picking task for Goods Delivery: ${gdData.delivery_no}. Transfer Order: ${existingTO.to_id}`,
                    userId: [userId],
                    data: {
                      docId: existingTO.to_id,
                      deepLink: `sudumobileexpo://picking/batch/${existingTO.to_id}`,
                      action: "assigned",
                    },
                  };

                  try {
                    await sendNotification(notificationParam);
                    console.log(
                      `Assignment notification sent to user: ${userId}`,
                    );
                  } catch (error) {
                    console.error(
                      `Failed to send assignment notification to ${userId}:`,
                      error,
                    );
                  }
                });

                try {
                  await Promise.all([
                    ...cancellationPromises,
                    ...assignmentPromises,
                  ]);
                  console.log("All notifications sent successfully");
                } catch (error) {
                  console.error("Some notifications failed to send:", error);
                }
              }

              return { pickingStatus };
            } else {
              console.log(
                "No existing Transfer Order found for update, creating new one",
              );
            }
          } catch (error) {
            console.error(
              "Error checking/updating existing Transfer Order:",
              error,
            );
            throw error;
          }
        }

        const transferOrder = {
          to_status: "Created",
          plant_id: gdData.plant_id,
          organization_id: organizationId,
          movement_type: "Picking",
          ref_doc_type: "Goods Delivery",
          gd_no: [gdId],
          delivery_no: gdData.delivery_no,
          so_no: gdData.so_no,
          customer_id: [gdData.customer_name],
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          ref_doc: gdData.gd_ref_doc,
          assigned_to: gdData.assigned_to,
          table_picking_items: [],
          is_deleted: 0,
        };

        // Process table items with grouping for serialized items
        const pickingItemGroups = new Map();

        gdData.table_gd.forEach((item, gdLineIndex) => {
          if (item.temp_qty_data && item.material_id) {
            try {
              const tempData = parseJsonSafely(item.temp_qty_data);

              tempData.forEach((tempItem) => {
                // Create a grouping key based on item, batch, location, and GD line index to prevent merging separate lines
                const groupKey = `${item.material_id}_${
                  tempItem.batch_id || "no-batch"
                }_${tempItem.location_id}_line${gdLineIndex}`;

                if (!pickingItemGroups.has(groupKey)) {
                  // Create new group
                  pickingItemGroups.set(groupKey, {
                    item_code: item.material_id,
                    item_name: item.material_name,
                    item_desc: item.gd_material_desc || "",
                    batch_no: tempItem.batch_id
                      ? String(tempItem.batch_id)
                      : null,
                    item_batch_id: tempItem.batch_id
                      ? String(tempItem.batch_id)
                      : null,
                    qty_to_pick: 0,
                    item_uom: String(item.gd_order_uom_id),
                    pending_process_qty: 0,
                    source_bin: String(tempItem.location_id),
                    line_status: "Open",
                    so_no: item.line_so_no,
                    gd_no: gdData.delivery_no,
                    so_id: item.line_so_id,
                    so_line_id: item.so_line_item_id,
                    gd_id: gdId,
                    gd_line_id: item.id,
                    serial_numbers: [],
                  });
                }

                const group = pickingItemGroups.get(groupKey);
                group.qty_to_pick += parseFloat(tempItem.gd_quantity);
                group.pending_process_qty += parseFloat(tempItem.gd_quantity);

                // Add serial number if exists
                if (tempItem.serial_number) {
                  group.serial_numbers.push(String(tempItem.serial_number));
                }
              });
            } catch (error) {
              console.error(
                `Error parsing temp_qty_data for new TO: ${error.message}`,
              );
            }
          }
        });

        // Convert grouped items to picking items array
        pickingItemGroups.forEach((group) => {
          // Format serial numbers with line breaks if any exist
          if (group.serial_numbers.length > 0) {
            group.serial_numbers = group.serial_numbers.join(", ");
            group.is_serialized_item = 1;
          } else {
            delete group.serial_numbers;
            group.is_serialized_item = 0;
          }

          transferOrder.table_picking_items.push(group);
        });

        const prefixData = await getPrefixData(
          organizationId,
          "Transfer Order",
        );

        if (prefixData) {
          const { prefixToShow, runningNumber } = await findUniquePrefix(
            prefixData,
            organizationId,
            "transfer_order",
            "to_id",
          );

          await updatePrefix(organizationId, runningNumber, "Transfer Order");
          transferOrder.to_id = prefixToShow;
        }

        await db
          .collection("transfer_order")
          .add(transferOrder)
          .then((res) => {
            console.log("Transfer order created:", res.id);
          })
          .catch((error) => {
            console.error("Error creating transfer order:", error);
            throw error;
          });

        if (transferOrder.assigned_to && transferOrder.assigned_to.length > 0) {
          const notificationParam = {
            title: "New Picking Assignment",
            body: `You have been assigned a picking task for Goods Delivery: ${gdData.delivery_no}. Transfer Order: ${transferOrder.to_id}`,
            userId: transferOrder.assigned_to,
            data: {
              docId: transferOrder.to_id,
              deepLink: `sudumobileexpo://picking/batch/${transferOrder.to_id}`,
            },
          };

          await sendNotification(notificationParam);
        }
      }
    }

    return { pickingStatus };
  } catch (error) {
    console.error("Error in createOrUpdatePicking:", error);
    throw error;
  }
};

(async () => {
  try {
    this.showLoading("Saving Goods Delivery as Created...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "2017151544868491265",
      { allData: data, saveAs: "Created", pageStatus: data.page_status },
      async (res) => {
        console.log("Goods Delivery saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Goods Delivery:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    // Handle workflow errors
    if (
      workflowResult.data.code === "400" ||
      workflowResult.data.code === 400 ||
      workflowResult.data.success === false
    ) {
      this.hideLoading();
      const errorMessage =
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to save Goods Delivery";
      this.$message.error(errorMessage);
      return;
    }

    // Handle success
    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      // Call createOrUpdatePicking after successful workflow
      try {
        const pickingSetupResponse = await db
          .collection("picking_setup")
          .where({
            plant_id: data.plant_id,
            picking_after: "Goods Delivery",
            picking_required: 1,
          })
          .get();

        const rawGdId = await db
          .collection("goods_delivery")
          .where({
            delivery_no: data.delivery_no,
            so_id: data.so_id,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
          })
          .field("id")
          .get();

        const gdId = rawGdId.data[0].id;

        if (pickingSetupResponse.data && pickingSetupResponse.data.length > 0) {
          const isUpdate = data.page_status === "Edit";
          const { pickingStatus } = await createOrUpdatePicking(
            data,
            gdId,
            data.organization_id,
            isUpdate,
            pickingSetupResponse,
          );

          if (pickingStatus) {
            await db.collection("goods_delivery").doc(gdId).update({
              picking_status: pickingStatus,
            });

            await db
              .collection("goods_delivery_fwii8mvb_sub")
              .where({ goods_delivery_id: gdId })
              .update({ picking_status: pickingStatus });
          }
        }
      } catch (pickingError) {
        console.error("Error handling picking:", pickingError);
        // Don't fail the entire operation if picking handling fails
      }

      this.hideLoading();
      const successMessage =
        workflowResult.data.message ||
        workflowResult.data.msg ||
        "Goods Delivery saved successfully";
      this.$message.success(successMessage);
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Goods Delivery";
    this.$message.error(errorMessage);
  }
})();
