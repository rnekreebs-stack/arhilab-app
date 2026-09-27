package ru.arhilab.estimate;

import org.json.JSONArray;
import org.json.JSONObject;

/** Applies a Stage 3/4 change to the encrypted local model without replacing legacy-only fields. */
final class F1SyncMerge {
    private F1SyncMerge() {}

    private static JSONObject find(JSONArray rows, String id) throws Exception {
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (id.equals(row.optString("id"))) return row;
        }
        return null;
    }

    private static void remove(JSONArray rows, String id) throws Exception {
        for (int i = 0; i < rows.length(); i++)
            if (id.equals(rows.getJSONObject(i).optString("id"))) { rows.remove(i); return; }
    }

    static void apply(JSONObject db, JSONObject change) throws Exception {
        String type = change.getString("entityType"), id = change.getString("entityId");
        if (!type.equals("project") && !type.equals("estimate") && !type.equals("estimateItem") && !type.equals("payment")) return;
        JSONObject sync = F1SyncLedger.state(db);
        String key = type + ":" + id;
        JSONArray jobs = sync.getJSONArray("operations");
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject job = jobs.getJSONObject(i);
            if (job.getString("entityId").equals(id) && job.getString("entityType").equals(type))
                return; // Retain the local proposal. Conflict resolution remains explicit.
        }
        JSONObject snapshot = change.getJSONObject("snapshot");
        boolean deleted = !snapshot.isNull("deletedAt") && snapshot.has("deletedAt");
        JSONArray projects = db.getJSONArray("projects");
        if (type.equals("project")) {
            if (deleted) throw new IllegalStateException("Удалённый объект требует ручного решения перед локальным удалением");
            JSONObject p = find(projects, id);
            if (p == null) {
                p = new JSONObject().put("id", id).put("materialMarkup", 8).put("workMarkupPercent", "0");
                for (String field : new String[]{"lines","materials","tasks","payments","notes","photos","estimatePhotos"})
                    p.put(field, new JSONArray());
                projects.put(p);
            }
            p.put("name", snapshot.getString("name"))
                .put("address", snapshot.optString("address", ""))
                .put("client", snapshot.optString("client", ""))
                .put("status", snapshot.optString("status", "Новый"));
            LocalEstimates.ensure(p);
        } else if (type.equals("estimate")) {
            JSONObject p = find(projects, snapshot.getString("projectId"));
            if (p == null) throw new IllegalStateException("Отсутствует объект сметы");
            LocalEstimates.ensure(p);
            boolean legacy = id.equals(LocalEstimates.legacyId(p.getString("id")));
            if (deleted) {
                if (legacy) throw new IllegalStateException("Исходную смету нельзя удалить без переноса локальных данных");
                remove(p.getJSONArray("estimates"), id);
            } else {
                JSONObject e = find(p.getJSONArray("estimates"), id);
                if (e == null) {
                    e = new JSONObject().put("id", id).put("projectId", p.getString("id"))
                        .put("legacy", legacy).put("lines", new JSONArray()).put("materials", new JSONArray());
                    p.getJSONArray("estimates").put(e);
                }
                e.put("name", snapshot.getString("name"))
                    .put("workMarkupPercent", snapshot.optString("workMarkupPercent", "0"))
                    .put("delivery", snapshot.optString("delivery", "0"))
                    .put("discount", snapshot.optString("discount", "0"))
                    .put("serverRevision", change.getInt("revision"));
                if (!snapshot.isNull("currency") && snapshot.has("currency")) e.put("currency", snapshot.getString("currency"));
                JSONObject privateData = snapshot.optJSONObject("privateData");
                if (privateData != null) {
                    if (privateData.optBoolean("incompleteLegacy")) sync.put("missingPrivateLegacy", true);
                    for (String field : new String[]{"materialMarkup", "deliveryCost", "overhead", "otherCost"})
                        if (privateData.has(field)) e.put(field, privateData.get(field));
                }
                if (legacy) {
                    p.put("workMarkupPercent", e.get("workMarkupPercent"))
                        .put("delivery", e.get("delivery")).put("discount", e.get("discount"));
                    if (privateData != null) for (String field : new String[]{"materialMarkup", "deliveryCost", "overhead", "otherCost"})
                        if (privateData.has(field)) p.put(field, privateData.get(field));
                    LocalEstimates.ensure(p);
                }
            }
        } else if (type.equals("payment")) {
            JSONObject p = find(projects, snapshot.getString("projectId"));
            if (p == null) throw new IllegalStateException("Отсутствует объект платежа");
            JSONArray payments = p.getJSONArray("payments");
            if (deleted) remove(payments, id);
            else {
                JSONObject payment = find(payments, id);
                if (payment == null) {payment = new JSONObject().put("id", id);payments.put(payment);}
                payment.put("amount", snapshot.get("amount"))
                    .put("paid", snapshot.isNull("paidAmount") ? snapshot.get("amount") : snapshot.get("paidAmount"))
                    .put("currency", snapshot.getString("currency"))
                    .put("date", snapshot.optString("businessDate", ""))
                    .put("note", snapshot.optString("comment", ""))
                    .put("type", snapshot.optString("paymentType", ""));
                if(!snapshot.isNull("kind")&&snapshot.has("kind"))payment.put("kind",snapshot.getString("kind"));
                for (String field : new String[]{"estimateId", "planDate", "actualDate"})
                    if (snapshot.has(field) && !snapshot.isNull(field)) payment.put(field, snapshot.get(field));
                    else payment.remove(field);
            }
        } else {
            String estimateId = snapshot.getString("estimateId");
            JSONObject owner = null, estimate = null;
            for (int i = 0; i < projects.length(); i++) {
                JSONObject p = projects.getJSONObject(i);
                JSONArray candidates = p.optJSONArray("estimates");
                if (candidates == null) continue;
                JSONObject candidate = find(candidates, estimateId);
                if (candidate != null) { owner = p; estimate = candidate; break; }
            }
            if (estimate == null || owner == null) throw new IllegalStateException("Отсутствует смета строки");
            String kind = snapshot.getString("kind");
            if (!kind.equals("work") && !kind.equals("material")) throw new IllegalArgumentException("Неизвестный вид строки");
            boolean legacy = estimate.optBoolean("legacy");
            JSONArray rows = (legacy ? owner : estimate).getJSONArray(kind.equals("work") ? "lines" : "materials");
            if (deleted) remove(rows, id);
            else {
                JSONObject item = find(rows, id);
                if (item == null) {
                    if (snapshot.optJSONObject("privateData") == null)
                        sync.put("missingPrivateLegacy", true);
                    item = new JSONObject().put("id", id); rows.put(item);
                }
                item.put("syncId", id).put("name", snapshot.getString("title"))
                    .put("qty", snapshot.get("quantity")).put("price", snapshot.get("price"))
                    .put("unit", snapshot.optString("unit", ""));
                if (kind.equals("work")) {
                    item.put("coef", snapshot.optString("coefficient", "1"))
                        .put("autoMaterial", snapshot.optBoolean("autoMaterial"))
                        .put("materialPrice", snapshot.optString("materialPrice", "0"))
                        .put("extra", snapshot.optBoolean("extra"))
                        .put("extraStatus", snapshot.optString("extraStatus", ""));
                }
                if (!snapshot.isNull("catalogKey") && snapshot.has("catalogKey"))
                    item.put("key", snapshot.getString("catalogKey"));
                JSONObject privateData = snapshot.optJSONObject("privateData");
                if (privateData != null) {
                    for (String field : new String[]{"cost", "materialCost", "materialTier", "materialNote", "materials", "kitOverrides"})
                        if (privateData.has(field)) item.put(field, privateData.get(field));
                }
            }
            if (legacy) LocalEstimates.ensure(owner);
        }
        sync.getJSONObject("revisions").put(key, change.getInt("revision"));
        JSONObject projected = F1SyncLedger.projection(db);
        if (projected.has(key)) sync.getJSONObject("shadow").put(key, projected.getJSONObject(key));
        else sync.getJSONObject("shadow").remove(key);
    }
}
