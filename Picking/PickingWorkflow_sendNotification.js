// Prepare Notification Data - Workflow Code Node
// This node prepares notification data for the notification workflow
//
// NOTE: IDE linter errors are expected - {{}} is workflow template syntax
// that gets replaced at runtime by the workflow engine.
//
// WORKFLOW STRUCTURE AFTER THIS NODE:
// Use a loop-node or multiple workflow-nodes to send notifications
// to each user in the addedUsers and removedUsers arrays

const pickingResult = {{node:code_node_createOrUpdate.data}}; // Replace with actual node ID
const toNo = pickingResult.existingTONo || ""; // Will be populated after add-node creates the TO

// Prepare cancellation notifications for removed users
const cancellationNotifications = [];
if (pickingResult.removedUsers && pickingResult.removedUsers.length > 0) {
  pickingResult.removedUsers.forEach((userId) => {
    cancellationNotifications.push({
      title: "Picking Assignment Cancelled",
      body: `Your picking task for Transfer Order: ${toNo} has been cancelled.`,
      userId: [userId],
      data: {
        docId: toNo,
        deepLink: `sudumobileexpo://picking/batch/${toNo}`,
        action: "cancelled",
      },
    });
  });
}

// Prepare assignment notifications for added users
const assignmentNotifications = [];
if (pickingResult.addedUsers && pickingResult.addedUsers.length > 0) {
  pickingResult.addedUsers.forEach((userId) => {
    assignmentNotifications.push({
      title: "New Picking Assignment",
      body: `You have been assigned a picking task for Goods Delivery: ${pickingResult.deliveryNo}. Transfer Order: ${toNo}`,
      userId: [userId],
      data: {
        docId: toNo,
        deepLink: `sudumobileexpo://picking/batch/${toNo}`,
        action: "assigned",
      },
    });
  });
}

// Combined notifications for workflow-node or loop processing
const allNotifications = [...cancellationNotifications, ...assignmentNotifications];

return {
  cancellationNotifications,
  assignmentNotifications,
  allNotifications,
  totalNotifications: allNotifications.length,
  hasCancellations: cancellationNotifications.length > 0,
  hasAssignments: assignmentNotifications.length > 0,
};
