// Make this an async validation function
const validateCategories = async (rule, value, callback) => {
  try {
    // Small delay to allow data to be set
    await new Promise((resolve) => setTimeout(resolve, 100));

    const data = this.getValues();
    const fieldParts = rule.field.split(".");
    const index = fieldParts[2];
    console.log("index", index);

    // Make sure the data structure exists
    if (
      !data ||
      !data.sm_item_balance ||
      !data.sm_item_balance.table_item_balance ||
      !data.sm_item_balance.table_item_balance[index]
    ) {
      console.log("Data structure not fully formed yet");
      // Pass validation if data is not available yet
      callback();
      return;
    }

    const categoryFrom =
      data.sm_item_balance.table_item_balance[index].category_from;
    const categoryTo =
      data.sm_item_balance.table_item_balance[index].category_to;

    console.log("categoryFrom", categoryFrom);
    console.log("categoryTo", categoryTo);

    // Create or use a global validation state
    if (!window.validationState) {
      window.validationState = {};
    }

    // Only validate if both values are provided
    if (categoryFrom && categoryTo) {
      if (categoryFrom === categoryTo) {
        window.validationState[index] = false;
        callback(`Categories cannot be the same`);
      } else {
        window.validationState[index] = true;
        callback();
      }
    } else {
      // If one or both are missing, pass validation
      window.validationState[index] = true;
      callback();
    }
  } catch (error) {
    console.error("Validation error:", error);
    // If there's an error, pass validation to avoid blocking the form
    callback();
  }
};

// Use the function
validateCategories(rule, value, callback);
