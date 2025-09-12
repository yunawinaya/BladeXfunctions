(async () => {
  const value = arguments[0].value;
  const rowIndex = arguments[0].rowIndex;
  const expectedQty = this.getValue(
    `table_srr.${rowIndex}.expected_return_qty`
  );

  if (value.length > expectedQty) {
    await this.$message.error(
      "Selected serial numbers exceed expected quantity."
    );
    await this.setData({
      [`table_srr.${rowIndex}.select_serial_number`]: value.slice(
        0,
        expectedQty
      ),
    });
    return;
  }

  console.log("value", value);
  console.log("rowIndex", rowIndex);
  if (value.length > 0) {
    await this.setData({
      [`table_srr.${rowIndex}.received_qty`]: value.length,
    });
  } else {
    await this.setData({
      [`table_srr.${rowIndex}.received_qty`]: 0,
    });
  }
})();
