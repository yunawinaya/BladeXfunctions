(async () => {
  const rowIndex = arguments[0].rowIndex;

  if (arguments[0].value) {
    const allData = this.getValues();
    const movementType = allData.movement_type;
    const page_status = allData.page_status;
    const plant = allData.issuing_operation_faci;
    const stock_movement = allData.stock_movement;

    const {
      material_desc,
      based_uom,
      purchase_unit_price,
      table_uom_conversion,
      mat_purchase_tax_id,
      item_batch_management,
      batch_number_genaration,
    } = arguments[0].fieldModel.item;

    const movementTypeCategories = {
      "Inter Operation Facility Transfer": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
      ],
      "Inter Operation Facility Transfer (Receiving)": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
      ],
      "Location Transfer": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
        "Reserved",
      ],
      "Miscellaneous Issue": ["Unrestricted"],
      "Miscellaneous Receipt": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
      ],
      "Disposal/Scrap": ["Unrestricted", "Quality Inspection", "Blocked"],
      "Inventory Category Transfer Posting": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
      ],
    };

    const fetchItemData = async () => {
      try {
        if (movementType === "Miscellaneous Receipt") {
          this.display("stock_movement.batch_id");

          if (item_batch_management === 1) {
            switch (batch_number_genaration) {
              case "According To System Settings":
                this.setData({
                  [`stock_movement.${rowIndex}.batch_id`]:
                    "Auto-generated batch number",
                });
                this.disabled(`stock_movement.${rowIndex}.batch_id`, true);

                break;

              case "Manual Input":
                this.disabled(`stock_movement.${rowIndex}.batch_id`, false);
                break;
            }
          } else {
            this.setData({ [`stock_movement.${rowIndex}.batch_id`]: "-" });
            this.disabled(`stock_movement.${rowIndex}.batch_id`, true);
          }
        } else {
          this.hide("stock_movement.batch_id");
        }

        if (plant && stock_movement && stock_movement.length > 0) {
          const resBinLocation = await db
            .collection("bin_location")
            .where({
              plant_id: plant,
              bin_status: 1,
              is_deleted: 0,
            })
            .get();

          let binLocation;

          if (resBinLocation.data && resBinLocation.data.length > 0) {
            const defaultBinLocation = resBinLocation.data.find(
              (bin) => bin.is_default === 1
            );
            if (defaultBinLocation) {
              this.setData({
                [`stock_movement.${rowIndex}.location_id`]:
                  defaultBinLocation.id,
              });
            }
            binLocation = resBinLocation.data;
            this.setOptionData(
              [`stock_movement.${rowIndex}.location_id`],
              binLocation
            );
            this.disabled(`stock_movement.${rowIndex}.location_id`, false);
            this.setData({
              [`stock_movement.${rowIndex}.category`]: "Unrestricted",
            });
          } else {
            console.warn("No default bin location found for plant:", plant);
          }
        } else {
          this.disabled(`stock_movement.location_id`, true);
        }

        // Fetch and filter categories
        const categoryObjectResponse = await db
          .collection("blade_dict")
          .where({ code: "inventory_category" })
          .get();
        const allowedCategories = movementTypeCategories[movementType] || [
          "Unrestricted",
        ];
        const filteredCategories = categoryObjectResponse.data.filter(
          (category) => allowedCategories.includes(category.dict_key)
        );

        console.log("filteredCategories", filteredCategories);

        // Set category options
        await this.setOptionData(
          [`stock_movement.${rowIndex}.category`],
          filteredCategories
        );

        this.disabled([`stock_movement.${rowIndex}.category`], false);
        const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
        altUoms.push(based_uom);

        const uomOptions = [];

        const processData = async () => {
          for (let i = 0; i < altUoms.length; i++) {
            const res = await db
              .collection("unit_of_measurement")
              .where({ id: altUoms[i] })
              .get();
            uomOptions.push(res.data[0]);
          }

          console.log("UomOptions", uomOptions);
        };

        const updateUomOption = async () => {
          await processData();

          await this.setOptionData(
            [`stock_movement.${rowIndex}.received_quantity_uom`],
            uomOptions
          );
        };

        updateUomOption();

        await this.setData({
          [`stock_movement.${rowIndex}.stock_summary`]: "",
          [`stock_movement.${rowIndex}.received_quantity_uom`]: based_uom,
          [`stock_movement.${rowIndex}.quantity_uom`]: based_uom,
          [`stock_movement.${rowIndex}.unit_price`]: purchase_unit_price,
        });
      } catch (error) {
        console.error("Error fetching item data:", error);
      }
    };

    fetchItemData();
  } else {
    this.setData({
      [`stock_movement.${rowIndex}.requested_qty`]: 0,
      [`stock_movement.${rowIndex}.total_quantity`]: 0,
      [`stock_movement.${rowIndex}.to_recv_qty`]: 0,
      [`stock_movement.${rowIndex}.received_quantity`]: 0,
      [`stock_movement.${rowIndex}.received_quantity_uom`]: "",
      [`stock_movement.${rowIndex}.quantity_uom`]: "",
      [`stock_movement.${rowIndex}.unit_price`]: 0,
      [`stock_movement.${rowIndex}.amount`]: 0,
      [`stock_movement.${rowIndex}.location_id`]: "",
      [`stock_movement.${rowIndex}.batch_id`]: "-",
      [`stock_movement.${rowIndex}.category`]: "",
      [`stock_movement.${rowIndex}.stock_summary`]: "",
      [`stock_movement.${rowIndex}.balance_id`]: "",
      [`stock_movement.${rowIndex}.temp_qty_data`]: "",
    });

    this.disabled([`stock_movement.${rowIndex}.category`], true);
  }
})();
