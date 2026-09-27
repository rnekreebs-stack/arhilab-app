package ru.arhilab.estimate;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F1SyncLedgerTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
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
            .put("notes", new JSONArray()).put("photos", new JSONArray()).put("estimatePhotos", new JSONArray());
        JSONObject original = new JSONObject().put("schemaVersion", 3).put("users", new JSONArray())
            .put("projects", new JSONArray().put(project));
        JSONObject migrated = DataMigration.migrate(original);
        JSONObject upgraded = migrated.getJSONArray("projects").getJSONObject(0);
        JSONObject legacy = upgraded.getJSONArray("estimates").getJSONObject(0);
        check(legacy.getString("id").equals(LocalEstimates.legacyId(projectId)), "unstable legacy UUID");
        check(legacy.getDouble("delivery") == 75.2 && legacy.getDouble("discount") == 5.1, "lost financial fields");
        check(legacy.getString("workMarkupPercent").equals("0"), "legacy markup changed");
        check(legacy.getJSONArray("lines").getJSONObject(0).getDouble("cost") == 45, "lost legacy cost");
        check(legacy.getJSONArray("lines").getJSONObject(0).getString("syncId").equals(workId), "lost row identity");
        LocalEstimates.ensure(upgraded);
        check(upgraded.getJSONArray("estimates").length() == 1, "duplicate legacy estimate");

        F1SyncLedger.capture(migrated);
        JSONArray queue = migrated.getJSONObject("f1Sync").getJSONArray("operations");
        check(queue.length() == 4, "expected project, estimate, work and material");
        check(queue.getJSONObject(0).getString("entityType").equals("project"), "dependency ordering");
        check(queue.getJSONObject(1).getString("entityType").equals("estimate"), "dependency ordering");
        check(!queue.toString().contains("\"cost\""), "internal cost leaked to feed");
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
        System.out.println("PASS: local migration, delivery/discount, stable UUIDs, encrypted ledger projection, restart retry");
    }
}
