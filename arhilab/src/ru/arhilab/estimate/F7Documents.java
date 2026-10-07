package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
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
        BigDecimal price=item.isNull("price")?null:dec(item,"price","0");
        BigDecimal total=item.has("importedAmount")&&!item.isNull("importedAmount")?dec(item,"importedAmount","0"):price==null?BigDecimal.ZERO:price.multiply(qty).multiply(coef);
        return new JSONObject().put("title",item.optString("name")).put("section",item.optString("section",item.optString("category","Общие работы")))
            .put("kind",kind).put("unit",item.optString("unit","шт."))
            .put("quantity",qty.toPlainString()).put("coefficient",coef.toPlainString())
            .put("unitPrice",price==null?"":cents(price).toPlainString()).put("total",cents(total).toPlainString())
            .put("note",item.optString("note",""));
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
        LinkedHashMap<String,BigDecimal[]> sectionTotals=new LinkedHashMap<>();
        for(JSONArray group:new JSONArray[]{works,materials})for(int i=0;i<group.length();i++){
            JSONObject entry=group.getJSONObject(i);String section=entry.optString("section","Общие работы");
            BigDecimal[] amounts=sectionTotals.get(section);if(amounts==null){amounts=new BigDecimal[]{BigDecimal.ZERO,BigDecimal.ZERO};sectionTotals.put(section,amounts);}
            int column=group==works?0:1;amounts[column]=amounts[column].add(new BigDecimal(entry.getString("total")));
        }
        JSONArray sections=new JSONArray();for(Map.Entry<String,BigDecimal[]> entry:sectionTotals.entrySet()){
            BigDecimal[] amounts=entry.getValue();sections.put(new JSONObject().put("title",entry.getKey())
                .put("workTotal",cents(amounts[0]).toPlainString())
                .put("materialTotal",mode.equals("hidden")?"":cents(amounts[1]).toPlainString())
                .put("total",mode.equals("hidden")?"":cents(amounts[0].add(amounts[1])).toPlainString()));
        }
        JSONObject options=new JSONObject().put("materials",mode).put("showMaterialPrices",showPrices)
            .put("showSections",settings.optBoolean("showSections",true));
        for(String flag:new String[]{"showQuantity","showUnitPrice","showRowTotal","showSectionTotals","showGrandTotal","hideLinePrices","onlySectionTotals","includePhotos","includeTimeline","includeNotes","includeCompanyDetails","includeSignatures"})
            options.put(flag,settings.optBoolean(flag,flag.equals("showQuantity")||flag.equals("showUnitPrice")||flag.equals("showRowTotal")||flag.equals("showSectionTotals")||flag.equals("showGrandTotal")||flag.equals("includePhotos")||flag.equals("includeTimeline")||flag.equals("includeNotes")));
        for(String field:new String[]{"paymentTerms","timeline","warranty","note","companyDetails","startDate","workingDays","phone","email","site","taxId"}){
            String value=settings.optString(field,"");if(value.length()>2000)throw new IllegalArgumentException("Текст слишком длинный");options.put(field,value);
        }
        String coverId=settings.optString("coverPhotoId","");if(!coverId.isEmpty())UUID.fromString(coverId);options.put("coverPhotoId",coverId);
        JSONObject sectionPhotoIds=settings.optJSONObject("sectionPhotoIds"),safePhotos=new JSONObject();if(sectionPhotoIds!=null){if(sectionPhotoIds.length()>30)throw new IllegalArgumentException("Слишком много фото разделов");for(java.util.Iterator<String> it=sectionPhotoIds.keys();it.hasNext();){String title=it.next(),id=sectionPhotoIds.optString(title);if(title.length()>250)throw new IllegalArgumentException("Название раздела слишком длинное");UUID.fromString(id);safePhotos.put(title,id);}}options.put("sectionPhotoIds",safePhotos);
        JSONObject safe=new JSONObject().put("type",type).put("estimateId",estimateId)
            .put("projectName",project.optString("name")).put("address",project.optString("address"))
            .put("clientName",project.optString("client")).put("estimateName",estimate.optBoolean("legacy")?"Исходная смета":estimate.optString("name"))
            .put("works",works).put("materials",mode.equals("detailed")?materials:new JSONArray()).put("sections",sections)
            .put("workTotal",cents(work).toPlainString()).put("workMarkup",markupAmount.toPlainString())
            .put("materialTotal",mode.equals("hidden")?"":cents(mat).toPlainString())
            .put("delivery",delivery.toPlainString()).put("discount",discount.toPlainString())
            .put("total",total.toPlainString()).put("currency","RUB").put("settings",options);
        if(!showPrices)for(int i=0;i<safe.getJSONArray("materials").length();i++)safe.getJSONArray("materials").getJSONObject(i).remove("unitPrice");
        return safe;
    }
    static JSONObject create(JSONObject project,String estimateId,String type,JSONObject options,String requestId,String userId)throws Exception {
        return create(project,estimateId,type,options,requestId,userId,new JSONArray().put(project));
    }
    static JSONObject create(JSONObject project,String estimateId,String type,JSONObject options,String requestId,String userId,JSONArray projects)throws Exception {
        UUID.fromString(requestId);estimate(project,estimateId);
        JSONArray docs=list(project);int version=1;
        for(int i=0;i<docs.length();i++){
            JSONObject d=docs.getJSONObject(i);
            if(requestId.equals(d.optString("requestId")))return d;
            if(type.equals(d.optString("type"))&&estimateId.equals(d.optString("estimateId")))version=Math.max(version,d.getInt("version")+1);
        }
        String prefix=type.equals("COMMERCIAL_OFFER")?"КП":type.equals("DETAILED_ESTIMATE")?"СМ":"КС";
        String year=String.valueOf(LocalDate.now().getYear());int sequence=1;
        String stem=prefix+"-"+year+"-";
        for(int p=0;p<projects.length();p++){
            JSONArray existing=list(projects.getJSONObject(p));
            for(int i=0;i<existing.length();i++){
                String number=existing.getJSONObject(i).optString("number");
                if(number.startsWith(stem))try{sequence=Math.max(sequence,Integer.parseInt(number.substring(stem.length()))+1);}catch(NumberFormatException ignored){}
            }
        }
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
