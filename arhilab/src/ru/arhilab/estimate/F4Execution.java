package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** F4 journal lives in the same AES-GCM local document as estimates and the durable outbox. */
final class F4Execution {
    private F4Execution() {}

    static void ensure(JSONObject estimate) throws Exception {
        if (!estimate.has("executionStages")) estimate.put("executionStages", new JSONArray());
        if (!estimate.has("progressEntries")) estimate.put("progressEntries", new JSONArray());
    }

    static JSONObject item(JSONObject estimate, String id) throws Exception {
        for (String kind : new String[]{"lines", "materials"}) {
            JSONArray rows = estimate.optJSONArray(kind);
            if (rows == null) continue;
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                if (id.equals(row.optString("syncId"))) {
                    if (!kind.equals("lines")) throw new IllegalArgumentException("Выполнение учитывается только для работы");
                    return row;
                }
            }
        }
        throw new IllegalArgumentException("Строка работы не найдена");
    }

    static JSONObject find(JSONArray rows, String id) throws Exception {
        for (int i=0; i<rows.length(); i++) if(id.equals(rows.getJSONObject(i).optString("id"))) return rows.getJSONObject(i);
        throw new IllegalArgumentException("Запись не найдена");
    }

    static BigDecimal quantity(Object value) {
        String text=String.valueOf(value);
        if (!text.matches("(?:0|[1-9][0-9]{0,13})(?:\\.[0-9]{1,4})?"))
            throw new IllegalArgumentException("Некорректный объём (до четырёх знаков после запятой)");
        BigDecimal number=new BigDecimal(text);
        if (number.signum()<=0) throw new IllegalArgumentException("Объём должен быть больше нуля");
        return number;
    }

    static BigDecimal completed(JSONObject estimate, String itemId, String excluding) throws Exception {
        BigDecimal total=BigDecimal.ZERO;
        JSONArray entries=estimate.getJSONArray("progressEntries");
        for (int i=0; i<entries.length(); i++) {
            JSONObject entry=entries.getJSONObject(i);
            if (itemId.equals(entry.optString("estimateItemId")) && !entry.optString("id").equals(excluding))
                total=total.add(quantity(entry.get("quantity")));
        }
        return total;
    }

    static void validateTotal(JSONObject estimate, String itemId, BigDecimal candidate, String excluding) throws Exception {
        BigDecimal planned=quantity(item(estimate,itemId).get("qty"));
        if (completed(estimate,itemId,excluding).add(candidate).compareTo(planned)>0)
            throw new IllegalArgumentException("Выполненный объём превышает объём сметы");
    }

    static JSONObject stage(JSONObject estimate, String id) throws Exception {
        return find(estimate.getJSONArray("executionStages"),id);
    }

    static JSONObject saveStage(JSONObject estimate, JSONObject input) throws Exception {
        ensure(estimate);
        String name=input.getString("name").trim(),description=input.optString("description","").trim();
        if(name.isEmpty()||name.length()>250||description.length()>1000)throw new IllegalArgumentException("Некорректное название этапа");
        String id=input.optString("id","");
        JSONObject row=id.isEmpty()?new JSONObject().put("id",UUID.randomUUID().toString()):stage(estimate,id);
        row.put("name",name).put("description",description)
            .put("position",input.has("position")?input.getInt("position"):
                row.optInt("position",estimate.getJSONArray("executionStages").length()));
        if(id.isEmpty())estimate.getJSONArray("executionStages").put(row);
        return row;
    }

    static void assign(JSONObject estimate, String itemId, String stageId) throws Exception {
        JSONObject row=item(estimate,itemId);
        if(stageId.isEmpty())row.remove("stageId");
        else {stage(estimate,stageId);row.put("stageId",stageId);}
    }

    static JSONObject saveEntry(JSONObject estimate, JSONObject input, String author) throws Exception {
        ensure(estimate);
        String id=input.optString("id","");
        JSONObject existing=id.isEmpty()?null:find(estimate.getJSONArray("progressEntries"),id);
        String itemId=existing==null?input.getString("estimateItemId"):existing.getString("estimateItemId");
        BigDecimal amount=quantity(input.getString("quantity"));
        String day=input.getString("businessDate");
        if(!LocalDate.parse(day).toString().equals(day))throw new IllegalArgumentException("Неверная дата выполнения");
        String note=input.optString("note","").trim();
        if(note.length()>1000)throw new IllegalArgumentException("Комментарий слишком длинный");
        if(existing==null||amount.compareTo(quantity(existing.get("quantity")))>0)
            validateTotal(estimate,itemId,amount,id);
        JSONObject entry=existing==null?new JSONObject().put("id",UUID.randomUUID().toString())
            .put("estimateItemId",itemId).put("createdBy",author)
            .put("historicalStageId",item(estimate,itemId).optString("stageId","")):existing;
        entry.put("quantity",amount.toPlainString()).put("businessDate",day).put("note",note);
        if(existing==null)estimate.getJSONArray("progressEntries").put(entry);
        return entry;
    }

    static void deleteEntry(JSONObject estimate, String id) throws Exception {
        JSONArray entries=estimate.getJSONArray("progressEntries");
        for(int i=0;i<entries.length();i++)if(id.equals(entries.getJSONObject(i).optString("id"))){entries.remove(i);return;}
        throw new IllegalArgumentException("Запись не найдена");
    }

    static void assertRemovable(JSONObject estimate, String itemId) throws Exception {
        JSONArray entries=estimate.optJSONArray("progressEntries");
        if(entries!=null)for(int i=0;i<entries.length();i++)
            if(itemId.equals(entries.getJSONObject(i).optString("estimateItemId")))
                throw new IllegalArgumentException("Работа имеет историю выполнения. Сначала явно исправьте журнал.");
    }

    static void deleteStage(JSONObject estimate, String id) throws Exception {
        JSONArray rows=estimate.getJSONArray("lines");
        for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("stageId")))
            throw new IllegalArgumentException("Сначала перенесите работы из этапа");
        JSONArray stages=estimate.getJSONArray("executionStages");
        for(int i=0;i<stages.length();i++)if(id.equals(stages.getJSONObject(i).optString("id"))){stages.remove(i);return;}
        throw new IllegalArgumentException("Этап не найден");
    }
}
