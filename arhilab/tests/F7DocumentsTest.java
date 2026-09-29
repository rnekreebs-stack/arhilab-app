package ru.arhilab.estimate;
import org.json.*;
import java.util.UUID;
public final class F7DocumentsTest {
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  String id=UUID.randomUUID().toString(),uid=UUID.randomUUID().toString();
  JSONObject p=new JSONObject().put("id",id).put("name","<script>alert(1)</script>").put("address","Адрес")
   .put("client","Клиент").put("lines",new JSONArray().put(new JSONObject().put("id",UUID.randomUUID().toString())
     .put("name","Монтаж").put("category","Раздел").put("unit","м²").put("qty","2.5000").put("coef","1").put("price","1234.00")
     .put("cost","999").put("autoMaterial",true).put("materialPrice","100.00")))
   .put("materials",new JSONArray()).put("expenses",new JSONArray().put(new JSONObject().put("amount",9999)))
   .put("tasks",new JSONArray()).put("payments",new JSONArray()).put("workMarkupPercent","10").put("delivery",50).put("discount",10);
  LocalEstimates.ensure(p);JSONObject data=new JSONObject().put("schemaVersion",8).put("users",new JSONArray()).put("projects",new JSONArray().put(p));
  data=DataMigration.migrate(data);p=data.getJSONArray("projects").getJSONObject(0);
  check(data.getInt("schemaVersion")==9&&p.getJSONArray("clientDocuments").length()==0,"additive migration");
  String estimate=p.getString("legacyEstimateId"),request=UUID.randomUUID().toString();
  JSONObject options=new JSONObject().put("materials","detailed").put("showMaterialPrices",true);
  JSONObject v1=F7Documents.create(p,estimate,"COMMERCIAL_OFFER",options,request,uid);
  String before=v1.getJSONObject("snapshot").toString();
  check(v1.getJSONObject("snapshot").getString("total").equals("3683.50"),"decimal and historical price");
  JSONObject section=v1.getJSONObject("snapshot").getJSONArray("sections").getJSONObject(0);
  check(section.getString("workTotal").equals("3085.00")&&section.getString("materialTotal").equals("250.00")&&section.getString("total").equals("3335.00"),"section work and material subtotals");
  for(String secret:new String[]{"expenses","cost","profit","margin","sessionHash","9999"})check(!before.contains(secret),"secret leaked: "+secret);
  check(F7Documents.create(p,estimate,"COMMERCIAL_OFFER",options,request,uid).getString("id").equals(v1.getString("id")),"retry duplicate");
  F7Documents.finalizeDocument(p,v1.getString("id"));p.getJSONArray("lines").getJSONObject(0).put("qty","3.0000").put("price","1500.00");
  JSONObject v2=F7Documents.create(p,estimate,"COMMERCIAL_OFFER",options,UUID.randomUUID().toString(),uid);
  check(v1.getJSONObject("snapshot").toString().equals(before)&&v1.getInt("version")==1&&v2.getInt("version")==2,"final snapshot immutable");
  check(!v1.getJSONObject("snapshot").getString("total").equals(v2.getJSONObject("snapshot").getString("total")),"new version should change");
  JSONObject restored=DataMigration.migrate(new JSONObject(data.toString()));
  check(restored.getJSONArray("projects").getJSONObject(0).getJSONArray("clientDocuments").length()==2,"backup roundtrip preserves docs");
  System.out.println("F7 local migration, client projection, exact totals, snapshot, idempotency and backup passed");
 }
}
