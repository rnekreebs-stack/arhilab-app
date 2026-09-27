package ru.arhilab.estimate;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F1SyncLedgerTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        boolean rejected = false;
        try { new F1SyncTransport("http://example.org"); }
        catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "server credentials could be sent without TLS");
        String projectId = UUID.randomUUID().toString(), workId = UUID.randomUUID().toString();
        JSONObject work = new JSONObject().put("id", workId).put("name", "Работа")
            .put("price", 100).put("cost", 45).put("qty", 2).put("coef", 1.5)
            .put("autoMaterial", true).put("materialPrice", 20);
        JSONObject material = new JSONObject().put("id", UUID.randomUUID().toString())
            .put("name", "Материал").put("price", 30).put("qty", 2);
        JSONObject project = new JSONObject().put("id", projectId).put("name", "Объект")
            .put("lines", new JSONArray().put(work)).put("materials", new JSONArray().put(material))
            .put("delivery", 75.2).put("discount", 5.1).put("workMarkupPercent", "0")
            .put("materialMarkup", 8).put("tasks", new JSONArray()).put("payments", new JSONArray())
            .put("notes", new JSONArray().put(new JSONObject().put("text", "Legacy-only note")))
            .put("photos", new JSONArray()).put("estimatePhotos", new JSONArray());
        JSONObject original = new JSONObject().put("schemaVersion", 3).put("users", new JSONArray())
            .put("projects", new JSONArray().put(project));
        JSONObject migrated = DataMigration.migrate(original);
        JSONObject upgraded = migrated.getJSONArray("projects").getJSONObject(0);
        JSONObject legacy = upgraded.getJSONArray("estimates").getJSONObject(0);
        check(legacy.getString("id").equals(LocalEstimates.legacyId(projectId)), "unstable legacy UUID");
        check(legacy.getDouble("delivery") == 75.2 && legacy.getDouble("discount") == 5.1, "lost financial fields");
        check(legacy.getString("workMarkupPercent").equals("0"), "legacy markup changed");
        check(legacy.getJSONArray("lines").getJSONObject(0).getDouble("cost") == 45, "lost legacy cost");
        check(F1SyncLedger.hasPrivateLegacy(migrated), "private legacy fields must be visibly incomplete on sync");
        check(legacy.getJSONArray("lines").getJSONObject(0).getString("syncId").equals(workId), "lost row identity");
        if (args.length > 1) {
            JSONObject moneyFixture = new JSONObject().put("before", original.getJSONArray("projects").getJSONObject(0))
                .put("after", legacy);
            java.nio.file.Files.write(java.nio.file.Paths.get(args[1]),
                moneyFixture.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        LocalEstimates.ensure(upgraded);
        check(upgraded.getJSONArray("estimates").length() == 1, "duplicate legacy estimate");

        F1SyncLedger.capture(migrated);
        JSONArray queue = migrated.getJSONObject("f1Sync").getJSONArray("operations");
        check(queue.length() == 4, "expected project, estimate, work and material");
        check(queue.getJSONObject(0).getString("entityType").equals("project"), "dependency ordering");
        check(queue.getJSONObject(1).getString("entityType").equals("estimate"), "dependency ordering");
        check(!queue.getJSONObject(3).getJSONObject("payload").has("cost"), "cost escaped admin-only projection");
        if (args.length > 0) {
            JSONArray clientOps = new JSONArray();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject operation = new JSONObject(queue.getJSONObject(i).toString());
                operation.remove("state");
                clientOps.put(operation);
            }
            java.nio.file.Files.write(java.nio.file.Paths.get(args[0]),
                new JSONObject().put("operations", clientOps).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        String serialized = migrated.toString();
        JSONObject restarted = new JSONObject(serialized);
        LocalEstimates.ensure(restarted.getJSONArray("projects").getJSONObject(0));
        F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length() == 4, "retry changed operation identity");
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(0)
            .getString("idempotencyKey").equals(queue.getJSONObject(0).getString("idempotencyKey")), "lost idempotency key");

        JSONObject second = new JSONObject().put("id", UUID.randomUUID().toString()).put("projectId", projectId)
            .put("name", "Смета 2").put("workMarkupPercent", "0")
            .put("delivery", 0).put("discount", 0).put("lines", new JSONArray())
            .put("materials", new JSONArray());
        restarted.getJSONArray("projects").getJSONObject(0).getJSONArray("estimates").put(second);
        F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length() == 5, "new estimate not queued");
        check(second.getInt("delivery") == 0 && second.getInt("discount") == 0, "new estimate inherited legacy charges");
        JSONArray pending = restarted.getJSONObject("f1Sync").getJSONArray("operations");
        String firstId = pending.getJSONObject(0).getString("operationId");
        F1SyncLedger.acknowledge(restarted, new JSONObject().put("operationId", firstId)
            .put("status", "duplicate").put("originalStatus", "applied").put("resultingRevision", 1));
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length() == 4, "lost response not acknowledged");
        check(restarted.getJSONObject("f1Sync").getJSONObject("revisions").getInt("project:" + projectId) == 1, "revision lost");
        restarted.getJSONArray("projects").getJSONObject(0).put("name", "Новый адрес");
        F1SyncLedger.capture(restarted);
        JSONArray updated = restarted.getJSONObject("f1Sync").getJSONArray("operations");
        JSONObject projectUpdate = updated.getJSONObject(updated.length() - 1);
        check(projectUpdate.getString("operationType").equals("update") && projectUpdate.getInt("baseRevision") == 1,
            "wrong revision after lost response retry");
        String conflictId = pending.getJSONObject(0).getString("operationId");
        F1SyncLedger.acknowledge(restarted, new JSONObject().put("operationId", conflictId)
            .put("status", "conflict").put("conflictId", UUID.randomUUID().toString()));
        check(restarted.getJSONObject("f1Sync").getJSONArray("conflicts").length() == 1, "conflict indicator hidden");
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(0)
            .getString("state").equals("conflict"), "local conflict proposal lost");
        second.getJSONArray("lines").put(new JSONObject().put("id", UUID.randomUUID().toString())
            .put("syncId", UUID.randomUUID().toString()).put("name", "Новая работа")
            .put("price", "1.001").put("qty", 1).put("coef", 1));
        int countBefore = updated.length();
        F1SyncLedger.capture(restarted);
        check(updated.length() == countBefore, "historical price silently rounded");
        check(restarted.getJSONObject("f1Sync").getString("syncState").equals("error"), "unsupported precision hidden");
        JSONObject deviceB = new JSONObject().put("schemaVersion", 4).put("users", new JSONArray()).put("projects", new JSONArray());
        JSONObject projected = F1SyncLedger.projection(migrated);
        for (int i = 0; i < queue.length(); i++) {
            JSONObject operation = queue.getJSONObject(i);
            String key = operation.getString("entityType") + ":" + operation.getString("entityId");
            F1SyncMerge.apply(deviceB, new JSONObject().put("entityType", operation.getString("entityType"))
                .put("entityId", operation.getString("entityId"))
                .put("revision", 1).put("snapshot", new JSONObject(projected.getJSONObject(key).toString()).put("deletedAt", JSONObject.NULL)));
        }
        JSONObject copied = deviceB.getJSONArray("projects").getJSONObject(0);
        check(F1SyncLedger.hasPrivateLegacy(deviceB), "second device must flag incomplete legacy transfer");
        check(copied.getJSONArray("lines").getJSONObject(0).getDouble("cost") == 45, "admin private cost not restored");
        check(copied.getJSONArray("estimates").length() == 1, "second device duplicate legacy estimate");
        check(copied.getJSONArray("lines").length() == 1 && copied.getJSONArray("materials").length() == 1, "second device rows missing");
        check(copied.getDouble("delivery") == 75.2 && copied.getDouble("discount") == 5.1, "second device total inputs differ");
        JSONObject reopenedB = new JSONObject(deviceB.toString());
        F1SyncLedger.capture(reopenedB);
        check(reopenedB.getJSONObject("f1Sync").getJSONArray("operations").length() == 0, "pull generated duplicate outbound jobs");
        System.out.println("PASS: local migration, delivery/discount, stable UUIDs, encrypted ledger projection, restart retry");
    }
}
