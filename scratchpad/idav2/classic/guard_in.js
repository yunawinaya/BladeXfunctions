// IDA V2 guard: only an Edit reads the stored status (a Clone may carry the source id); the move cap applies to every page
const idaGuardIn = { allData: [{{workflowparams:allData}}][0], saveAs: [{{workflowparams:saveAs}}][0], pageStatus: [{{workflowparams:pageStatus}}][0],
  tenantId: [{{system:tenantId}}][0] };
let idaGuardDoc = idaGuardIn.allData;
if (typeof idaGuardDoc === "string") idaGuardDoc = idaParseJ(idaGuardDoc);
if (!idaGuardDoc || typeof idaGuardDoc !== "object" || Array.isArray(idaGuardDoc)) idaGuardDoc = {};
const idaGuardSaveAs = idaS(idaGuardIn.saveAs);
let idaGuardId = "";
let idaGuardTenant = "";
try {
  idaGuardId = idaIdStr(idaGuardDoc.id);
  idaGuardTenant = idaS(idaGuardIn.tenantId);
} catch (e) {
  idaGuardId = "";
}
const idaGuardCheck = idaS(idaGuardIn.pageStatus) === "Edit" && idaDigits(idaGuardId) && idaDigits(idaGuardTenant);
let idaGuardMoves = 0;
try {
  idaGuardMoves = idaMoveCount(idaGuardDoc, idaGuardDoc.stock_movement);
} catch (e) {
  idaGuardMoves = 0;
}
const idaGuardBig = idaGuardSaveAs !== "Draft" && idaGuardMoves > IDA_CLASSIC_MAX_MOVES;
return {
  check: idaGuardCheck ? "YES" : "NO",
  idaId: idaGuardCheck ? idaGuardId : "0",
  tenantId: idaGuardCheck ? idaGuardTenant : "0",
  saveAs: idaGuardSaveAs,
  moves: String(idaGuardMoves),
  big: idaGuardBig ? "YES" : "NO",
  bigNoRead: idaGuardBig && !idaGuardCheck ? "YES" : "NO",
  bigMessage: idaGuardBig ? IDA_TEXT.classicTooBig(idaGuardMoves, IDA_CLASSIC_MAX_MOVES) : "",
};
