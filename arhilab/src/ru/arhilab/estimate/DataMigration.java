package ru.arhilab.estimate;

import org.json.JSONArray;
import org.json.JSONObject;

/** Changes to the encrypted local data format. Never discards unknown fields. */
final class DataMigration {
    static final int CURRENT = 6;

    static JSONObject migrate(JSONObject source) throws Exception {
        JSONObject data = new JSONObject(source.toString());
        int version = data.optInt("schemaVersion", 1);
        if (version < 1 || version > CURRENT) throw new Exception("Версия локальной базы не поддерживается: " + version);
        while (version < CURRENT) {
            if (version == 1) {
                JSONArray projects = data.getJSONArray("projects");
                data.getJSONArray("users");
                for (int i = 0; i < projects.length(); i++) {
                    JSONObject p = projects.getJSONObject(i);
                    for (String name : new String[]{"lines", "materials", "tasks", "payments", "notes", "photos", "estimatePhotos"})
                        if (!p.has(name)) p.put(name, new JSONArray());
                }
                version = 2;
                data.put("schemaVersion", version);
            }
            if (version == 2) {
                JSONArray projects = data.getJSONArray("projects");
                for (int i = 0; i < projects.length(); i++) {
                    JSONObject project = projects.getJSONObject(i);
                    if (!project.has("workMarkupPercent")) project.put("workMarkupPercent", "0");
                }
                version = 3;
                data.put("schemaVersion", version);
            }
            if (version == 3) {
                JSONArray projects = data.getJSONArray("projects");
                for (int i=0; i<projects.length(); i++) LocalEstimates.ensure(projects.getJSONObject(i));
                version = 4;
                data.put("schemaVersion",version);
            }
            if (version == 4) {
                JSONArray projects = data.getJSONArray("projects");
                for (int i=0; i<projects.length(); i++) {
                    JSONObject project = projects.getJSONObject(i);
                    if (!project.has("expenses")) project.put("expenses", new JSONArray());
                }
                version = 5;
                data.put("schemaVersion",version);
            }
            if (version == 5) {
                JSONArray projects=data.getJSONArray("projects");
                for(int i=0;i<projects.length();i++) {
                    JSONObject project=projects.getJSONObject(i);
                    LocalEstimates.ensure(project);
                    JSONArray estimates=project.getJSONArray("estimates");
                    for(int j=0;j<estimates.length();j++)F4Execution.ensure(estimates.getJSONObject(j));
                }
                version=6;
                data.put("schemaVersion",version);
            }
        }
        return data;
    }
}
