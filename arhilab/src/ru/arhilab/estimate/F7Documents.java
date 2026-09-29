package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Client-only projection. Never serialize a project, estimate, item, or user wholesale. */
final class F7Documents {
    static final String[] TYPES={"COMMERCIAL_OFFER","DETAILED_ESTIMATE","SUMMARY_ESTIMATE"};
    static JSONArray list(JSONObject project)throws Exception {
        JSONArray result=project.optJSONArray("clientDocuments");
        if(result==null){result=new JSONArray();project.put("clientDocuments",result);}
        return result;
    }
    static JSONObject estimate(JSONObject project,String id)throws Exception {
        JSONArray all=project.getJSONArray("estimates");
        for(int i=0;i<all.length();i++)if(all.getJSONObject(i).getString("id").equals(id))
            return all.getJSONObject(i).optBoolean("legacy")?project:all.getJSONObject(i);
        throw new IllegalArgumentException("Смета не принадлежит объекту");
    }
    static JSONObject document(JSONObject project,String id)throws Exception {
        JSONArray docs=list(project);for(int i=0;i<docs.length();i++)if(docs.getJSONObject(i).getString("id").equals(id))return docs.getJSONObject(i);
        throw new IllegalArgumentException("Документ не найден");
    }
    static BigDecimal dec(JSONObject obj,String key, String fallback)throws Exception {
        BigDecimal n=new BigDecimal(obj.optString(key,fallback));
        if(n.signum()<0||n.compareTo(new BigDecimal("1000000000000"))>0)throw new IllegalArgumentException("Некорректная цена или количество");
        return n;
    }
    static BigDecimal cents(BigDecimal n){return n.setScale(2,RoundingMode.HALF_UP);}
    static JSONObject row(JSONObject item,String kind)throws Exception {
        BigDecimal qty=dec(item,"qty","0"),coef=kind.equals("work")?dec(item,"coef","1"):BigDecimal.ONE;
        BigDecimal price=dec(item,"price","0");
        return new JSONObject().put("title",item.optString("name")).put("section",item.optString("category","Общие работы"))
            .put("kind",kind).put("unit",item.optString("unit","шт."))
            .put("quantity",qty.toPlainString()).put("coefficient",coef.toPlainString())
            .put("unitPrice",cents(price).toPlainString()).put("total",cents(price.multiply(qty).multiply(coef)).toPlainString());
    }
    static JSONObject project(JSONObject project,String estimateId,String type,JSONObject settings)throws Exception {
        boolean known=false;for(String t:TYPES)if(t.equals(type))known=true;
        if(!known)throw new IllegalArgumentException("Тип документа неизвестен");
        JSONObject estimate=estimate(project,estimateId);
        if(estimate.has("currency")&&!estimate.isNull("currency")&&!estimate.optString("currency").isEmpty()&&!estimate.optString("currency").equals("RUB"))
            throw new IllegalArgumentException("Документ доступен только для сметы в рублях без скрытой конвертации");
        String mode=settings.optString("materials","detailed");
        if(!mode.equals("hidden")&&!mode.equals("subtotal")&&!mode.equals("detailed"))throw new IllegalArgumentException("Режим материалов неизвестен");
        boolean showPrices=settings.optBoolean("showMaterialPrices",true);
        JSONArray works=new JSONArray(),materials=new JSONArray(),lines=estimate.optJSONArray("lines");
        if(lines!=null)for(int i=0;i<lines.length();i++){
            JSONObject l=lines.getJSONObject(i);
            if(l.optBoolean("extra")&&!java.util.Arrays.asList("Согласовано","Выполняется","Выполнено","Оплачено").contains(l.optString("extraStatus")))continue;
            works.put(row(l,"work"));
            if(l.optBoolean("autoMaterial")){
                JSONObject m=new JSONObject().put("name","Комплект материалов: "+l.optString("name")+" — "+l.optJSONArray("materials"))
                    .put("category",l.optString("category","Материалы"))
                    .put("unit",l.optString("unit","шт.")).put("qty",l.opt("qty"))
                    .put("price",l.opt("materialPrice"));
                materials.put(row(m,"material"));
            }
        }
        JSONArray manual=estimate.optJSONArray("materials");
        if(manual!=null)for(int i=0;i<manual.length();i++)materials.put(row(manual.getJSONObject(i),"material"));
        BigDecimal work=BigDecimal.ZERO,mat=BigDecimal.ZERO;
        for(int i=0;i<works.length();i++)work=work.add(new BigDecimal(works.getJSONObject(i).getString("total")));
        for(int i=0;i<materials.length();i++)mat=mat.add(new BigDecimal(materials.getJSONObject(i).getString("total")));
        BigDecimal markup=dec(estimate,"workMarkupPercent","0");
        if(markup.compareTo(new BigDecimal("100"))>0)throw new IllegalArgumentException("Наценка больше 100%");
        BigDecimal markupAmount=cents(work.multiply(markup).divide(new BigDecimal("100"),8,RoundingMode.HALF_UP));
        BigDecimal delivery=cents(dec(estimate,"delivery","0")),discount=cents(dec(estimate,"discount","0"));
        BigDecimal total=cents(work.add(markupAmount).add(mat).add(delivery).subtract(discount));
        JSONObject options=new JSONObject().put("materials",mode).put("showMaterialPrices",showPrices)
            .put("showSections",settings.optBoolean("showSections",true));
        for(String field:new String[]{"paymentTerms","timeline","warranty","note","companyDetails"}){
            String value=settings.optString(field,"");if(value.length()>2000)throw new IllegalArgumentException("Текст слишком длинный");options.put(field,value);
        }
        JSONObject safe=new JSONObject().put("type",type).put("estimateId",estimateId)
            .put("projectName",project.optString("name")).put("address",project.optString("address"))
            .put("clientName",project.optString("client")).put("estimateName",estimate.optBoolean("legacy")?"Исходная смета":estimate.optString("name"))
            .put("works",works).put("materials",mode.equals("detailed")?materials:new JSONArray())
            .put("workTotal",cents(work).toPlainString()).put("workMarkup",markupAmount.toPlainString())
            .put("materialTotal",mode.equals("hidden")?"":cents(mat).toPlainString())
            .put("delivery",delivery.toPlainString()).put("discount",discount.toPlainString())
            .put("total",total.toPlainString()).put("currency","RUB").put("settings",options);
        if(!showPrices)for(int i=0;i<safe.getJSONArray("materials").length();i++)safe.getJSONArray("materials").getJSONObject(i).remove("unitPrice");
        return safe;
    }
    static JSONObject create(JSONObject project,String estimateId,String type,JSONObject options,String requestId,String userId)throws Exception {
        UUID.fromString(requestId);estimate(project,estimateId);
        JSONArray docs=list(project);int version=1;
        for(int i=0;i<docs.length();i++){
            JSONObject d=docs.getJSONObject(i);
            if(requestId.equals(d.optString("requestId")))return d;
            if(type.equals(d.optString("type"))&&estimateId.equals(d.optString("estimateId")))version=Math.max(version,d.getInt("version")+1);
        }
        String prefix=type.equals("COMMERCIAL_OFFER")?"КП":type.equals("DETAILED_ESTIMATE")?"СМ":"КС";
        String year=String.valueOf(LocalDate.now().getYear());int sequence=1;
        for(int i=0;i<docs.length();i++)if(docs.getJSONObject(i).optString("number").startsWith(prefix+"-"+year+"-"))sequence++;
        JSONObject d=new JSONObject().put("id",UUID.randomUUID().toString()).put("requestId",requestId)
            .put("projectId",project.getString("id")).put("estimateId",estimateId).put("type",type)
            .put("number",String.format(java.util.Locale.ROOT,"%s-%s-%03d",prefix,year,sequence))
            .put("version",version).put("status","draft").put("revision",0)
            .put("createdBy",userId).put("createdAt",java.time.Instant.now().toString())
            .put("snapshot",project(project,estimateId,type,options));
        docs.put(d);return d;
    }
    static JSONObject finalizeDocument(JSONObject project,String id)throws Exception {
        JSONObject d=document(project,id);
        if(d.optString("status").equals("final"))return d;
        d.put("status","final").put("finalizedAt",java.time.Instant.now().toString()).put("revision",d.optInt("revision")+1);
        return d;
    }
}
