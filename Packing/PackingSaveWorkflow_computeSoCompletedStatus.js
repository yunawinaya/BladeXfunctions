// Save As Completed branch — SO status check (code-node).
// Decides whether SO.packing_status should flip to "Completed".
//
// Rule: every sibling GD under the same SO must have packing_status === "Completed".
//   - The current GD (entry.gd_id) counts as "will be Completed" after this run.
//   - Cancelled GDs are skipped (treated as done for this check).
//   - entry.so_id is assumed always present (per business rule).
//
// Place AFTER the "Process SO Created Status" code-node and AFTER a search-node
// that fetches sibling GDs: goods_delivery WHERE so_id == entry.so_id.
//
// Output consumed by a following IF node: if shouldFlipToCompleted === 1, the
// Update SO header + Update SO Line nodes fire; otherwise skip.
//
// Replace {{...}} placeholders with your actual node refs:
//   {{workflowparams:entry}}                          — workflow input
//   {{node:search_node_SIBLING_GDS.data.data}}        — GD siblings search-node

const entry = {{workflowparams:entry}};
const siblings = {{node:search_node_SIBLING_GDS.data.data}} || [];

const thisGdId = entry.gd_id;

const stillOpen = siblings.filter((gd) => {
  // Skip cancelled GDs — they don't block the SO from completing
  if (gd.gd_status === "Cancelled") return false;
  // The current GD is about to become Completed — treat as done
  if (String(gd.id) === String(thisGdId)) return false;
  // Anything else must already be Completed to pass the check
  return gd.packing_status !== "Completed";
});

const shouldFlipToCompleted = stillOpen.length === 0 ? 1 : 0;

return {
  shouldFlipToCompleted,
  pendingSiblingCount: stillOpen.length,
};
