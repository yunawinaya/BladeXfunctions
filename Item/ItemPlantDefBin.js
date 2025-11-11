(async () => {
  const plantId = arguments[0].value;
  const rowIndex = arguments[0].rowIndex;

  if (plantId) {
    await this.disabled(
      [`table_default_bin.${rowIndex}.storage_location`],
      false
    );
  }
})();
