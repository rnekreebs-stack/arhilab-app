package ru.arhilab.estimate;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F6ProcurementTest {
    static void check(boolean valid,String label){if(!valid)throw new AssertionError(label);}
    static JSONObject request(String title,String qty)throws Exception{return new JSONObject().put("title",title).put("unit","шт")
        .put("requestedQuantity",qty).put("status","requested");}
    public static void main(String[] args)throws Exception {
        String id=UUID.randomUUID().toString();JSONObject project=new JSONObject().put("id",id).put("name","Объект")
            .put("lines",new JSONArray()).put("materials",new JSONArray()).put("tasks",new JSONArray())
            .put("payments",new JSONArray());LocalEstimates.ensure(project);
        JSONObject database=DataMigration.migrate(new JSONObject().put("schemaVersion",7)
            .put("users",new JSONArray()).put("projects",new JSONArray().put(project)));
        project=database.getJSONArray("projects").getJSONObject(0);
        check(database.getInt("schemaVersion")==8,"v7 to v8");
        check(project.getJSONArray("procurementRequests").length()==0,"no invented legacy request");
        JSONObject catalog=new JSONObject().put("materials",new JSONArray().put(new JSONObject().put("id","1")));
        JSONObject r=F6Procurement.saveRequest(project,request("Кабель","3.0000").put("catalogSku","1"),catalog);
        try{F6Procurement.saveRequest(project,request("Подмена","1").put("catalogSku","unknown"),catalog);throw new AssertionError("unknown SKU");}
        catch(IllegalArgumentException expected){}
        JSONObject receipt=F6Procurement.saveReceipt(project,new JSONObject().put("requestId",r.getString("id"))
            .put("quantity","1.2500").put("businessDate","2026-09-28"));
        check(F6Procurement.received(project,r.getString("id")).toPlainString().equals("1.2500"),"partial receipt");
        try{F6Procurement.saveReceipt(project,new JSONObject().put("requestId",r.getString("id"))
            .put("quantity","1.7501").put("businessDate","2026-09-28"));throw new AssertionError("overreceipt");}
        catch(IllegalArgumentException expected){}
        F1SyncLedger.capture(database);JSONArray jobs=database.getJSONObject("f1Sync").getJSONArray("operations");
        check(jobs.length()==4,"project estimate request receipt queue");
        check(jobs.getJSONObject(2).getString("entityType").equals("procurementRequest"),"request before receipt");
        JSONObject restarted=new JSONObject(database.toString());F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length()==4,"restart retained queue");
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(3).getString("operationId")
            .equals(jobs.getJSONObject(3).getString("operationId")),"same idempotency after restart");
        if(args.length>0){JSONArray ops=new JSONArray();for(int i=0;i<jobs.length();i++){
            JSONObject op=new JSONObject(jobs.getJSONObject(i).toString());op.remove("state");ops.put(op);
        }Files.write(Paths.get(args[0]),new JSONObject().put("operations",ops).put("projectId",id)
            .put("requestId",r.getString("id")).put("receiptId",receipt.getString("id"))
            .toString().getBytes(StandardCharsets.UTF_8));}
        JSONObject second=new JSONObject().put("schemaVersion",8).put("users",new JSONArray()).put("projects",new JSONArray());
        for(int i=0;i<jobs.length();i++){
            JSONObject op=jobs.getJSONObject(i),snapshot=new JSONObject(op.getJSONObject("payload").toString()).put("deletedAt",JSONObject.NULL);
            if(i>=2)snapshot.put("createdBy",UUID.randomUUID().toString());
            F1SyncMerge.apply(second,new JSONObject().put("entityType",op.getString("entityType"))
                .put("entityId",op.getString("entityId")).put("revision",1).put("snapshot",snapshot));
        }
        check(second.getJSONArray("projects").getJSONObject(0).getJSONArray("procurementReceipts").length()==1,"second device");
        check(DataMigration.migrate(new JSONObject(second.toString())).getJSONArray("projects").getJSONObject(0)
            .getJSONArray("procurementReceipts").length()==1,"backup restart");
        F6Procurement.delete(project,"receipt",receipt.getString("id"));
        F1SyncLedger.capture(database);
        check(database.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(4)
            .getString("operationType").equals("delete"),"receipt tombstone queue");
        System.out.println("F6 local migration, exact quantity, offline queue, restart, second-device merge passed");
    }
}
