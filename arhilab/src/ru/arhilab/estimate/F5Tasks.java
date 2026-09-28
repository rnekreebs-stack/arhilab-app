package ru.arhilab.estimate;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** One project task record; historical 0.6.2 progress and assignee text remain intact. */
final class F5Tasks {
    private F5Tasks() {}

    static void ensure(JSONObject project) throws Exception {
        JSONArray tasks=project.optJSONArray("tasks");
        if(tasks==null){tasks=new JSONArray();project.put("tasks",tasks);}
        for(int i=0;i<tasks.length();i++){
            JSONObject task=tasks.getJSONObject(i);
            String status=task.optString("status","");
            if(!task.has("taskStatus"))task.put("taskStatus",task.optBoolean("done")||status.equals("Завершено")?"done":
                status.equals("В работе")?"in_progress":"open");
            if(!task.has("priority"))task.put("priority","normal");
        }
    }

    static JSONObject save(JSONObject project,JSONObject input)throws Exception {
        ensure(project);
        JSONArray tasks=project.getJSONArray("tasks");
        String id=input.optString("id","");JSONObject task=null;int index=-1;
        if(!id.isEmpty())for(int i=0;i<tasks.length();i++){
            JSONObject row=tasks.getJSONObject(i);if(id.equals(row.getString("id"))){task=new JSONObject(row.toString());index=i;break;}
        }
        if(task==null){if(!id.isEmpty())throw new IllegalArgumentException("Задача не найдена");
            task=new JSONObject().put("id",UUID.randomUUID().toString()).put("progress",0);}
        String title=input.optString("name",task.optString("name","")).trim();
        if(title.isEmpty()||title.length()>250)throw new IllegalArgumentException("Название задачи: 1–250 символов");
        String description=input.optString("comment",task.optString("comment",""));
        if(description.length()>1000)throw new IllegalArgumentException("Описание слишком длинное");
        String status=input.optString("taskStatus",task.optString("taskStatus","open"));
        if(!status.equals("open")&&!status.equals("in_progress")&&!status.equals("done"))throw new IllegalArgumentException("Статус задачи недопустим");
        String priority=input.optString("priority",task.optString("priority","normal"));
        if(!priority.equals("normal")&&!priority.equals("high")&&!priority.equals("urgent"))throw new IllegalArgumentException("Приоритет недопустим");
        String due=input.optString("planDate",task.optString("planDate",""));
        if(!due.isEmpty())try {java.time.LocalDate.parse(due);}catch(Exception error){throw new IllegalArgumentException("Срок задачи недопустим");}
        for(String field:new String[]{"estimateId","stageId","estimateItemId","assigneeId"}){
            String value=input.optString(field,task.optString(field,""));
            if(!value.isEmpty()){
                try{UUID.fromString(value);}catch(Exception error){throw new IllegalArgumentException("Неверный UUID ссылки задачи");}
                task.put(field,value);
            }else task.remove(field);
        }
        if((task.has("stageId")||task.has("estimateItemId"))&&!task.has("estimateId"))throw new IllegalArgumentException("Сначала выберите смету");
        if(task.has("estimateId")){
            JSONObject estimate=null;JSONArray estimates=project.optJSONArray("estimates");
            if(estimates!=null)for(int i=0;i<estimates.length();i++)if(estimates.getJSONObject(i).getString("id").equals(task.getString("estimateId")))estimate=estimates.getJSONObject(i);
            if(estimate==null)throw new IllegalArgumentException("Смета не принадлежит объекту");
            if(task.has("stageId")){boolean found=false;JSONArray stages=estimate.optJSONArray("executionStages");
                if(stages!=null)for(int i=0;i<stages.length();i++)found|=task.getString("stageId").equals(stages.getJSONObject(i).getString("id"));
                if(!found)throw new IllegalArgumentException("Этап не принадлежит смете");}
            if(task.has("estimateItemId")){boolean found=false;
                for(String kind:new String[]{"lines","materials"}){JSONArray rows=estimate.optJSONArray(kind);if(rows!=null)
                    for(int i=0;i<rows.length();i++)found|=task.getString("estimateItemId").equals(rows.getJSONObject(i).optString("syncId"));}
                if(!found)throw new IllegalArgumentException("Работа не принадлежит смете");}
        }
        String previous=task.optString("taskStatus","open");
        task.put("name",title).put("comment",description).put("planDate",due)
            .put("taskStatus",status).put("priority",priority).put("done",status.equals("done"))
            .put("status",status.equals("done")?"Завершено":status.equals("in_progress")?"В работе":"Не начато");
        if(status.equals("done")&&!previous.equals("done"))task.put("actualDate",java.time.LocalDate.now().toString());
        if(!status.equals("done")&&previous.equals("done"))task.remove("actualDate");
        if(index<0)tasks.put(task);else tasks.put(index,task);
        return task;
    }
}
