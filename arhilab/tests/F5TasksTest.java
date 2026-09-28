package ru.arhilab.estimate;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F5TasksTest {
    private static void check(boolean valid,String message){if(!valid)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception {
        String projectId=UUID.randomUUID().toString(),legacyId=UUID.randomUUID().toString();
        JSONObject legacy=new JSONObject().put("id",legacyId).put("name","Историческая задача")
            .put("status","Приостановлено").put("progress",35).put("responsible","Иван")
            .put("planDate","2026-09-28").put("comment","Уточнить материал");
        JSONObject project=new JSONObject().put("id",projectId).put("name","Объект")
            .put("lines",new JSONArray()).put("materials",new JSONArray()).put("payments",new JSONArray())
            .put("tasks",new JSONArray().put(legacy));
        LocalEstimates.ensure(project); // A valid v6 database already contains its original estimate.
        JSONObject db=DataMigration.migrate(new JSONObject().put("schemaVersion",6)
            .put("users",new JSONArray()).put("projects",new JSONArray().put(project)));
        project=db.getJSONArray("projects").getJSONObject(0);
        check(db.getInt("schemaVersion")==8,"F5 and F6 migrations not applied");
        check(project.getJSONArray("tasks").getJSONObject(0).getString("taskStatus").equals("open"),"paused legacy status lost");
        check(project.getJSONArray("tasks").getJSONObject(0).getInt("progress")==35,"manual progress lost");
        check(DataMigration.migrate(db).getJSONArray("projects").getJSONObject(0).getJSONArray("tasks").length()==1,
            "migration duplicated task");
        String estimateId=project.getJSONArray("estimates").getJSONObject(0).getString("id");
        JSONObject created=F5Tasks.save(project,new JSONObject().put("name","Монтаж трапа")
            .put("comment","После стяжки").put("taskStatus","in_progress")
            .put("priority","urgent").put("planDate","2026-09-29").put("estimateId",estimateId));
        String id=created.getString("id");
        check(F1SyncLedger.hasPrivateLegacy(db),"unmapped legacy progress not disclosed");
        F1SyncLedger.capture(db);
        JSONArray queued=db.getJSONObject("f1Sync").getJSONArray("operations");
        check(queued.length()==4,"project, estimate and two tasks must queue together");
        check(queued.getJSONObject(2).getString("entityType").equals("task"),"task dependency order");
        JSONObject restarted=new JSONObject(db.toString());F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(3).getString("operationId")
            .equals(queued.getJSONObject(3).getString("operationId")),"restart changed retry ID");
        if(args.length>0){JSONArray ops=new JSONArray();for(int i=0;i<queued.length();i++){
            JSONObject op=new JSONObject(queued.getJSONObject(i).toString());op.remove("state");ops.put(op);
        }Files.write(Paths.get(args[0]),new JSONObject().put("operations",ops)
            .put("projectId",projectId).put("estimateId",estimateId).put("taskId",id)
            .put("legacyId",legacyId).toString().getBytes(StandardCharsets.UTF_8));}
        JSONObject second=new JSONObject().put("schemaVersion",7).put("users",new JSONArray()).put("projects",new JSONArray());
        for(int i=0;i<queued.length();i++){
            JSONObject operation=queued.getJSONObject(i),snapshot=new JSONObject(operation.getJSONObject("payload").toString());
            snapshot.put("deletedAt",JSONObject.NULL);
            if(operation.getString("entityType").equals("task"))snapshot.put("createdBy",UUID.randomUUID().toString());
            F1SyncMerge.apply(second,new JSONObject().put("entityType",operation.getString("entityType"))
                .put("entityId",operation.getString("entityId")).put("revision",1).put("snapshot",snapshot));
        }
        check(second.getJSONArray("projects").getJSONObject(0).getJSONArray("tasks").length()==2,"second-device tasks");
        check(new JSONObject(second.toString()).getJSONArray("projects").getJSONObject(0)
            .getJSONArray("tasks").length()==2,"second-device offline restart");
        F5Tasks.save(project,new JSONObject().put("id",id).put("taskStatus","done"));
        F1SyncLedger.capture(db);
        check(db.getJSONObject("f1Sync").getJSONArray("operations").length()==5,"completion not queued");
        System.out.println("F5 legacy upgrade, encrypted state projection, retry, backup and second-device tasks passed");
    }
}
