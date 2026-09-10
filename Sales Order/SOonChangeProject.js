// SOonChangeProject — push the header Project down onto the Sales Order lines.
//
// Wired to two events: the header Project's onChange, and table_so's onRowAdd.
// A blank line always takes the header's project. A line that already carries a
// DIFFERENT project is left alone unless the user asks to overwrite it — a line is
// allowed to sit on a project of its own, independently of the header.

(async () => {
  const isBlank = (value) =>
    value === null || value === undefined || value === "";

  const projectId = this.getValue("project_id");

  // Clearing the header must not wipe projects already entered on the lines.
  if (isBlank(projectId)) return;

  const rows = this.getValue("table_so") || [];
  if (rows.length === 0) return;

  // One setData for the whole cascade rather than one write per row.
  const applyTo = async (indexes) => {
    if (indexes.length === 0) return;

    const updates = {};

    for (const index of indexes) {
      updates[`table_so.${index}.project_id`] = projectId;
    }

    await this.setData(updates);
  };

  // onRowAdd hands over the new row's index. Seed just that row and never
  // prompt — adding a row is not a decision about the rows already there.
  const addedRowIndex = arguments[0]?.rowIndex;

  if (addedRowIndex !== undefined && addedRowIndex !== null) {
    if (isBlank(rows[addedRowIndex]?.project_id)) {
      await applyTo([addedRowIndex]);
    }

    return;
  }

  const blanks = [];
  const conflicts = [];

  rows.forEach((row, index) => {
    if (isBlank(row.project_id)) {
      blanks.push(index);
    } else if (String(row.project_id) !== String(projectId)) {
      conflicts.push(index);
    }
  });

  if (conflicts.length === 0) {
    await applyTo(blanks);
    return;
  }

  await this.$confirm(
    `${conflicts.length} line item(s) already have a different project. Please choose one: <br><br>
        <strong>Overwrite:</strong> Apply the header project to every line.<br>
        <strong>Keep:</strong> Only fill the lines that have no project yet.`,
    "Project Change Detected",
    {
      confirmButtonText: "Overwrite",
      cancelButtonText: "Keep",
      dangerouslyUseHTMLString: true,
      type: "info",
    },
  )
    .then(() => applyTo([...blanks, ...conflicts]))
    .catch(() => applyTo(blanks));
})();
