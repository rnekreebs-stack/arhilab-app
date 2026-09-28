package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F4ExecutionTest {
    private static void check(boolean okay,String message){if(!okay)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        String projectId=UUID.randomUUID().toString(),itemId=UUID.randomUUID().toString(),author=UUID.randomUUID().toString();
        JSONObject work=new JSONObject().put("id",itemId).put("name","Штукатурка стен")
            .put("qty","120.00").put("unit","м²").put("price",100).put("coef",1);
        JSONObject project=new JSONObject().put("id",projectId).put("name","Объект")
            .put("lines",new JSONArray().put(work)).put("materials",new JSONArray())
            .put("payments",new JSONArray()).put("tasks",new JSONArray());
        JSONObject db=DataMigration.migrate(new JSONObject().put("schemaVersion",5)
            .put("users",new JSONArray()).put("projects",new JSONArray().put(project)));
        check(db.getInt("schemaVersion")==DataMigration.CURRENT,"local migration version");
        project=db.getJSONArray("projects").getJSONObject(0);
        JSONObject estimate=project.getJSONArray("estimates").getJSONObject(0);
        String estimateId=estimate.getString("id");
        String stageId=F4Execution.saveStage(estimate,new JSONObject().put("name","Черновые работы")).getString("id");
        F4Execution.assign(estimate,itemId,stageId);
        JSONObject first=F4Execution.saveEntry(estimate,new JSONObject().put("estimateItemId",itemId)
            .put("quantity","35.00").put("businessDate","2026-09-28").put("note","первый слой"),author);
        check(first.getString("historicalStageId").equals(stageId),"stage at event time");
        F4Execution.saveEntry(estimate,new JSONObject().put("estimateItemId",itemId).put("quantity","20.00")
            .put("businessDate","2026-09-29"),author);
        F4Execution.saveEntry(estimate,new JSONObject().put("estimateItemId",itemId).put("quantity","15.00")
            .put("businessDate","2026-09-30"),author);
        check(F4Execution.completed(estimate,itemId,"").compareTo(new BigDecimal("70"))==0,"journal aggregate");
        try {F4Execution.saveEntry(estimate,new JSONObject().put("estimateItemId",itemId).put("quantity","51")
            .put("businessDate","2026-10-01"),author);throw new AssertionError("over-completion accepted");}
        catch(IllegalArgumentException expected){}
        try{F4Execution.assertRemovable(estimate,itemId);throw new AssertionError("history erased with work");}
        catch(IllegalArgumentException expected){}
        F4Execution.saveEntry(estimate,new JSONObject().put("id",first.getString("id")).put("quantity","36.00")
            .put("businessDate","2026-09-28").put("note","исправлено"),author);
        check(F4Execution.completed(estimate,itemId,"").compareTo(new BigDecimal("71"))==0,"edit aggregate");
        F4Execution.assign(estimate,itemId,"");
        check(first.getString("historicalStageId").equals(stageId),"moving item changed history");
        F4Execution.assign(estimate,itemId,stageId);
        JSONObject backup=new JSONObject(db.toString());
        JSONObject restored=DataMigration.migrate(backup);
        JSONObject restoredEstimate=restored.getJSONArray("projects").getJSONObject(0).getJSONArray("estimates").getJSONObject(0);
        check(restoredEstimate.getJSONArray("executionStages").getJSONObject(0).getString("id").equals(stageId)
            && F4Execution.completed(restoredEstimate,itemId,"").compareTo(new BigDecimal("71"))==0,
            "backup, restore or restart dropped journal");
        F1SyncLedger.capture(db);
        JSONArray queued=db.getJSONObject("f1Sync").getJSONArray("operations");
        check(queued.length()==7,"project, estimate, stage, item, three entries");
        check(queued.getJSONObject(2).getString("entityType").equals("stage")
            &&queued.getJSONObject(3).getString("entityType").equals("estimateItem"),"FK dependency ordering");
        JSONObject restarted=new JSONObject(db.toString());F1SyncLedger.capture(restarted);
        JSONArray retry=restarted.getJSONObject("f1Sync").getJSONArray("operations");
        check(retry.length()==queued.length()&&retry.getJSONObject(4).getString("operationId")
            .equals(queued.getJSONObject(4).getString("operationId")),"restart lost operation identity");
        if(args.length>0){JSONArray ops=new JSONArray();for(int i=0;i<queued.length();i++){
            JSONObject op=new JSONObject(queued.getJSONObject(i).toString());op.remove("state");ops.put(op);
        }Files.write(Paths.get(args[0]),new JSONObject().put("operations",ops)
            .put("projectId",projectId).put("estimateId",estimateId).put("stageId",stageId)
            .put("itemId",itemId).put("entryId",first.getString("id")).toString().getBytes(StandardCharsets.UTF_8));}
        JSONObject deviceB=new JSONObject().put("schemaVersion",6).put("users",new JSONArray()).put("projects",new JSONArray());
        for(int i=0;i<queued.length();i++){
            JSONObject operation=queued.getJSONObject(i),snapshot=new JSONObject(operation.getJSONObject("payload").toString());
            if(operation.getString("entityType").equals("progressEntry")){
                snapshot.put("createdBy",author);
                snapshot.put("historicalStageId",stageId);
            }
            snapshot.put("deletedAt",JSONObject.NULL);
            F1SyncMerge.apply(deviceB,new JSONObject().put("entityType",operation.getString("entityType"))
                .put("entityId",operation.getString("entityId")).put("revision",1).put("snapshot",snapshot));
        }
        JSONObject second=deviceB.getJSONArray("projects").getJSONObject(0).getJSONArray("estimates").getJSONObject(0);
        check(F4Execution.completed(second,itemId,"").compareTo(new BigDecimal("71"))==0,"second-device merge");
        check(F4Execution.completed(new JSONObject(second.toString()),itemId,"").compareTo(new BigDecimal("71"))==0,"second-device offline restart");
        System.out.println("F4 migration, local journal, backup, offline queue and second device passed");
    }
}
