const checkPickingSetup = async (plantID) => {
  try {
    const resPickingSetup = await db
      .collection("picking_setup")
      .where({ plant_id: plantID })
      .get();

    return resPickingSetup;
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
};

const handleConvertGD = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
) => {
  try {
    this.showLoading("Converting...");
    await this.runWorkflow(
      "1985267806223810561",
      {
        gd_type: convertType,
        so_ids: selectedRecords.map((record) => record.id),
        plant_id: plantID,
        organization_id: organizationID,
      },
      async (res) => {
        console.log("Mapped GD Data", res.data);
        const mappedData = res.data.data;

        if (convertType === "single") {
          this.hideLoading();
          await this.toView({
            target: "1902054888473481218",
            type: "add",
            data: {
              ...mappedData[0],
            },
            params: {
              allItems: mappedData[0].all_item,
            },
            position: "rtl",
            mode: "dialog",
            width: "80%",
            title: "Add",
          });
        } else if (convertType === "multiple") {
          this.hideLoading();
          await this.refresh();
          await this.$alert(
            `Successfully created ${
              mappedData.length
            } draft goods deliveries.<br><br>
      <strong>Goods Delivery Numbers:</strong><br> ${mappedData
        .map((item) => item.delivery_no)
        .join("<br>")}`,
            "Success Converted to Goods Deliveries",
            {
              confirmButtonText: "OK",
              dangerouslyUseHTMLString: true,
              type: "success",
            },
          );
        }
      },
      async (err) => {
        this.hideLoading();
        this.$alert(err, "Error", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      },
    );
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
};

(async () => {
  try {
    const selectedRecords = arguments[0].selectedRecords;
    const plantID = arguments[0].plantID;
    const organizationID = arguments[0].organizationID;

    console.log("handleConvertGD selectedRecords:", selectedRecords);

    const resPickingSetup = await checkPickingSetup(plantID);

    // return if picking setup is not found or SO -> Picking -> GD
    if (resPickingSetup && resPickingSetup.data.length > 0) {
      const pickingSetup = resPickingSetup.data[0];

      if (pickingSetup.picking_required === 1) {
        if (pickingSetup.picking_after === "Sales Order") {
          await this.$alert(
            "Cannot convert to Goods Delivery after Sales Order. Please check your picking setup.",
            "Error",
            {
              confirmButtonText: "OK",
              type: "error",
              dangerouslyUseHTMLString: true,
            },
          );
          throw new Error(
            "Cannot convert to Goods Delivery after Sales Order. Please check your picking setup.",
          );
        }
      }
    } else {
      await this.$alert(
        "Cannot convert to Goods Delivery. Please check your picking setup.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      );

      throw new Error(
        "Cannot convert to Goods Delivery. Please check your picking setup.",
      );
    }

    if (selectedRecords.length > 1) {
      await this.$confirm(
        `Would you like to convert these into a single goods delivery or into multiple goods deliveries?<br><br>
          <strong>Single GD:</strong> All items combined into one document<br>
          <strong>Multiple GDs:</strong> Separate deliveries for better tracking`,
        "Sales Order Conversion",
        {
          confirmButtonText: "Single GD",
          cancelButtonText: "Multiple GDs",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,

          beforeClose: async (action, instance, done) => {
            // handle single GD
            if (action === "confirm") {
              const uniqueCustomers = new Set(
                selectedRecords.map((record) => record.customer_name.id),
              );

              const allSameCustomer = uniqueCustomers.size === 1;

              if (!allSameCustomer) {
                await this.$confirm(
                  `Selected SOs contain multiple customers. Create individual goods deliveries - one GD per SO?`,
                  "Multiple Customers Detected",
                  {
                    confirmButtonText: "Proceed",
                    cancelButtonText: "Cancel",
                    dangerouslyUseHTMLString: true,
                    type: "info",
                  },
                ).catch(() => {
                  console.log("User clicked Cancel or closed the dialog");
                  throw new Error();
                });

                await handleConvertGD(
                  selectedRecords,
                  plantID,
                  organizationID,
                  "multiple",
                );
                return;
              } else {
                await handleConvertGD(
                  selectedRecords,
                  plantID,
                  organizationID,
                  "single",
                );
              }
              done();
            } else if (action === "cancel") {
              // handle multiple GD
              await handleConvertGD(
                selectedRecords,
                plantID,
                organizationID,
                "multiple",
              );
              done();
            } else {
              done();
            }
          },
        },
      );
    } else {
      await handleConvertGD(selectedRecords, plantID, organizationID, "single");
    }
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
})();
