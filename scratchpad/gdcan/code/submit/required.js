// CHECK_REQUIRED_FIELD (deployed dev 1988831880511062018, code_node_AeSdXE85) run in-process on the strings GOODS_DELIVERY
// passes it (code_node_EIDz5y7I's data + required_fields); its body verbatim, the two tokens as arguments
const gsRequired = function gsRequired(entryText, requiredText) {
const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue, subField)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const entry = JSON.parse(entryText);
const requiredFields = JSON.parse(requiredText);
const missingFields = validateForm(entry, requiredFields);

if(missingFields.length === 0){
  return {
    status: 'Passed',
    message: ''
  }
} else {
  return {
    status: 'Failed',
    message: 'Validation Error: ' + missingFields.join(', ')
  }
}
};
