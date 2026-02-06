if (saveAs !== "Cancelled") {
  if (saveAs === "Draft") {
    if (
      allData.delivery_no_type !== -9999 &&
      (!allData.delivery_no ||
        allData.delivery_no === null ||
        allData.delivery_no === "")
    ) {
      allData.delivery_no = "draft";
    }
  } else {
    if (
      allData.delivery_no_type !== -9999 &&
      (!allData.delivery_no ||
        allData.delivery_no === null ||
        allData.delivery_no === "" ||
        allData.gd_status !== "Created" ||
        allData.gd_status !== "Cancelled")
    ) {
      allData.delivery_no = "issued";
    }
  }
}
