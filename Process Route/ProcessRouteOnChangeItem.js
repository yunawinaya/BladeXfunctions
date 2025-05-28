(async () => {
  try {
    const allData = this.getValues();
    const newValue = arguments[0].value;
    const pageStatus = this.getValue("page_status");
    const processRouteId = this.getValue("id");

    // Helper function to fetch and set BOM data
    const fetchAndSetBomData = async (
      materialCode,
      isEdit = false,
      existingBomVersion = null
    ) => {
      try {
        const response = await db
          .collection("bill_of_materials")
          .where({
            parent_material_code: materialCode,
          })
          .get();

        console.log("BOM response:", response);

        this.setOptionData("bom_version", response.data);
        this.disabled(["bom_version"], true);

        // Check if response.data is empty
        if (response.data.length > 0) {
          this.disabled(["bom_version"], false);

          // Filter response.data for parent_mat_is_default = 1
          const filteredData = response.data.filter(
            (item) => item.parent_mat_is_default === 1
          );
          console.log("Filtered BOM data:", filteredData);

          // Set BOM version based on context
          if (isEdit && existingBomVersion) {
            // For edit mode, use existing BOM version
            this.setData({ bom_version: existingBomVersion });
          } else if (filteredData.length > 0) {
            // For new/changed material, use default BOM version
            this.setData({ bom_version: filteredData[0].id });
          }
        }

        const itemData = await db
          .collection("Item")
          .where({ id: materialCode })
          .get()
          .then((res) => {
            return res.data[0];
          });

        console.log("Item data:", itemData);

        if (itemData) {
          this.setData({
            material_name: itemData.material_name,
            material_desc: itemData.material_desc,
          });
        }
      } catch (error) {
        console.error("Error fetching BOM data:", error);
        this.setOptionData("bom_version", []);
        this.disabled(["bom_version"], true);
        throw error;
      }
    };

    if (pageStatus === "Edit" || (pageStatus === "View" && processRouteId)) {
      // Handle Edit/View mode
      const response = await db
        .collection("process_route")
        .where({ id: processRouteId })
        .get();

      const processRouteData = response.data?.[0];
      if (!processRouteData) {
        throw new Error("Process Route not found");
      }

      this.disabled(["bom_version"], false);

      const processRouteMaterialId = processRouteData.material_code;
      const processRouteBomVersion = processRouteData.bom_version;

      if (newValue && newValue !== processRouteMaterialId) {
        // Material changed in edit mode - fetch new BOM data
        await fetchAndSetBomData(newValue, false);
      } else {
        // Material unchanged in edit mode - fetch existing BOM data
        await fetchAndSetBomData(
          processRouteMaterialId,
          true,
          processRouteBomVersion
        );
      }
    } else {
      // Handle Add mode
      this.setData({ bom_version: "" });

      if (newValue) {
        await fetchAndSetBomData(newValue, false);
      } else {
        // No material selected, clear BOM options
        this.setOptionData("bom_version", []);
        this.disabled(["bom_version"], true);
      }
    }
  } catch (error) {
    console.error("Error in BOM version handling:", error);

    // Reset to safe state on error
    this.setData({ bom_version: "" });
    this.setOptionData("bom_version", []);
    this.disabled(["bom_version"], true);

    // Optionally show user-friendly error message
    if (this.$message) {
      this.$message.error("Failed to load BOM versions. Please try again.");
    }
  }
})();
