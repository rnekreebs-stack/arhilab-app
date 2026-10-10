package ru.arhilab.estimate;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Keeps legacy project/estimate photo arrays readable while adding stable cross-links. */
final class PhotoProfile {
 static final String[] TYPES={"BEFORE","PROGRESS","AFTER","DOCUMENT","DEFECT","MATERIAL","OTHER"};
 static String type(String value)throws Exception {for(String t:TYPES)if(t.equals(value))return t;throw new Exception("Неизвестная категория фото");}
 static JSONArray array(JSONObject p,String name)throws Exception {JSONArray a=p.optJSONArray(name);if(a==null){a=new JSONArray();p.put(name,a);}return a;}
 static void normalize(JSONObject p)throws Exception{
  if(!p.has("address")||p.isNull("address"))p.put("address","");
  if(!p.has("coverPhotoId"))p.put("coverPhotoId",JSONObject.NULL);
  for(String name:new String[]{"photos","estimatePhotos"}){
   JSONArray a=array(p,name);for(int i=0;i<a.length();i++){
    JSONObject row=a.getJSONObject(i);row.put("projectId",p.getString("id"));
    if(!row.has("type"))row.put("type",name.equals("estimatePhotos")?"DOCUMENT":"OTHER");
    if(!row.has("caption"))row.put("caption","");
    if(!row.has("createdAt"))row.put("createdAt",row.optString("date",""));
    if(!row.has("updatedAt"))row.put("updatedAt",row.optString("createdAt",""));
    if(!row.has("revision"))row.put("revision",0);
    if(!row.has("estimateId"))row.put("estimateId",JSONObject.NULL);
    if(!row.has("estimateItemId"))row.put("estimateItemId",JSONObject.NULL);
    if(!row.has("stageId"))row.put("stageId",JSONObject.NULL);
   }
  }
  String cover=p.optString("coverPhotoId","");if(!cover.isEmpty()&&!contains(p,cover))p.put("coverPhotoId",JSONObject.NULL);
  for(String name:new String[]{"photos","estimatePhotos"}){JSONArray a=array(p,name);for(int i=0;i<a.length();i++)a.getJSONObject(i).put("isCover",a.getJSONObject(i).optString("id").equals(p.optString("coverPhotoId")));}
 }
 static JSONObject find(JSONObject p,String id)throws Exception{for(String name:new String[]{"photos","estimatePhotos"}){JSONArray a=array(p,name);for(int i=0;i<a.length();i++)if(id.equals(a.getJSONObject(i).optString("id")))return a.getJSONObject(i);}throw new Exception("Фото не найдено");}
 static boolean contains(JSONObject p,String id){try{find(p,id);return true;}catch(Exception e){return false;}}
 static void link(JSONObject p,JSONObject row,JSONObject input)throws Exception{
  String estimate=input.optString("estimateId",""),item=input.optString("estimateItemId",""),stage=input.optString("stageId","");
  if(!estimate.isEmpty()){boolean found=false;JSONArray estimates=p.optJSONArray("estimates");if(estimates!=null)for(int i=0;i<estimates.length();i++)if(estimate.equals(estimates.getJSONObject(i).optString("id")))found=true;if(!found)throw new Exception("Смета не найдена");}
  if(!item.isEmpty()){if(estimate.isEmpty())throw new Exception("Для строки выберите смету");JSONObject e=null;JSONArray estimates=p.getJSONArray("estimates");for(int i=0;i<estimates.length();i++)if(estimate.equals(estimates.getJSONObject(i).optString("id")))e=estimates.getJSONObject(i);boolean found=false;if(e!=null)for(String key:new String[]{"lines","materials"}){JSONArray rows=e.optJSONArray(key);if(rows!=null)for(int i=0;i<rows.length();i++)if(item.equals(rows.getJSONObject(i).optString("id")))found=true;}if(!found)throw new Exception("Строка сметы не найдена");}
  if(!stage.isEmpty()){boolean found=false;JSONArray stages=p.optJSONArray("tasks");if(stages!=null)for(int i=0;i<stages.length();i++)if(stage.equals(stages.getJSONObject(i).optString("id")))found=true;if(!found)throw new Exception("Этап не найден");}
  row.put("estimateId",estimate.isEmpty()?JSONObject.NULL:estimate).put("estimateItemId",item.isEmpty()?JSONObject.NULL:item).put("stageId",stage.isEmpty()?JSONObject.NULL:stage);
 }
 static void remapIds(JSONObject p)throws Exception{
  java.util.HashMap<String,String> ids=new java.util.HashMap<>();
  for(String name:new String[]{"photos","estimatePhotos"}){JSONArray a=p.optJSONArray(name);if(a==null)continue;for(int i=0;i<a.length();i++){JSONObject row=a.getJSONObject(i);String old=row.getString("id"),fresh=UUID.randomUUID().toString();ids.put(old,fresh);row.put("id",fresh);}}
  String cover=p.optString("coverPhotoId","");p.put("coverPhotoId",ids.containsKey(cover)?ids.get(cover):JSONObject.NULL);
  JSONArray docs=p.optJSONArray("clientDocuments");if(docs!=null)for(int i=0;i<docs.length();i++){JSONObject snapshot=docs.getJSONObject(i).optJSONObject("snapshot");if(snapshot==null)continue;JSONObject settings=snapshot.optJSONObject("settings");if(settings==null)continue;String old=settings.optString("coverPhotoId","");if(ids.containsKey(old))settings.put("coverPhotoId",ids.get(old));JSONObject sections=settings.optJSONObject("sectionPhotoIds");if(sections!=null)for(java.util.Iterator<String> keys=sections.keys();keys.hasNext();){String key=keys.next(),value=sections.optString(key);if(ids.containsKey(value))sections.put(key,ids.get(value));}}
  normalize(p);
 }
}
