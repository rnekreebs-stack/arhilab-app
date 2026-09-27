package ru.arhilab.estimate;

import org.json.JSONArray;
import org.json.JSONObject;

/** Applies approved catalogue prices to older on-device catalogue overrides. */
final class CatalogPriceUpdate {
    private CatalogPriceUpdate() {}

    static void requireQuotedPrice(JSONObject work, double price) throws Exception {
        if (work.optBoolean("requiresManualPrice") && (!Double.isFinite(price) || price <= 0))
            throw new Exception("Укажите согласованную цену работы больше нуля");
    }

    static JSONObject merge(JSONObject bundled, JSONObject cached) throws Exception {
        int edition = bundled.optInt("engineeringPriceEdition", 0);
        if (edition == 0 || cached.optInt("engineeringPriceEdition", 0) >= edition) return cached;
        JSONArray approved = bundled.getJSONArray("works");
        JSONArray works = cached.getJSONArray("works");
        for (int i = 0; i < approved.length(); i++) {
            JSONObject source = approved.getJSONObject(i);
            String id = source.getString("id");
            boolean newWork = id.startsWith("eng2026-");
            if (!newWork && !id.equals("218") && !id.equals("236") && !id.equals("237")) continue;
            int found = -1;
            for (int j = 0; j < works.length(); j++) {
                JSONObject candidate = works.getJSONObject(j);
                if (id.equals(candidate.optString("id")) || source.getString("key").equals(candidate.optString("key"))) {
                    if (!id.equals(candidate.optString("id")) || !source.getString("key").equals(candidate.optString("key")))
                        throw new Exception("Конфликт ID или состава обновляемой работы: " + id);
                    found = j;
                    break;
                }
            }
            if (found < 0) {
                if (!newWork) throw new Exception("Обновляемая работа отсутствует в сохранённом каталоге: " + id);
                works.put(new JSONObject(source.toString()));
            } else {
                JSONObject target = works.getJSONObject(found);
                target.put("price", source.getDouble("price"));
                if (source.has("searchAliases")) target.put("searchAliases", source.getString("searchAliases"));
                if (newWork) {
                    target.put("note", source.getString("note"));
                    if (source.optBoolean("requiresManualPrice")) target.put("requiresManualPrice", true);
                }
            }
        }
        cached.put("engineeringPriceEdition", edition);
        return cached;
    }
}
