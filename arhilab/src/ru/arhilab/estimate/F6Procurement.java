package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Confirmed material requests and independent partial delivery events. No monetary values. */
final class F6Procurement {
    private F6Procurement() {}

    static void ensure(JSONObject project) throws Exception {
        if(project.optJSONArray("procurementRequests")==null)project.put("procurementRequests",new JSONArray());
        if(project.optJSONArray("procurementReceipts")==null)project.put("procurementReceipts",new JSONArray());
    }
    static JSONObject find(JSONArray rows,String id)throws Exception {
        for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("id")))return rows.getJSONObject(i);
        throw new IllegalArgumentException("Запись снабжения не найдена");
    }
    static String quantity(Object value)throws Exception {
        BigDecimal n;
        try {n=new BigDecimal(String.valueOf(value));}catch(Exception bad){throw new IllegalArgumentException("Введите количество");}
        if(n.signum()<=0||n.scale()>4||n.precision()>18)throw new IllegalArgumentException("Количество должно быть положительным, до 4 знаков после запятой");
        return n.setScale(4).toPlainString();
    }
    static BigDecimal received(JSONObject project,String requestId)throws Exception {
        ensure(project);BigDecimal total=BigDecimal.ZERO;JSONArray rows=project.getJSONArray("procurementReceipts");
        for(int i=0;i<rows.length();i++){
            JSONObject r=rows.getJSONObject(i);
            if(requestId.equals(r.optString("requestId")))total=total.add(new BigDecimal(r.getString("quantity")));
        }
        return total;
    }
    private static void link(JSONObject request,String field,String value)throws Exception {
        if(value.isEmpty())request.remove(field);
        else {UUID.fromString(value);request.put(field,value);}
    }
    static JSONObject saveRequest(JSONObject project,JSONObject input,JSONObject catalog)throws Exception {
        ensure(project);JSONArray rows=project.getJSONArray("procurementRequests");
        String id=input.optString("id","");JSONObject request=id.isEmpty()?new JSONObject().put("id",UUID.randomUUID().toString()):find(rows,id);
        String title=input.optString("title",request.optString("title","")).trim();
        String unit=input.optString("unit",request.optString("unit","")).trim();
        if(title.isEmpty()||title.length()>250||unit.isEmpty()||unit.length()>50)throw new IllegalArgumentException("Укажите материал и единицу измерения");
        String sku=input.optString("catalogSku",request.optString("catalogSku",""));
        if(!sku.isEmpty()){
            boolean known=false;JSONArray materials=catalog.getJSONArray("materials");
            for(int i=0;i<materials.length();i++)if(sku.equals(materials.getJSONObject(i).optString("id")))known=true;
            if(!known)throw new IllegalArgumentException("SKU отсутствует в каталоге");
            if(!id.isEmpty()&&!sku.equals(request.optString("catalogSku")))throw new IllegalArgumentException("Материал заявки нельзя заменить");
        }
        String status=input.optString("status",request.optString("status","requested"));
        if(!status.matches("requested|ordered|partially_received|received|cancelled"))throw new IllegalArgumentException("Неизвестный статус заявки");
        String quantity=quantity(input.opt("requestedQuantity")!=null?input.opt("requestedQuantity"):request.get("requestedQuantity"));
        String date=input.optString("neededByDate",request.optString("neededByDate",""));
        if(!date.isEmpty())LocalDate.parse(date);
        String note=input.optString("note",request.optString("note",""));
        if(note.length()>1000)throw new IllegalArgumentException("Примечание слишком длинное");
        for(String field:new String[]{"estimateId","stageId","estimateItemId"}){
            String value=input.optString(field,request.optString(field,""));
            if(!id.isEmpty()&&!value.equals(request.optString(field,"")))throw new IllegalArgumentException("Связь заявки нельзя изменить");
            link(request,field,value);
        }
        String assignee=input.optString("assigneeId",request.optString("assigneeId",""));link(request,"assigneeId",assignee);
        if((request.has("stageId")||request.has("estimateItemId"))&&!request.has("estimateId"))throw new IllegalArgumentException("Сначала выберите смету");
        if(request.has("estimateId")){
            JSONObject estimate=F6Procurement.find(project.getJSONArray("estimates"),request.getString("estimateId"));
            if(request.has("stageId"))F6Procurement.find(estimate.getJSONArray("executionStages"),request.getString("stageId"));
            if(request.has("estimateItemId")){
                String itemId=request.getString("estimateItemId");boolean found=false;
                for(String kind:new String[]{"lines","materials"}){
                    JSONArray items=estimate.optJSONArray(kind);
                    if(items!=null)for(int i=0;i<items.length();i++)found|=itemId.equals(items.getJSONObject(i).optString("syncId"));
                }
                if(!found)throw new IllegalArgumentException("Строка не принадлежит смете");
            }
        }
        request.put("title",title).put("unit",unit).put("requestedQuantity",quantity)
            .put("status",status).put("neededByDate",date).put("note",note);
        if(sku.isEmpty())request.remove("catalogSku");else request.put("catalogSku",sku);
        if(id.isEmpty())rows.put(request);
        return request;
    }
    static JSONObject saveReceipt(JSONObject project,JSONObject input)throws Exception {
        ensure(project);JSONArray rows=project.getJSONArray("procurementReceipts");
        String id=input.optString("id","");JSONObject receipt=id.isEmpty()?new JSONObject().put("id",UUID.randomUUID().toString()):find(rows,id);
        String requestId=input.optString("requestId",receipt.optString("requestId",""));
        if(!id.isEmpty()&&!requestId.equals(receipt.getString("requestId")))throw new IllegalArgumentException("Приход нельзя перенести в другую заявку");
        JSONObject request=find(project.getJSONArray("procurementRequests"),requestId);
        if(request.optString("status").equals("cancelled"))throw new IllegalArgumentException("Заявка отменена");
        String quantity=quantity(input.opt("quantity")!=null?input.opt("quantity"):receipt.get("quantity"));
        String date=input.optString("businessDate",receipt.optString("businessDate",""));LocalDate.parse(date);
        String note=input.optString("note",receipt.optString("note",""));if(note.length()>1000)throw new IllegalArgumentException("Примечание слишком длинное");
        BigDecimal total=received(project,requestId);
        if(!id.isEmpty())total=total.subtract(new BigDecimal(receipt.getString("quantity")));
        if(total.add(new BigDecimal(quantity)).compareTo(new BigDecimal(request.getString("requestedQuantity")))>0)
            throw new IllegalArgumentException("Получено больше заявленного количества");
        receipt.put("requestId",requestId).put("quantity",quantity).put("businessDate",date).put("note",note);
        if(id.isEmpty())rows.put(receipt);
        return receipt;
    }
    static void delete(JSONObject project,String kind,String id)throws Exception {
        ensure(project);
        if(kind.equals("request")&&project.getJSONArray("procurementReceipts").length()>0){
            JSONArray receipts=project.getJSONArray("procurementReceipts");
            for(int i=0;i<receipts.length();i++)if(id.equals(receipts.getJSONObject(i).optString("requestId")))
                throw new IllegalArgumentException("Заявка содержит историю поставок");
        }
        JSONArray rows=project.getJSONArray(kind.equals("request")?"procurementRequests":"procurementReceipts");
        for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("id"))){rows.remove(i);return;}
        throw new IllegalArgumentException("Запись снабжения не найдена");
    }
}
