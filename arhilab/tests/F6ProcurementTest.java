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
            .put("payments",new JSONArray()).put("expenses",new JSONArray());LocalEstimates.ensure(project);
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
        JSONObject expense=new JSONObject().put("id",UUID.randomUUID().toString()).put("procurementRequestId",r.getString("id"))
            .put("category","materials").put("amount","100.00").put("currency","RUB")
            .put("date","2026-09-28").put("description","Кабель").put("note","");
        F3Expenses.validate(expense);project.getJSONArray("expenses").put(expense);
        F1SyncLedger.capture(database);JSONArray jobs=database.getJSONObject("f1Sync").getJSONArray("operations");
        check(jobs.length()==5,"project estimate request receipt linked expense queue");
        check(jobs.getJSONObject(2).getString("entityType").equals("procurementRequest"),"request before receipt");
        check(jobs.getJSONObject(4).getString("entityType").equals("expense"),"request before linked expense");
        JSONObject restarted=new JSONObject(database.toString());F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length()==5,"restart retained queue");
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
        check(second.getJSONArray("projects").getJSONObject(0).getJSONArray("expenses").getJSONObject(0)
            .getString("procurementRequestId").equals(r.getString("id")),"second-device F3 link");
        F6Procurement.delete(project,"receipt",receipt.getString("id"));
        F1SyncLedger.capture(database);
        check(database.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(5)
            .getString("operationType").equals("delete"),"receipt tombstone queue");
        if(args.length>1)backupRestoreQueue(args[1]);
        System.out.println("F6 local migration, exact quantity, offline queue, restart, second-device merge passed");
    }
    static void backupRestoreQueue(String fixturePath)throws Exception {
        String projectId=UUID.randomUUID().toString(),itemId=UUID.randomUUID().toString();
        JSONObject line=new JSONObject().put("id",itemId).put("syncId",itemId).put("name","Кабель")
            .put("qty","100.0000").put("unit","м").put("price","0").put("coef","1");
        JSONObject project=new JSONObject().put("id",projectId).put("name","Копия F6")
            .put("lines",new JSONArray().put(line)).put("materials",new JSONArray()).put("tasks",new JSONArray())
            .put("payments",new JSONArray()).put("expenses",new JSONArray());
        LocalEstimates.ensure(project);String estimateId=project.getString("legacyEstimateId");
        JSONObject original=new JSONObject().put("schemaVersion",8).put("users",new JSONArray())
            .put("projects",new JSONArray().put(project));
        JSONObject catalog=new JSONObject().put("materials",new JSONArray().put(new JSONObject().put("id","1")));
        JSONObject request=F6Procurement.saveRequest(project,request("Кабель","100.0000")
            .put("unit","м").put("catalogSku","1").put("estimateId",estimateId)
            .put("estimateItemId",itemId).put("status","ordered"),catalog);
        JSONObject receipt=F6Procurement.saveReceipt(project,new JSONObject().put("requestId",request.getString("id"))
            .put("quantity","40.0000").put("businessDate","2026-09-28"));
        F1SyncLedger.capture(original);
        String pendingId=original.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(4).getString("operationId");
        // Arhilab-2 exports the business records, not access tokens or a server cursor. Restore
        // intentionally starts a fresh ledger and captures the restored UUIDs as pending work.
        JSONObject backup=new JSONObject().put("format","Arhilab-2").put("schemaVersion",8)
            .put("users",new JSONArray()).put("projects",new JSONArray(original.getJSONArray("projects").toString()));
        byte[] encrypted=BackupCrypto.encrypt(backup.toString().getBytes(StandardCharsets.UTF_8),"local-test-passphrase".toCharArray());
        JSONObject decoded=new JSONObject(new String(BackupCrypto.decrypt(encrypted,"local-test-passphrase".toCharArray()),StandardCharsets.UTF_8));
        JSONObject restored=DataMigration.migrate(new JSONObject().put("schemaVersion",decoded.getInt("schemaVersion"))
            .put("users",decoded.getJSONArray("users")).put("projects",decoded.getJSONArray("projects")));
        F1SyncLedger.capture(restored);
        JSONObject p=restored.getJSONArray("projects").getJSONObject(0);
        JSONObject x=F6Procurement.find(p.getJSONArray("procurementRequests"),request.getString("id"));
        JSONObject y=F6Procurement.find(p.getJSONArray("procurementReceipts"),receipt.getString("id"));
        check(x.getString("requestedQuantity").equals("100.0000")&&y.getString("quantity").equals("40.0000"),"backup quantities");
        check(F6Procurement.received(p,x.getString("id")).toPlainString().equals("40.0000"),"received after restore");
        check(x.getString("estimateId").equals(estimateId)&&x.getString("estimateItemId").equals(itemId)
            &&x.getString("catalogSku").equals("1")&&x.getString("status").equals("ordered"),"backup links and status");
        JSONArray pending=restored.getJSONObject("f1Sync").getJSONArray("operations");
        check(pending.length()==5,"restored queue has project, estimate, item, request, receipt exactly once");
        check(pending.getJSONObject(3).getString("entityId").equals(x.getString("id"))
            &&pending.getJSONObject(4).getString("entityId").equals(y.getString("id")),"restored dependency order");
        check(!pendingId.equals(pending.getJSONObject(4).getString("operationId")),"no old server credential or cursor replay");
        JSONObject restarted=DataMigration.migrate(new JSONObject(restored.toString()));
        F1SyncLedger.capture(restarted);
        JSONArray afterRestart=restarted.getJSONObject("f1Sync").getJSONArray("operations");
        check(afterRestart.length()==5&&afterRestart.getJSONObject(4).getString("operationId")
            .equals(pending.getJSONObject(4).getString("operationId")),"post-restore durable retry is stable");
        JSONArray operations=new JSONArray();for(int i=0;i<afterRestart.length();i++){
            JSONObject op=new JSONObject(afterRestart.getJSONObject(i).toString());op.remove("state");operations.put(op);
        }
        Files.write(Paths.get(fixturePath),new JSONObject().put("operations",operations)
            .put("projectId",projectId).put("requestId",x.getString("id")).put("receiptId",y.getString("id"))
            .toString().getBytes(StandardCharsets.UTF_8));
    }
}
