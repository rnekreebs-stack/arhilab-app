package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Projected F1 operations and the local business data live in the same encrypted data.enc commit. */
final class F1SyncLedger {
    private F1SyncLedger() {}

    private static String decimal(Object value, int scale) throws Exception {
        BigDecimal amount = new BigDecimal(String.valueOf(value == null || value == JSONObject.NULL ? 0 : value));
        if (amount.signum() < 0 || amount.scale() > scale || amount.precision() > 16 + scale)
            throw new IllegalArgumentException("Число не представимо в серверной схеме без изменения точности");
        return amount.setScale(scale).toPlainString();
    }

    static JSONObject state(JSONObject database) throws Exception {
        JSONObject state = database.optJSONObject("f1Sync");
        if (state == null) {
            state = new JSONObject().put("cursor", "0").put("shadow", new JSONObject())
                .put("revisions", new JSONObject()).put("operations", new JSONArray())
                .put("conflicts", new JSONArray()).put("syncState", "pending_changes");
            database.put("f1Sync", state);
        }
        return state;
    }

    static boolean hasPrivateLegacy(JSONObject database) throws Exception {
        JSONArray projects = database.getJSONArray("projects");
        for (int p = 0; p < projects.length(); p++) {
            JSONObject project = projects.getJSONObject(p);
            for (String field : new String[]{"assigned", "deliveryCost", "overhead", "otherCost"})
                if (project.has(field) && !project.optString(field).isEmpty() && !project.optString(field).equals("0")) return true;
            for (String field : new String[]{"tasks", "payments", "notes", "photos", "estimatePhotos"})
                if (project.optJSONArray(field) != null && project.getJSONArray(field).length() > 0) return true;
            JSONArray estimates = project.optJSONArray("estimates");
            if (estimates == null) continue;
            for (int e = 0; e < estimates.length(); e++) {
                JSONObject estimate = estimates.getJSONObject(e);
                if (estimate.has("purchases") || estimate.optInt("materialMarkup", 8) != 8) return true;
                for (String kind : new String[]{"lines", "materials"}) {
                    JSONArray rows = estimate.optJSONArray(kind);
                    if (rows == null) continue;
                    for (int i = 0; i < rows.length(); i++) {
                        JSONObject row = rows.getJSONObject(i);
                        for (String field : new String[]{"cost", "materialCost", "materialTier", "kitOverrides", "materialNote", "materials"})
                            if (row.has(field)) return true;
                    }
                }
            }
        }
        return false;
    }

    private static void row(JSONObject rows, String type, String id, JSONObject payload) throws Exception {
        if (!id.matches("[0-9a-fA-F-]{36}")) throw new IllegalArgumentException("Неверный UUID строки");
        rows.put(type + ":" + id, payload);
    }

    private static boolean equal(Object left, Object right) throws Exception {
        if (left instanceof JSONObject && right instanceof JSONObject) {
            JSONObject a = (JSONObject) left, b = (JSONObject) right;
            if (a.length() != b.length()) return false;
            for (Iterator<String> keys = a.keys(); keys.hasNext();) {
                String key = keys.next();
                if (!b.has(key) || !equal(a.get(key), b.get(key))) return false;
            }
            return true;
        }
        return left == null ? right == null : left.equals(right);
    }

