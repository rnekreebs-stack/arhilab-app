package ru.arhilab.estimate;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

/** Read-only checks: no check mutates or silently removes a record. */
final class DataIntegrity {
    static JSONObject check(JSONObject db, JSONObject catalog) throws Exception {
        JSONArray issues = new JSONArray();
        Set<String> skus = new HashSet<>(), ids = new HashSet<>();
        JSONArray ms = catalog.getJSONArray("materials");
        for (int i = 0; i < ms.length(); i++) skus.add(ms.getJSONObject(i).getString("id"));
        JSONArray ps = db.getJSONArray("projects");
        for (int i = 0; i < ps.length(); i++) {
            JSONObject p = ps.getJSONObject(i);
            String id = p.optString("id");
            if (id.isEmpty()) issues.put("Объект №" + (i+1) + ": отсутствует ID");
            else if (!ids.add(id)) issues.put("Повтор ID объекта: " + id);
            for (String arr : new String[]{"lines", "materials", "tasks", "payments"}) {
                JSONArray rows = p.optJSONArray(arr);
                if (rows == null) { issues.put("Объект " + id + ": нет раздела " + arr); continue; }
                Set<String> rowIds = new HashSet<>();
                for (int j = 0; j < rows.length(); j++) {
                    JSONObject row = rows.getJSONObject(j);
                    String rowId = row.optString("id");
                    if (rowId.isEmpty() || !rowIds.add(rowId)) issues.put(arr + " объекта " + id + ": отсутствует или повторяется ID, строка " + (j+1));
                    if (row.has("qty") && (!Double.isFinite(row.optDouble("qty", Double.NaN)) || row.optDouble("qty") <= 0)) issues.put(arr + ": некорректное количество, строка " + (j+1));
                    for (String k : new String[]{"amount", "cost", "price", "paid", "materialCost"})
                        if (row.has(k) && (!Double.isFinite(row.optDouble(k, Double.NaN)) || row.optDouble(k) < 0)) issues.put(arr + ": некорректная сумма " + k + ", строка " + (j+1));
                    if (arr.equals("materials")) {
                        String sku = row.optString("sku", row.optString("catalogId", row.optString("materialId")));
                        boolean known = sku.isEmpty() && !row.optString("name").isEmpty();
                        if (known) {
                            known = false;
                            for (int m = 0; m < ms.length(); m++) if (row.optString("name").equals(ms.getJSONObject(m).optString("name"))) {known = true; break;}
                        } else known = skus.contains(sku);
                        if (!known) issues.put("Материал объекта " + id + ": SKU не найден, строка " + (j+1));
                    }
                    if (row.has("project") && !id.equals(row.optString("project"))) issues.put(arr + ": ссылка на другой объект, строка " + (j+1));
                }
            }
            for (String arr : new String[]{"photos", "estimatePhotos"}) {
                JSONArray rows = p.optJSONArray(arr);
                if (rows == null) continue;
                for (int j = 0; j < rows.length(); j++) if (!rows.getJSONObject(j).has("id") && !rows.getJSONObject(j).has("data"))
                    issues.put("Фото объекта " + id + ": отсутствует ссылка, строка " + (j+1));
            }
        }
        return new JSONObject().put("schemaVersion", db.optInt("schemaVersion", 1)).put("projects", ps.length()).put("issues", issues);
    }
}
