package ru.arhilab.estimate;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Additive local estimate representation; original project fields remain for the 0.6.2 UI and backups. */
final class LocalEstimates {
    static String legacyId(String projectId) {
        return UUID.nameUUIDFromBytes(("arhilab:legacy-estimate:" + projectId).getBytes(StandardCharsets.UTF_8)).toString();
    }

    static String itemId(String projectId, String kind, JSONObject item, int index) {
        String id = item.optString("id");
        try { return UUID.fromString(id).toString(); }
        catch (IllegalArgumentException ignored) {
            return UUID.nameUUIDFromBytes(("arhilab:legacy-item:" + projectId + ":" + kind + ":" + index + ":" + id).getBytes(StandardCharsets.UTF_8)).toString();
        }
    }

    static void ensure(JSONObject project) throws Exception {
        String projectId = project.getString("id"), id = legacyId(projectId);
        JSONArray estimates = project.optJSONArray("estimates");
        if (estimates == null) { estimates = new JSONArray(); project.put("estimates",estimates); }
        project.put("legacyEstimateId",id);
        JSONObject legacy = null;
        for (int i=0; i<estimates.length(); i++) {
            JSONObject candidate = estimates.getJSONObject(i);
            if (candidate.optString("id").equals(id)) {
                if (legacy != null) throw new IllegalStateException("Duplicate legacy estimate");
                legacy = candidate;
            }
        }
        if (legacy == null) {
            legacy = new JSONObject().put("id",id).put("projectId",projectId).put("name","Исходная смета")
                .put("legacy",true).put("serverRevision",0);
            estimates.put(legacy);
        }
        // The established 0.6.2 editor still writes project fields; mirror them before the same encrypted save.
        for (String field : new String[]{"lines","materials","delivery","discount","materialMarkup","workMarkupPercent",
                "estimatePhotos","deliveryCost","overhead","otherCost","purchases"}) {
            if (project.has(field)) legacy.put(field,new JSONObject().put("value",project.get(field)).get("value"));
        }
        if (!legacy.has("lines")) legacy.put("lines",new JSONArray());
        if (!legacy.has("materials")) legacy.put("materials",new JSONArray());
        if (!legacy.has("delivery")) legacy.put("delivery",0);
        if (!legacy.has("discount")) legacy.put("discount",0);
        if (!legacy.has("workMarkupPercent")) legacy.put("workMarkupPercent","0");
        for (String kind : new String[]{"lines","materials"}) {
            JSONArray items = legacy.getJSONArray(kind);
            for (int i=0; i<items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                if (!item.has("syncId")) item.put("syncId",itemId(projectId,kind,item,i));
            }
        }
        for(int i=0;i<estimates.length();i++)F4Execution.ensure(estimates.getJSONObject(i));
    }
}