    static JSONObject projection(JSONObject database) throws Exception {
        JSONObject rows = new JSONObject();
        JSONArray projects = database.getJSONArray("projects");
        for (int p = 0; p < projects.length(); p++) {
            JSONObject project = projects.getJSONObject(p);
            String projectId = project.getString("id");
            row(rows, "project", projectId, new JSONObject().put("name", project.getString("name"))
                .put("address", project.optString("address", ""))
                .put("client", project.optString("client", ""))
                .put("status", project.optString("status", "Новый")));
            JSONArray estimates = project.optJSONArray("estimates");
            if (estimates == null) continue;
            for (int e = 0; e < estimates.length(); e++) {
                JSONObject estimate = estimates.getJSONObject(e);
                String estimateId = estimate.getString("id");
                row(rows, "estimate", estimateId, new JSONObject()
                    .put("projectId", projectId).put("name", estimate.getString("name"))
                    .put("workMarkupPercent", decimal(estimate.opt("workMarkupPercent"), 2))
                    .put("delivery", decimal(estimate.opt("delivery"), 2))
                    .put("discount", decimal(estimate.opt("discount"), 2)));
                for (String kind : new String[]{"lines", "materials"}) {
                    JSONArray items = estimate.optJSONArray(kind);
                    if (items == null) continue;
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.getJSONObject(i);
                        JSONObject payload = new JSONObject().put("estimateId", estimateId)
                            .put("title", item.getString("name"))
                            .put("kind", kind.equals("lines") ? "work" : "material")
                            .put("quantity", decimal(item.opt("qty"), 4))
                            .put("price", decimal(item.opt("price"), 2))
                            .put("unit", item.optString("unit", ""));
                        if (kind.equals("lines")) {
                            payload.put("coefficient", decimal(item.opt("coef") == null ? 1 : item.opt("coef"), 4))
                                .put("autoMaterial", item.optBoolean("autoMaterial"))
                                .put("materialPrice", decimal(item.opt("materialPrice"), 2))
                                .put("extra", item.optBoolean("extra"));
                            if (item.optBoolean("extra")) payload.put("extraStatus", item.optString("extraStatus", "Создано"));
                        }
                        String catalogKey = item.optString("key", "");
                        if (!catalogKey.isEmpty()) payload.put("catalogKey", catalogKey);
                        row(rows, "estimateItem", item.getString("syncId"), payload);
                    }
                }
            }
        }
        return rows;
    }

    private static void enqueue(JSONArray operations, JSONObject revisions, String key, String operationType, JSONObject payload) throws Exception {
        String type = key.substring(0, key.indexOf(':'));
        String id = key.substring(type.length() + 1);
        int base = revisions.optInt(key, 0);
        for (int i = 0; i < operations.length(); i++) {
            JSONObject pending = operations.getJSONObject(i);
            if (pending.getString("entityType").equals(type) && pending.getString("entityId").equals(id)) base++;
        }
        String uuid = UUID.randomUUID().toString();
        operations.put(new JSONObject().put("operationId", uuid).put("idempotencyKey", uuid)
            .put("entityType", type).put("entityId", id)
            .put("operationType", operationType).put("baseRevision", base)
            .put("payload", new JSONObject(payload.toString()))
            .put("occurredAt", java.time.Instant.now().toString())
            .put("state", "pending"));
    }

    static void capture(JSONObject database) throws Exception {
        JSONObject state = state(database), rows;
        try { rows = projection(database); }
        catch (Exception problem) {
            // Never silently round historical values or reject the local save because the server has a narrower scale.
            state.put("syncState", "error").put("lastErrorCategory", "unsupported_legacy_precision");
            return;
        }
        JSONObject shadow = state.getJSONObject("shadow"), revisions = state.getJSONObject("revisions");
        JSONArray operations = state.getJSONArray("operations");
        ArrayList<String> changed = new ArrayList<>();
        for (Iterator<String> keys = rows.keys(); keys.hasNext();) changed.add(keys.next());
        // Store in foreign-key dependency order even though org.json does not promise insertion order.
        for (String type : new String[]{"project", "estimate", "estimateItem"}) {
            for (String key : changed) {
                if (!key.startsWith(type + ":")) continue;
                JSONObject payload = rows.getJSONObject(key);
                if (shadow.has(key) && equal(shadow.getJSONObject(key), payload)) continue;
                enqueue(operations, revisions, key, shadow.has(key) ? "update" : "create", payload);
                shadow.put(key, new JSONObject(payload.toString()));
            }
        }
        ArrayList<String> removed = new ArrayList<>();
        for (Iterator<String> keys = shadow.keys(); keys.hasNext();) {
            String key = keys.next();
            if (!rows.has(key)) removed.add(key);
        }
        for (String type : new String[]{"estimateItem", "estimate", "project"}) {
            for (String key : removed) {
                if (!key.startsWith(type + ":")) continue;
                enqueue(operations, revisions, key, "delete", new JSONObject());
                shadow.remove(key);
            }
        }
        state.put("syncState", operations.length() == 0 ? "idle" : "pending_changes").remove("lastErrorCategory");
    }

    static void acknowledge(JSONObject database, JSONObject result) throws Exception {
        JSONObject state = state(database), revisions = state.getJSONObject("revisions");
        JSONArray operations = state.getJSONArray("operations");
        for (int i = 0; i < operations.length(); i++) {
            JSONObject pending = operations.getJSONObject(i);
            if (!pending.getString("operationId").equals(result.optString("operationId"))) continue;
            String status = result.optString("status");
            if (status.equals("conflict") || status.equals("duplicate") && result.optString("originalStatus").equals("conflict")) {
                pending.put("state", "conflict").put("conflictId", result.optString("conflictId"));
                JSONArray conflicts = state.getJSONArray("conflicts");
                boolean present = false;
                for (int j = 0; j < conflicts.length(); j++)
                    if (conflicts.getString(j).equals(pending.getString("operationId"))) present = true;
                if (!present) conflicts.put(pending.getString("operationId"));
                state.put("syncState", "conflict");
            } else if (status.equals("applied") || status.equals("duplicate") && result.optString("originalStatus").equals("applied")) {
                String key = pending.getString("entityType") + ":" + pending.getString("entityId");
                revisions.put(key, result.getInt("resultingRevision"));
                operations.remove(i);
                if (operations.length() == 0) state.put("syncState", "idle");
            } else {
                pending.put("state", "failed");
                state.put("syncState", "error").put("lastErrorCategory", result.optString("errorClass", "server_rejected"));
            }
            return;
        }
        throw new IllegalArgumentException("Unknown operation result");
    }
}
