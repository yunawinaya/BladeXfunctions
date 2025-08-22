(async () => {
  setTimeout(async () => {
    const tableSM = await this.getValue("stock_movement");
    const movementType = await this.getValue("movement_type");
    console.log("tableSM", tableSM);
    tableSM.forEach((sm, index) => {
      if (
        movementType === "Miscellaneous Receipt" &&
        sm.is_serialized_item === 1
      ) {
        this.disabled(`stock_movement.${index}.select_serial_number`, false);
        this.disabled(`stock_movement.${index}.received_quantity`, true);
      } else {
        this.disabled(`stock_movement.${index}.select_serial_number`, true);
        this.disabled(`stock_movement.${index}.received_quantity`, false);
      }
    });
  }, 100);
})();
