// `@ds/learning/server` — the server half (024-design §1): framework-free
// services over packages/db. The host (`apps/api/src/learning`) wires the
// database, the audit-attributed transaction, the 025 PointsEngine port, the
// 012 media signer and the in-process event bus.
export * from "./deps.js";
export * from "./repository.js";
export * from "./projector.js";
export * from "./admin.service.js";
export * from "./doctor.service.js";
