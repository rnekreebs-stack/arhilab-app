package ru.arhilab.estimate;

import java.util.Date;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable lifecycle marker. Records and their references are never removed. */
final class EstimateLifecycle {
    static String status(JSONObject estimate) { return estimate.optString("lifecycleStatus", "active"); }
    static void ensure(JSONObject estimate) throws Exception {
        if (!estimate.has("lifecycleStatus")) estimate.put("lifecycleStatus", "active");
    }
    static JSONObject dependencies(JSONObject project, JSONObject estimate) throws Exception {
        String id=estimate.getString("id");
        JSONObject counts=new JSONObject();
        for(String kind:new String[]{"payments","expenses","tasks","procurementRequests","clientDocuments"}) {
            int n=0;JSONArray rows=project.optJSONArray(kind);
            if(rows!=null)for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("estimateId")))n++;
            counts.put(kind,n);
        }
        for(String kind:new String[]{"executionStages","progressEntries","lines","materials"})
            counts.put(kind,estimate.optJSONArray(kind)==null?0:estimate.getJSONArray(kind).length());
        // Legacy rows may also be referenced through the object's original fields.
        if(estimate.optBoolean("legacy"))for(String kind:new String[]{"payments","tasks","photos","notes","estimatePhotos"})
            counts.put("object"+kind,project.optJSONArray(kind)==null?0:project.getJSONArray(kind).length());
        return counts;
    }
    static int count(JSONObject counts) throws Exception {
        int result=0;for(java.util.Iterator<String> it=counts.keys();it.hasNext();)result+=counts.getInt(it.next());return result;
    }
    static void transition(JSONObject project,JSONObject estimate,String action,boolean confirmed,boolean relatedAcknowledged,String confirmationName) throws Exception {
        String status=status(estimate);
        if("archive".equals(action)&&"active".equals(status)){
            estimate.put("lifecycleStatus","archived").put("archivedAt",new Date().toInstant().toString());
        }else if("restore".equals(action)&&"archived".equals(status)){
            estimate.put("lifecycleStatus","active");estimate.remove("archivedAt");
        }else if("delete".equals(action)&&("active".equals(status)||"archived".equals(status))){
            if(!confirmed||!estimate.optString("name").equals(confirmationName))throw new Exception("Подтвердите удаление названием сметы");
            if(count(dependencies(project,estimate))>0&&!relatedAcknowledged)throw new Exception("У сметы есть связанные данные. Подтвердите сохранение истории в удалённой смете");
            estimate.put("lifecycleStatus","deleted").put("deletedAt",new Date().toInstant().toString());
        }else throw new Exception("Недопустимое изменение состояния сметы");
        estimate.put("lifecycleRevision",estimate.optLong("lifecycleRevision",0)+1);
    }
}
