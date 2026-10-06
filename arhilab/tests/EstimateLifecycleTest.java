package ru.arhilab.estimate;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

public final class EstimateLifecycleTest {
    static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
    public static void main(String[] args)throws Exception{
        String projectId=UUID.randomUUID().toString(),id=UUID.randomUUID().toString();
        JSONObject row=new JSONObject().put("id",id).put("name","Тестовая смета")
            .put("lines",new JSONArray().put(new JSONObject().put("id",UUID.randomUUID().toString()).put("price",100)))
            .put("materials",new JSONArray().put(new JSONObject().put("sku","A-1")));
        JSONObject project=new JSONObject().put("id",projectId).put("lines",new JSONArray()).put("materials",new JSONArray())
            .put("estimates",new JSONArray().put(row)).put("payments",new JSONArray().put(new JSONObject().put("estimateId",id).put("amount",42)))
            .put("clientDocuments",new JSONArray().put(new JSONObject().put("estimateId",id).put("number","1")));
        JSONObject old=new JSONObject().put("schemaVersion",9).put("users",new JSONArray()).put("projects",new JSONArray().put(project));
        JSONObject migrated=DataMigration.migrate(old),p=migrated.getJSONArray("projects").getJSONObject(0),e=p.getJSONArray("estimates").getJSONObject(0);
        check(migrated.getInt("schemaVersion")==10&&EstimateLifecycle.status(e).equals("active"),"old estimates active after migration");
        check(old.getInt("schemaVersion")==9&&!row.has("lifecycleStatus"),"source unchanged");
        EstimateLifecycle.transition(p,e,"archive",false,false,"");
        check(EstimateLifecycle.status(e).equals("archived")&&e.getJSONArray("lines").length()==1,"archive retains rows");
        JSONObject restored=DataMigration.migrate(new JSONObject(migrated.toString()));
        check(EstimateLifecycle.status(restored.getJSONArray("projects").getJSONObject(0).getJSONArray("estimates").getJSONObject(0)).equals("archived"),"archive backup roundtrip");
        EstimateLifecycle.transition(p,e,"restore",false,false,"");
        check(EstimateLifecycle.status(e).equals("active")&&e.getJSONArray("materials").length()==1,"restore retains totals inputs");
        boolean denied=false;try{EstimateLifecycle.transition(p,e,"delete",true,false,"Тестовая смета");}catch(Exception ex){denied=true;}
        check(denied&&EstimateLifecycle.status(e).equals("active"),"dependent history requires acknowledgement");
        denied=false;try{EstimateLifecycle.transition(p,e,"delete",true,true,"wrong");}catch(Exception ex){denied=true;}
        check(denied,"exact name required");
        EstimateLifecycle.transition(p,e,"delete",true,true,"Тестовая смета");
        check(EstimateLifecycle.status(e).equals("deleted")&&e.has("deletedAt")&&p.getJSONArray("payments").length()==1&&p.getJSONArray("clientDocuments").length()==1,"tombstone retains dependencies");
        JSONObject backup=DataMigration.migrate(new JSONObject(migrated.toString()));
        check(EstimateLifecycle.status(backup.getJSONArray("projects").getJSONObject(0).getJSONArray("estimates").getJSONObject(0)).equals("deleted"),"deleted state survives restore");
        denied=false;try{EstimateLifecycle.transition(p,e,"restore",false,false,"");}catch(Exception ex){denied=true;}
        check(denied,"deleted estimate cannot be restored from archive UI");
        System.out.println("Estimate archive, restore, tombstone, migration, backup and related data passed");
    }
}
