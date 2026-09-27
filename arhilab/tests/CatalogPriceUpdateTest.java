package ru.arhilab.estimate;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.json.JSONArray;
import org.json.JSONObject;

public final class CatalogPriceUpdateTest {
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    private static JSONObject work(JSONArray works, String id) {
        for (int i = 0; i < works.length(); i++) if (id.equals(works.getJSONObject(i).getString("id"))) return works.getJSONObject(i);
        throw new AssertionError("Missing work: " + id);
    }
    public static void main(String[] args) throws Exception {
        JSONObject bundled = new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        JSONObject old = new JSONObject(bundled.toString());
        JSONArray works = new JSONArray();
        for (int i = 0; i < 371; i++) works.put(old.getJSONArray("works").getJSONObject(i));
        old.put("works", works);
        old.remove("engineeringPriceEdition");
        work(works, "218").put("price", 9000);
        work(works, "236").put("price", 900).put("cost", 777);
        work(works, "237").put("price", 12000);
        work(works, "234").put("price", 8100); // unrelated local catalogue edit
        JSONObject merged = CatalogPriceUpdate.merge(bundled, old);
        check(merged.getJSONArray("works").length() == 389, "new works missing");
        check(work(works, "236").getDouble("price") == 1680, "old catalogue override hid new price");
        check(work(works, "236").getDouble("cost") == 777, "changed existing internal cost");
        check(work(works, "234").getDouble("price") == 8100, "unrelated edit lost");
        check(work(works, "218").getString("searchAliases").equals("инсталляция"), "old override hid search alias");
        check(work(works, "223").getDouble("price") == 6500, "trap exception");
        check(work(works, "eng2026-010").optBoolean("requiresManualPrice"), "manual price flag missing");
        for (double invalid : new double[]{0, -1, Double.NaN, Double.POSITIVE_INFINITY}) {
            try {
                CatalogPriceUpdate.requireQuotedPrice(work(works, "eng2026-010"), invalid);
                throw new AssertionError("Manual price accepted: " + invalid);
            } catch (Exception expected) {
                check(expected.getMessage().contains("согласованную цену"), "incorrect quoted price error");
            }
        }
        CatalogPriceUpdate.requireQuotedPrice(work(works, "eng2026-010"), 30000);
        check(CatalogPriceUpdate.merge(bundled, merged).getJSONArray("works").length() == 389, "duplicate works on restart");
        JSONObject conflicting = new JSONObject(bundled.toString());
        conflicting.remove("engineeringPriceEdition");
        work(conflicting.getJSONArray("works"), "eng2026-001").put("key", "другая услуга");
        try {
            CatalogPriceUpdate.merge(bundled, conflicting);
            throw new AssertionError("ID collision accepted");
        } catch (Exception expected) {
            check(expected.getMessage().contains("Конфликт"), "incorrect collision failure");
        }
        System.out.println("PASS: cached catalogue upgrade, custom price/kit preservation, restart idempotency and ID collision");
    }
}
