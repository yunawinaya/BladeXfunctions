// Push the header Project down onto the BOM component lines, following the same
// rules as Sales Order (SOonChangeProject.js).
//
// A blank line always takes the header's project. A line carrying a DIFFERENT
// project is left alone unless the user asks to overwrite it — a component is
// allowed to sit on a project of its own, independently of the header.
//
// Bound to the header Project's onChange only. Unlike Sales Order there is no
// onRowAdd to wire: the components table is locked to the BOM, so rows only
// arrive via the explosion, which seeds project_id itself.

(async () => {
  const isBlank = (value) =>
    value === null || value === undefined || value === "";

  const projectId = this.getValue("project_id");

  // Clearing the header must not wipe projects already entered on the lines.
  if (isBlank(projectId)) return;

  const rows = this.getValue("stock_movement") || [];
  if (rows.length === 0) return;

  // One setData for the whole cascade rather than one write per row.
  const applyTo = async (indexes) => {
    if (indexes.length === 0) return;

    const updates = {};

    for (const index of indexes) {
      updates[`stock_movement.${index}.project_id`] = projectId;
    }

    await this.setData(updates);
  };

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
    `${conflicts.length} component line(s) already have a different project. Please choose one: <br><br>
        <strong>Overwrite:</strong> Apply the header project to every line.<br>
        <strong>Keep:</strong> Only fill the lines that have no project yet.`,
    "Project Change Detected",
    {
      confirmButtonText: "Overwrite",
      cancelButtonText: "Keep",
      dangerouslyUseHTMLString: true,
      type: "info",
    }
  )
    .then(() => applyTo([...blanks, ...conflicts]))
    .catch(() => applyTo(blanks));
})();
