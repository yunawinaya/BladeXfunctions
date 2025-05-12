// Helper functions
const generatePrefix = (prefixData) => {
  const now = new Date();
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix) => {
  try {
    const existingDoc = await db
      .collection("process_route")
      .where({ process_route_no: generatedPrefix })
      .get();
    return !existingDoc.data || existingDoc.data.length === 0;
  } catch (error) {
    console.error("Error checking uniqueness:", error);
    return false;
  }
};

const findUniquePrefix = async (prefixData) => {
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix({
      ...prefixData,
      running_number: runningNumber,
    });
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Process Route number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixConfiguration = async () => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({ document_types: "Process Route" })
      .get();

    return prefixEntry.data && prefixEntry.data.length > 0
      ? prefixEntry.data[0]
      : null;
  } catch (error) {
    console.error("Error fetching prefix configuration:", error);
    return null;
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";

    // Determine page status using multiple methods for compatibility
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    // Set page status in data for reference
    this.setData({ page_status: pageStatus });

    console.log("Page status:", pageStatus);

    if (pageStatus !== "Add") {
      try {
        const processRouteId = this.getValue("id");

        if (!processRouteId) {
          throw new Error("Process Route ID not found");
        }

        // Fetch process route data
        const processRouteResponse = await db
          .collection("process_route")
          .where({ id: processRouteId })
          .get();

        if (
          !processRouteResponse.data ||
          processRouteResponse.data.length === 0
        ) {
          throw new Error(`Process Route with ID ${processRouteId} not found`);
        }

        const processRouteData = processRouteResponse.data[0];
        console.log("Process Route data retrieved:", processRouteData);

        // Extract all necessary fields
        const {
          id,
          process_route_no,
          process_route_name,
          material_code,
          is_main_process_route,
          bom_version,
          process_table,
          remark,
          mat_consumption_table,
        } = processRouteData;

        // Set data for all modes
        await this.setData({
          id,
          process_route_no,
          process_route_name,
          material_code,
          is_main_process_route,
          bom_version,
          process_table,
          remark,
          mat_consumption_table,
        });

        // Always disable material_code in Edit mode
        this.disabled(["material_code"], true);

        // Handle View mode
        if (pageStatus === "View") {
          this.disabled(
            [
              "process_route_no",
              "process_route_name",
              "material_code",
              "is_main_process_route",
              "bom_version",
              "process_table",
              "remark",
              "mat_consumption_table",
            ],
            true
          );

          this.hide(["button_save", "button_cancel"], true);
        }
      } catch (error) {
        console.error("Error loading process route data:", error);
        this.$message.error(
          `Failed to load process route data: ${error.message}`
        );
      }
    } else {
      // Add mode - generate prefix
      try {
        // Get prefix configuration
        const prefixData = await getPrefixConfiguration();

        if (prefixData) {
          if (prefixData.is_active === 0) {
            this.disabled(["process_route_no"], false);
          } else {
            // Generate unique prefix
            const { prefixToShow, runningNumber } = await findUniquePrefix(
              prefixData
            );
            await this.setData({ process_route_no: prefixToShow });
            this.disabled(["process_route_no"], true);
          }
        } else {
          console.warn("No prefix configuration found for Process Route");
          this.disabled(["process_route_no"], false);
        }
      } catch (error) {
        console.error("Error generating prefix:", error);
        this.$message.error(`Error generating prefix: ${error.message}`);
        this.disabled(["process_route_no"], false);
      }
    }
  } catch (error) {
    console.error("Error in process route mounted function:", error);
    this.$message.error("An error occurred while initializing the form");
  }
})();
