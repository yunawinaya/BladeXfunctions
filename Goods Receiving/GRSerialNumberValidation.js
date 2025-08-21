const fieldParts = rule.field.split(".");
console.log("fieldParts", fieldParts);
const index = fieldParts[1];

const serialNumber = value;

if (!window.validationState) {
  window.validationState = {};
}

(async () => {
  console.log("serialNumber", serialNumber);
  if (serialNumber) {
    const { data } = await db
      .collection("serial_number")
      .where({ system_serial_number: serialNumber })
      .get();
    console.log("data", data);
    if (data.length > 0) {
      window.validationState[index] = false;
      callback("Serial number already exists");
      return;
    }
  }
  window.validationState[index] = true;
  callback();
})();
