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
        JSONObject sync = database.optJSONObject("f1Sync");
        if (sync != null && sync.optBoolean("missingPrivateLegacy")) return true;
        JSONArray projects = database.getJSONArray("projects");
        for (int p = 0; p < projects.length(); p++) {
            JSONObject project = projects.getJSONObject(p);
            for (String field : new String[]{"assigned"})
                if (project.has(field) && !project.optString(field).isEmpty() && !project.optString(field).equals("0")) return true;
            for (String field : new String[]{"notes", "photos", "estimatePhotos"})
                if (project.optJSONArray(field) != null && project.getJSONArray(field).length() > 0) return true;
            JSONArray tasks=project.optJSONArray("tasks");
            if(tasks!=null)for(int i=0;i<tasks.length();i++){
                JSONObject task=tasks.getJSONObject(i);
                if(task.optInt("progress",0)!=0 || !task.optString("responsible","").isEmpty() ||
                   !task.optString("actualDate","").isEmpty() || task.optString("status","").equals("Приостановлено"))return true;
            }
            JSONArray payments=project.optJSONArray("payments");
            if(payments!=null)for(int i=0;i<payments.length();i++){
                JSONObject payment=payments.getJSONObject(i);
                if(!payment.optString("currency","").matches("[A-Z]{3}") ||
                   !payment.optString("kind","").matches("income|expense") ||
                   !payment.optString("date","").matches("\\d{4}-\\d{2}-\\d{2}"))return true;
            }
            JSONArray estimates = project.optJSONArray("estimates");
            if (estimates == null) continue;
            for (int e = 0; e < estimates.length(); e++) {
                JSONObject estimate = estimates.getJSONObject(e);
                if (estimate.has("purchases")) return true;
                for (String kind : new String[]{"lines", "materials"}) {
                    JSONArray rows = estimate.optJSONArray(kind);
                    if (rows == null) continue;
                    for (int i = 0; i < rows.length(); i++) {
                        JSONObject row = rows.getJSONObject(i);
                        for (String field : new String[]{"tiers", "category", "store", "brand"})
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
        boolean incompleteLegacy = hasPrivateLegacy(database);
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
                    .put("discount", decimal(estimate.opt("discount"), 2))
                    .put("currency", estimate.has("currency") ? estimate.getString("currency") : JSONObject.NULL)
                    .put("privateData", estimatePrivate(estimate, incompleteLegacy)));
                F4Execution.ensure(estimate);
                JSONArray stages=estimate.getJSONArray("executionStages");
                for(int i=0;i<stages.length();i++) {
                    JSONObject stage=stages.getJSONObject(i);
                    row(rows,"stage",stage.getString("id"),new JSONObject()
                        .put("projectId",projectId).put("estimateId",estimateId)
                        .put("name",stage.getString("name"))
                        .put("description",stage.optString("description",""))
                        .put("position",stage.optInt("position",i)));
                }
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
                        payload.put("privateData", itemPrivate(item));
                        payload.put("stageId",item.has("stageId")?item.getString("stageId"):JSONObject.NULL);
                        row(rows, "estimateItem", item.getString("syncId"), payload);
                    }
                }
                JSONArray progress=estimate.getJSONArray("progressEntries");
                for(int i=0;i<progress.length();i++) {
                    JSONObject entry=progress.getJSONObject(i);
                    row(rows,"progressEntry",entry.getString("id"),new JSONObject()
                        .put("projectId",projectId).put("estimateId",estimateId)
                        .put("estimateItemId",entry.getString("estimateItemId"))
                        .put("quantity",decimal(entry.get("quantity"),4))
                        .put("businessDate",entry.getString("businessDate"))
                        .put("note",entry.optString("note","")));
                }
            }
            JSONArray payments = project.optJSONArray("payments");
            JSONArray expenses = project.optJSONArray("expenses");
            if (expenses != null) for (int i=0; i<expenses.length(); i++) {
                JSONObject expense=expenses.getJSONObject(i);
                JSONObject payload=new JSONObject().put("projectId",projectId)
                    .put("estimateId",expense.has("estimateId") ? expense.getString("estimateId") : JSONObject.NULL)
                    .put("category",expense.getString("category"))
                    .put("amount",decimal(expense.get("amount"),2))
                    .put("currency",expense.getString("currency"))
                    .put("businessDate",expense.getString("date"))
                    .put("description",expense.getString("description"))
                    .put("note",expense.optString("note",""));
                row(rows,"expense",expense.getString("id"),payload);
            }
            if (payments != null) for (int i = 0; i < payments.length(); i++) {
                JSONObject payment = payments.getJSONObject(i);
                String currency = payment.optString("currency", "");
                if (!currency.matches("[A-Z]{3}") ||
                    !payment.optString("kind", "").matches("income|expense") ||
                    !payment.optString("date", "").matches("\\d{4}-\\d{2}-\\d{2}")) continue;
                JSONObject payload = new JSONObject().put("projectId", projectId)
                    .put("estimateId", payment.has("estimateId") ? payment.getString("estimateId") : JSONObject.NULL)
                    .put("amount", decimal(payment.get("amount"), 2))
                    .put("paidAmount", decimal(payment.has("paid") ? payment.get("paid") : payment.get("amount"), 2))
                    .put("currency", currency).put("kind", payment.getString("kind"))
                    .put("businessDate", payment.getString("date"))
                    .put("planDate", payment.optString("planDate", "").isEmpty() ? JSONObject.NULL : payment.getString("planDate"))
                    .put("actualDate", payment.optString("actualDate", "").isEmpty() ? JSONObject.NULL : payment.getString("actualDate"))
                    .put("comment", payment.optString("note", ""))
                    .put("paymentType", payment.optString("type", ""));
                if(payment.has("paidAt")&&!payment.isNull("paidAt"))payload.put("paidAt",payment.getString("paidAt"));
                row(rows, "payment", payment.getString("id"), payload);
            }
            JSONArray tasks=project.optJSONArray("tasks");
            if(tasks!=null)for(int i=0;i<tasks.length();i++){
                JSONObject task=tasks.getJSONObject(i);
                JSONObject payload=new JSONObject().put("projectId",projectId)
                    .put("title",task.getString("name"))
                    .put("description",task.optString("comment",""))
                    .put("status",task.optString("taskStatus",task.optBoolean("done")?"done":"open"))
                    .put("priority",task.optString("priority","normal"))
                    .put("dueDate",task.optString("planDate","").isEmpty()?JSONObject.NULL:task.getString("planDate"))
                    .put("assigneeId",task.optString("assigneeId","").isEmpty()?JSONObject.NULL:task.getString("assigneeId"))
                    .put("estimateId",task.optString("estimateId","").isEmpty()?JSONObject.NULL:task.getString("estimateId"))
                    .put("stageId",task.optString("stageId","").isEmpty()?JSONObject.NULL:task.getString("stageId"))
                    .put("estimateItemId",task.optString("estimateItemId","").isEmpty()?JSONObject.NULL:task.getString("estimateItemId"));
                row(rows,"task",task.getString("id"),payload);
            }
        }
        return rows;
    }

    private static JSONObject estimatePrivate(JSONObject estimate, boolean incompleteLegacy) throws Exception {
        JSONObject privateData = new JSONObject();
        if (incompleteLegacy) privateData.put("incompleteLegacy", true);
        if (estimate.has("materialMarkup")) privateData.put("materialMarkup", estimate.getInt("materialMarkup"));
        for (String field : new String[]{"deliveryCost", "overhead", "otherCost"})
            if (estimate.has(field)) privateData.put(field, decimal(estimate.get(field), 2));
        return privateData;
    }

    private static JSONObject itemPrivate(JSONObject item) throws Exception {
        JSONObject privateData = new JSONObject();
        for (String field : new String[]{"cost", "materialCost"})
            if (item.has(field)) privateData.put(field, decimal(item.get(field), 2));
        for (String field : new String[]{"materialTier", "materialNote"})
            if (item.has(field)) privateData.put(field, item.getString(field));
        JSONArray materials = item.optJSONArray("materials");
        if (materials != null) privateData.put("materials", new JSONArray(materials.toString()));
        JSONObject overrides = item.optJSONObject("kitOverrides");
        if (overrides != null) {
            JSONObject entries = new JSONObject();
            for (Iterator<String> keys = overrides.keys(); keys.hasNext();) {
                String key = keys.next();
                JSONObject old = overrides.getJSONObject(key);
                entries.put(key, new JSONObject().put("sku", old.getString("sku"))
                    .put("qty", decimal(old.get("qty"), 4)));
            }
            privateData.put("kitOverrides", entries);
        }
        return privateData;
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
        for (String type : new String[]{"project", "estimate", "stage", "estimateItem", "progressEntry", "payment", "expense", "task"}) {
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
        for (String type : new String[]{"task", "expense", "payment", "progressEntry", "estimateItem", "stage", "estimate", "project"}) {
            for (String key : removed) {
                if (!key.startsWith(type + ":")) continue;
                enqueue(operations, revisions, key, "delete", new JSONObject());
                shadow.remove(key);
            }
        }
        boolean needsCurrency = false;
        for (int p = 0; p < database.getJSONArray("projects").length(); p++) {
            JSONArray payments = database.getJSONArray("projects").getJSONObject(p).optJSONArray("payments");
            if (payments != null) for (int i = 0; i < payments.length(); i++)
                if (!payments.getJSONObject(i).optString("currency", "").matches("[A-Z]{3}")) needsCurrency = true;
        }
        state.put("paymentCurrencyRequired", needsCurrency)
            .put("syncState", needsCurrency ? "pending_changes" : operations.length() == 0 ? "idle" : "pending_changes")
            .remove("lastErrorCategory");
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
