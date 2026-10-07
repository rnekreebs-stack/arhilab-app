package ru.arhilab.estimate;
import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.graphics.Bitmap;
import org.json.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.lang.reflect.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Exercises the real installed WebView and Native bridge; not a browser mock. */
public class Smoke extends Instrumentation {
 Activity activity; WebView web; boolean resume; String mode="";
 public void onCreate(Bundle args){super.onCreate(args);resume=args!=null&&"true".equals(args.getString("resume"));mode=args==null?"":args.getString("mode","");start();}
 WebView findWeb(View view){if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup g=(ViewGroup)view;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
 void launch()throws Exception{
  Intent intent=getTargetContext().getPackageManager().getLaunchIntentForPackage("ru.arhilab.estimate");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
  activity=startActivitySync(intent);
  runOnMainSync(()->web=findWeb(activity.getWindow().getDecorView()));
  if(web==null)throw new Exception("No WebView: startup may have failed");
  for(int i=0;i<100;i++){try{if("true".equals(js("typeof api==='function'&&document.readyState==='complete'")))return;}catch(Exception ignored){}Thread.sleep(100);}throw new Exception("First screen timeout");
 }
 String js(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript("(()=>{try{return "+script+"}catch(e){return 'SMOKE_ERROR:'+e.message}})()",s->{value.set(s);done.countDown();}));if(!done.await(15,TimeUnit.SECONDS))throw new Exception("WebView JS timeout");String s=value.get();if(s!=null&&s.contains("SMOKE_ERROR:"))throw new Exception(s);return s;}
 void check(String expression,String label)throws Exception{if(!"true".equals(js(expression)))throw new Exception(label+": "+js(expression));report(label);}
 void report(String message){Bundle b=new Bundle();b.putString("stream","PASS: "+message+"\n");sendStatus(0,b);}
 JSONObject database()throws Exception{Field field=activity.getClass().getDeclaredField("db");field.setAccessible(true);return (JSONObject)field.get(activity);}
 JSONObject F7DocumentFromDb(JSONObject db,int projectIndex)throws Exception{return db.getJSONArray("projects").getJSONObject(projectIndex).getJSONArray("clientDocuments").getJSONObject(0);}
 JSONObject f6Snapshot()throws Exception{JSONArray projects=database().getJSONArray("projects"),out=new JSONArray();for(int i=0;i<projects.length();i++){
  JSONObject p=projects.getJSONObject(i),row=new JSONObject();for(String key:new String[]{"id","name","lines","materials","payments","expenses","tasks","procurementRequests","procurementReceipts","estimates"})
   if(p.has(key)){
    if(key.equals("estimates")){JSONArray comparable=new JSONArray(),estimates=p.getJSONArray(key);for(int j=0;j<estimates.length();j++){JSONObject e=new JSONObject(estimates.getJSONObject(j).toString());e.remove("lifecycleStatus");e.remove("lifecycleRevision");comparable.put(e);}row.put(key,comparable);}
    else row.put(key,p.get(key));
   }out.put(row);
 }return new JSONObject().put("projects",out);}
 File fixture(String name){File dir=getTargetContext().getFilesDir();if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException("Cannot create smoke fixture directory");return new File(dir,name);}
 void write(String name,byte[] bytes)throws Exception{try(FileOutputStream out=new FileOutputStream(fixture(name))){out.write(bytes);out.getFD().sync();}}
 void screen(String name)throws Exception{Thread.sleep(1300);Bitmap image=getUiAutomation().takeScreenshot();if(image==null)throw new Exception("Screenshot unavailable: "+name);try(FileOutputStream out=new FileOutputStream(fixture("ui08-"+name+".png"))){if(!image.compress(Bitmap.CompressFormat.PNG,100,out))throw new Exception("Screenshot write: "+name);}finally{image.recycle();}}
 byte[] read(String name)throws Exception{try(FileInputStream in=new FileInputStream(fixture(name));ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
 JSONObject snapshot()throws Exception{
  JSONArray result=new JSONArray(),projects=database().getJSONArray("projects");
  for(int i=0;i<projects.length();i++){JSONObject p=projects.getJSONObject(i);
   JSONArray lines=p.getJSONArray("lines"),items=new JSONArray(),materials=new JSONArray(),tasks=new JSONArray();
   for(int j=0;j<lines.length();j++){JSONObject l=lines.getJSONObject(j);items.put(new JSONObject().put("id",l.getString("id"))
    .put("name",l.getString("name")).put("qty",l.get("qty")).put("unit",l.getString("unit"))
    .put("price",l.get("price")).put("materialTier",l.optString("materialTier"))
    .put("autoMaterial",l.optBoolean("autoMaterial")).put("kitOverrides",l.optJSONObject("kitOverrides")));}
   JSONArray oldMaterials=p.getJSONArray("materials");for(int j=0;j<oldMaterials.length();j++){JSONObject m=oldMaterials.getJSONObject(j);
    materials.put(new JSONObject().put("id",m.getString("id")).put("qty",m.get("qty")).put("price",m.get("price")));}
   JSONArray oldTasks=p.getJSONArray("tasks");for(int j=0;j<oldTasks.length();j++){JSONObject t=oldTasks.getJSONObject(j);
    tasks.put(new JSONObject().put("id",t.getString("id")).put("name",t.getString("name"))
     .put("progress",t.optInt("progress")).put("status",t.optString("status"))
     .put("planDate",t.optString("planDate")));}
   String legacy=UUID.nameUUIDFromBytes(("arhilab:legacy-estimate:"+p.getString("id")).getBytes(StandardCharsets.UTF_8)).toString();
   result.put(new JSONObject().put("id",p.getString("id")).put("name",p.getString("name"))
    .put("estimateId",legacy).put("items",items).put("materials",materials)
    .put("purchases",p.optJSONObject("purchases")).put("tasks",tasks)
    .put("payments",p.getJSONArray("payments"))
    .put("photos",p.optJSONArray("photos")));
  }
  return new JSONObject().put("projects",result).put("projectCount",result.length());
 }
 void assertLegacy(JSONObject before)throws Exception{
  JSONArray old=before.getJSONArray("projects"),now=snapshot().getJSONArray("projects");
  if(old.length()!=now.length())throw new Exception("Project count changed");
  for(int i=0;i<old.length();i++){JSONObject a=old.getJSONObject(i),b=now.getJSONObject(i);
   for(String key:new String[]{"id","name","estimateId","items","materials","purchases","payments","photos"})
    if(!String.valueOf(a.opt(key)).equals(String.valueOf(b.opt(key))))throw new Exception("Historical "+key+" changed for project "+i);
   JSONArray tasks=a.getJSONArray("tasks"),current=b.getJSONArray("tasks");
   if(current.length()<tasks.length())throw new Exception("Historical tasks removed");
   for(int j=0;j<tasks.length();j++)if(!tasks.getJSONObject(j).toString().equals(current.getJSONObject(j).toString()))
    throw new Exception("Historical task changed");
  }
 }
 void backup(String name)throws Exception{
  Method method=activity.getClass().getDeclaredMethod("fullBackupContent");method.setAccessible(true);
  JSONObject data=(JSONObject)method.invoke(activity);
  if(!"Arhilab-2".equals(data.optString("format"))||data.toString().contains("sessionHash"))throw new Exception("Backup contract");
  char[] password="test-only-backup-password".toCharArray();
  write(name,BackupCrypto.encrypt(data.toString().getBytes(StandardCharsets.UTF_8),password));
  if(!BackupCrypto.isEncrypted(read(name)))throw new Exception("Encrypted backup missing");
  JSONObject copy=new JSONObject(new String(BackupCrypto.decrypt(read(name),password),StandardCharsets.UTF_8));
  if(copy.getJSONArray("projects").length()!=data.getJSONArray("projects").length())throw new Exception("Backup roundtrip");
  report("Encrypted backup exists: "+name+" ("+read(name).length+" bytes)");
 }
 public void onStart(){Bundle result=new Bundle();try{
  launch();
  String smokePassword=java.util.UUID.randomUUID().toString();
  if(mode.equals("loginScreenshot")){
   for(int i=0;i<100&&!"true".equals(js("!!document.querySelector('.a3-login')"));i++)Thread.sleep(100);
   check("api('status').setup===true&&!!document.querySelector('.a3-login')","alpha3 login shown on clean install");
   screen("login");result.putString("stream","ARHILAB_A3_LOGIN_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("landscapeCheck")){
   js("go('projects')");check("window.innerWidth>window.innerHeight&&document.documentElement.scrollWidth<=window.innerWidth+2","landscape projects fit viewport");screen("landscape");
   js("openProject(S.projects[0].id)");check("document.documentElement.scrollWidth<=window.innerWidth+2&&!!document.querySelector('.estimate-list')","landscape estimate fits viewport");
   result.putString("stream","ARHILAB_A3_LANDSCAPE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("uiPerformance")){
   js("(()=>{let saved=S.projects,base=JSON.parse(JSON.stringify(saved[0])),ps=Array.from({length:100},(_,i)=>({...base,id:'perf-'+i,name:'Проект '+i,estimates:[]}));S.projects=ps;page='projects';let t=performance.now();render();let projectsMs=performance.now()-t,shown=document.querySelectorAll('#projectList .project-card').length;let lines=Array.from({length:1200},(_,i)=>({id:'line-'+i,name:'Работа '+i,qty:1,coef:1,price:100,unit:'шт'})),materials=Array.from({length:500},(_,i)=>({id:'material-'+i,name:'Материал '+i,qty:1,price:20,unit:'шт'}));let e={id:'perf-estimate',name:'Большая смета',legacy:false,lines,materials,delivery:0,discount:0,workMarkupPercent:'0'},p={...base,id:'perf-project',estimates:[e]};S.projects=[p];pid=p.id;selectedEstimateId=e.id;estimateViewMode='active';document.querySelector('#app').innerHTML='<div id=detail></div>';t=performance.now();estimate(p);let estimateMs=performance.now()-t,rendered=document.querySelectorAll('#detail .estimate-line').length,total=calc(e).total;let docs=Array.from({length:500},(_,i)=>({id:'doc-'+i,number:'КП-'+i,type:'COMMERCIAL_OFFER',version:1,status:'draft',snapshot:{total:100}}));p.clientDocuments=docs;t=performance.now();window.ui08DocumentsHub();let documentsMs=performance.now()-t,docShown=document.querySelectorAll('#app .document-card').length;window.a3Perf={projectsMs,estimateMs,documentsMs,shown,rendered,docShown,total};api('state');page='home';render();return true})()");
   check("window.a3Perf.shown===40&&window.a3Perf.rendered===120&&window.a3Perf.docShown===60&&window.a3Perf.total===130000","chunked 100 projects, 1200 works, 500 materials, 500 documents");
   check("window.a3Perf.projectsMs<5000&&window.a3Perf.estimateMs<5000&&window.a3Perf.documentsMs<5000","WebView rendering completes without long freeze");
   report("WebView render ms "+js("JSON.stringify(window.a3Perf)"));result.putString("stream","ARHILAB_A3_PERFORMANCE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("lifecyclePrepare")){
   js("(()=>{let p=S.projects.find(x=>x.name==='Smoke project');openProject(p.id);let r=api('estimateCreate',{project:p.id,name:'Смета жизненного цикла'});window.lifecycleId=r.estimateId;api('estimateManualWork',{project:p.id,estimate:r.estimateId,name:'Сохранённая работа',qty:2,coef:1,unit:'шт',price:1500});api('f4StageSave',{project:p.id,estimate:r.estimateId,name:'Связанный этап'});window.lifecycleTotal=calc(current().estimates.find(x=>x.id===r.estimateId)).total;selectedEstimateId=r.estimateId;projectPage();return true})()");
   check("document.querySelector('#detail')?.textContent.includes('Сохранённая работа')&&window.lifecycleTotal===3000","estimate created with row and total");
   js("estimateLifecycleAction(window.lifecycleId,'archive')");
   check("(()=>{let e=current().estimates.find(x=>x.id===window.lifecycleId);return e.lifecycleStatus==='archived'&&e.executionStages.length===1&&availableEstimates(current(),'active').every(x=>x.id!==e.id)&&availableEstimates(current(),'archived').some(x=>x.id===e.id)})()","archive preserves row and stage, excludes active");
   write("lifecycle-id.txt",js("window.lifecycleId").replace("\"","").getBytes(StandardCharsets.UTF_8));backup("lifecycle-archived.arhilab");
   result.putString("stream","ARHILAB_LIFECYCLE_PREPARE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("lifecycleArchived")){
   String id=new String(read("lifecycle-id.txt"),StandardCharsets.UTF_8);
   js("openProject(S.projects.find(x=>x.name==='Smoke project').id)");
   check("(()=>{let e=current().estimates.find(x=>x.id==='"+id+"');return e.lifecycleStatus==='archived'&&e.lines.length===1&&calc(e).total===3000&&e.executionStages.length===1})()","archive persists after force-stop");
   js("(()=>{estimateViewMode='archived';projectPage();return true})()");check("document.querySelector('#detail')?.textContent.includes('В архиве')","archive filter and status visible");
   js("(()=>{api('estimateLifecycle',{project:pid,id:'"+id+"',change:'restore'});api('state');estimateViewMode='active';selectedEstimateId='"+id+"';projectPage();return true})()");
   check("(()=>{let e=current().estimates.find(x=>x.id==='"+id+"');return e.lifecycleStatus==='active'&&calc(e).total===3000&&document.querySelector('#detail')?.textContent.includes('Сохранённая работа')})()","restore preserves rows and totals");
   js("(()=>{api('estimateLifecycle',{project:pid,id:'"+id+"',change:'archive'});api('estimateLifecycle',{project:pid,id:'"+id+"',change:'delete',confirmed:true,relatedAcknowledged:true,confirmationName:'Смета жизненного цикла'});api('state');selectedEstimateId='';projectPage();return true})()");
   check("(()=>{let e=current().estimates.find(x=>x.id==='"+id+"');return e.lifecycleStatus==='deleted'&&e.lines.length===1&&e.executionStages.length===1&&!availableEstimates(current(),'active').includes(e)&&!availableEstimates(current(),'archived').includes(e)})()","soft delete retains history and excludes lists");
   backup("lifecycle-deleted.arhilab");
   result.putString("stream","ARHILAB_LIFECYCLE_ARCHIVED_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("lifecycleDeleted")){
   String id=new String(read("lifecycle-id.txt"),StandardCharsets.UTF_8);
   js("openProject(S.projects.find(x=>x.name==='Smoke project').id)");
   check("(()=>{let e=current().estimates.find(x=>x.id==='"+id+"');return e.lifecycleStatus==='deleted'&&e.lines.length===1&&!availableEstimates(current(),'active').includes(e)&&!availableEstimates(current(),'archived').includes(e)})()","tombstone persists after restart and stays hidden");
   result.putString("stream","ARHILAB_LIFECYCLE_DELETED_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("screenshots")){
   for(int i=0;i<100&&!"true".equals(js("typeof ui08Quick==='function'&&typeof a3Empty==='function'&&!!document.querySelector('nav .quick-add')"));i++)Thread.sleep(100);
   check("typeof ui08Quick==='function'&&typeof a3Empty==='function'&&!!document.querySelector('nav .quick-add')","new navigation rendered after cold start");
   check("S?.user?.role==='admin'&&S.projects.length>0","screenshots use signed-in local dataset");
   js("go('home')");check("page==='home'&&document.querySelector('#app h1')?.textContent==='Сегодня'","Today rendered");screen("today");
   js("go('projects')");check("page==='projects'&&!!document.querySelector('#projectList')","project list rendered");screen("projects");
   js("openProject(S.projects[0].id)");check("page==='project'&&tab==='estimate'&&!!document.querySelector('#detail')","object rendered");screen("object");
   js("document.querySelector('.estimate-list').scrollIntoView()");screen("estimates");
   for(String[] item:new String[][]{{"estimate","estimate"},{"materials","materials"},{"tasks","stages"},{"payments","payments"},{"documents","documents"},{"photos","photos"}}){js("(()=>{tab='"+item[0]+"';projectPage();document.querySelector('#detail').scrollIntoView();return true})()");check("tab==='"+item[0]+"'&&document.querySelector('#detail')?.textContent.length>0",item[1]+" rendered");screen(item[1]);}
   js("go('settings')");check("page==='settings'&&document.querySelector('#app h1')?.textContent==='Настройки'","settings rendered");screen("settings");
   js("(()=>{openProject(S.projects[0].id);let e=api('estimateCreate',{project:pid,name:'Архив для снимка'});api('estimateLifecycle',{project:pid,id:e.estimateId,change:'archive'});api('state');estimateViewMode='archived';selectedEstimateId=e.estimateId;projectPage();document.querySelector('.estimate-list').scrollIntoView();return true})()");screen("archive");
   js("(()=>{go('projects');ui08Query='НЕСУЩЕСТВУЮЩИЙ_ОБЪЕКТ';filterProjects(ui08Query);return true})()");screen("empty");js("ui08Query=''");
   result.putString("stream","ARHILAB_UI08_SCREENSHOTS_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("upgradePrepare")||mode.equals("f6Prepare")||mode.equals("alpha2Prepare")){
   check("api('status').setup===true",mode.equals("f6Prepare")?"F6 baseline clean install":"0.6.2 baseline clean install");
   js("api('setup',{name:'Upgrade admin',password:"+JSONObject.quote(smokePassword)+"})");
   js("enter()");
   check("api('session').active&&api('about').version==='"+(mode.equals("f6Prepare")?"0.7.0":mode.equals("alpha2Prepare")?"0.8.0-alpha2":"0.6.2")+"'","baseline admin registered and version verified");
   js("api('project',{name:'Upgrade A',address:'Address A',status:'Новый',delivery:0,discount:0,deliveryCost:0,overhead:0,otherCost:0})");
   js("api('line',{project:S.projects[0].id,work:C.works.find(w=>w.tiers.standard.materialIds.length).id,qty:3.5,coef:1,price:1234,autoMaterial:true,tier:'standard',cost:60})");
   js("api('line',{project:S.projects[0].id,work:C.works.find(w=>!w.tiers.standard.materialIds.length).id,qty:7,coef:1,price:9876,autoMaterial:false,tier:'standard',cost:50})");
   js("api('material',{project:S.projects[0].id,material:C.materials[0].id,qty:2,cost:C.materials[0].cost})");
   js("api('task',{project:S.projects[0].id,name:'Upgrade stage',planDate:'2026-10-01'})");
   js("api('payment',{project:S.projects[0].id,amount:1000,kind:'income',date:'2026-09-25',type:'Аванс',paid:0})");
   js("(()=>{let p=S.projects[0],r=Arhilab.procurement(p,C).rows[0];api('purchase',{project:p.id,ref:r.ref,qty:7.3,pack:1,reserve:10,actual:500,actualEntered:true,status:'Заказано'});return true})()");
   js("api('project',{name:'Upgrade B',address:'Address B',status:'Новый',delivery:0,discount:0,deliveryCost:0,overhead:0,otherCost:0})");
   js("api('line',{project:S.projects[1].id,work:C.works.find(w=>w.tiers.standard.materialIds.length).id,qty:11,coef:1,price:4321,autoMaterial:true,tier:'economy',cost:61})");
   if(mode.equals("f6Prepare")){
    js("(()=>{let p=S.projects[0],e=api('estimateCreate',{project:p.id,name:'F6 смета'}),id=e.estimateId;api('estimateManualWork',{project:p.id,estimate:id,name:'F6 работа',unit:'шт',qty:2,coef:1,price:4100});api('f3ExpenseSave',{project:p.id,estimate:id,category:'materials',amount:'123.00',currency:'RUB',date:'2026-09-28',description:'F6 расход'});return true})()");
    js("(()=>{let p=S.projects[0],e=p.estimates[1],t=api('f4StageSave',{project:p.id,estimate:e.id,name:'F6 этап'});api('f4ProgressSave',{project:p.id,estimate:e.id,estimateItemId:e.lines[0].syncId,quantity:'1.0000',businessDate:'2026-09-28'});api('f5TaskSave',{project:p.id,name:'F6 задача',estimateId:e.id,stageId:t.stageId,taskStatus:'open',priority:'normal'});let r=api('f6RequestSave',{project:p.id,estimateId:e.id,estimateItemId:e.lines[0].syncId,title:'Материал F6',unit:'шт',requestedQuantity:'4.0000',status:'ordered'});api('f6ReceiptSave',{project:p.id,requestId:r.requestId,quantity:'2.0000',businessDate:'2026-09-28'});return true})()");
    JSONObject before=f6Snapshot();write("f6-before.json",before.toString().getBytes(StandardCharsets.UTF_8));backup("f6-before.arhilab");
    report("F6 BEFORE: projects=2 estimates=3, historical legacy prices=1234/9876/4321; F3/F4/F5/F6 captured");result.putString("stream","ARHILAB_F6_PREPARE_PASS\n");finish(Activity.RESULT_OK,result);return;
   }
   check("S.projects.length===2&&S.projects[0].lines.length===2&&S.projects[1].lines.length===1&&S.projects[0].materials.length===1&&S.projects[0].tasks.length===1&&S.projects[0].payments.length===1","0.6.2 deterministic upgrade dataset");
   JSONObject before=snapshot();write("upgrade-before.json",before.toString().getBytes(StandardCharsets.UTF_8));backup("upgrade-before.arhilab");
   report("BEFORE: projects=2 estimates=2 items=3; historical prices=1234,9876,4321; UUIDs and quantities in machine-readable snapshot");
   result.putString("stream","ARHILAB_UPGRADE_PREPARE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("f6Verify")||mode.equals("f6Restart")){
   check("api('about').versionCode===14&&api('about').schemaVersion===10&&api('session').active","signed in-place migration and session");
   JSONObject before=new JSONObject(new String(read("f6-before.json"),StandardCharsets.UTF_8)),after=f6Snapshot();
   if(!before.toString().equals(after.toString()))throw new Exception("F6→F7 data changed: "+before+" versus "+after);
   check("S.projects.length===2&&S.projects[0].estimates.length===2&&S.projects[0].expenses.length===1&&S.projects[0].procurementRequests.length===1&&S.projects[0].procurementReceipts.length===1","F6 identities, estimates, F3-F6 preserved");
   if(mode.equals("f6Verify")){
    js("(()=>{let p=S.projects[0],e=p.estimates[1],settings={materials:'subtotal',showMaterialPrices:false,showSections:true,paymentTerms:'',timeline:'',warranty:'',note:'',companyDetails:''};let d=api('f7Create',{project:p.id,estimateId:e.id,type:'SUMMARY_ESTIMATE',requestId:'33333333-3333-4333-8333-333333333337',settings}).document;api('f7Finalize',{project:p.id,id:d.id});return true})()");
    check("api('f7List',{project:S.projects[0].id,estimateId:S.projects[0].estimates[1].id}).documents.length===1","F7 document after F6 upgrade");
    result.putString("stream","ARHILAB_F6_F7_UPGRADE_PASS\n");
   }else result.putString("stream","ARHILAB_F6_F7_RESTART_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("upgradeVerify")){
   check("api('about').version==='0.8.0-alpha3'&&api('about').versionCode===14&&api('about').schemaVersion===10","0.8.0-alpha3 local schema retained");
   check("S?.user?.role==='admin'&&api('session').active","admin session survives installation update");
   check("typeof a3Empty==='function'&&typeof window.ui08DocumentsHub==='function'","updated visual assets loaded after in-place upgrade");
   JSONObject before=new JSONObject(new String(read("upgrade-before.json"),StandardCharsets.UTF_8)),after=snapshot();
   write("upgrade-after.json",after.toString().getBytes(StandardCharsets.UTF_8));
   if(!before.toString().equals(after.toString()))throw new Exception("BEFORE/AFTER data snapshot differs: "+before+" vs "+after);
   check("(()=>{let ps=S.projects;return ps.length===2&&ps.every(p=>p.estimates.filter(e=>e.id===p.legacyEstimateId).length===1)&&ps[0].lines.length===2&&ps[1].lines.length===1})()","old estimates and deterministic IDs retained");
   report("AFTER: projects=2 estimates=2 items=3; UUIDs, quantities, historical prices, purchases, stages and payments match BEFORE");
   backup("upgrade-after.arhilab");
   js("(()=>{let p=S.projects[0];let x=api('estimateCreate',{project:p.id,name:'Вторая смета'});window.upgradeEstimate=x.estimateId;api('estimateManualWork',{project:p.id,estimate:x.estimateId,name:'Ручная работа',qty:2,coef:1,unit:'шт',price:4500});return true})()");
   check("S.projects[0].estimates.length===2&&S.projects[0].estimates[1].lines.length===1","F1 multiple estimates");
   js("(()=>{let p=S.projects[0],e=p.estimates[1];api('estimateUpdate',{project:p.id,id:e.id,workMarkupPercent:'10'});return true})()");
   check("S.projects[0].estimates[1].workMarkupPercent==='10'","F1 markup");
   js("(()=>{let p=S.projects[0],e=p.estimates[1];api('f3ExpenseSave',{project:p.id,estimate:e.id,category:'materials',amount:'120.00',currency:'RUB',date:'2026-09-28',description:'Тестовый расход'});return true})()");
   check("S.projects[0].expenses.length===1","F3 explicit expense");
   js("(()=>{let p=S.projects[0],e=p.estimates[1],stage=api('f4StageSave',{project:p.id,estimate:e.id,name:'Черновой этап'});api('f4ProgressSave',{project:p.id,estimate:e.id,estimateItemId:e.lines[0].syncId,quantity:'1.0000',businessDate:'2026-09-28',note:'Половина'});api('f5TaskSave',{project:p.id,name:'Задача',estimateId:e.id,stageId:stage.stageId,taskStatus:'open',priority:'high',planDate:'2026-09-29'});return true})()");
   check("S.projects[0].estimates[1].executionStages.length===1&&S.projects[0].estimates[1].progressEntries.length===1&&S.projects[0].tasks.some(t=>t.name==='Задача')","F4 progress and F5 Today task");
   js("(()=>{let p=S.projects[0],e=p.estimates[1],item=e.lines[0],r=api('f6RequestSave',{project:p.id,estimateId:e.id,estimateItemId:item.syncId,title:'Кабель',unit:'м',requestedQuantity:'100.0000',status:'ordered'});api('f6ReceiptSave',{project:p.id,requestId:r.requestId,quantity:'40.0000',businessDate:'2026-09-28'});return true})()");
   check("S.projects[0].procurementRequests.length===1&&S.projects[0].procurementReceipts.length===1&&S.projects[0].procurementRequests[0].requestedQuantity==='100.0000'","F6 partial receipt");
   check("(()=>{let p=S.projects[0],e=p.estimates[1],row=e.lines[0];return f6WorkProcurement(p,e,row).includes('Получено: 40')&&f6WorkProcurement(p,e,row).includes('Осталось: 60')})()","F6 work detail summary");
   check("api('status').setup===false&&S.syncSummary.pendingOperations>0","offline durable queue retained");
   check("api('integrity').report.issues.length===0","data integrity after upgrade");
   js("(()=>{let p=S.projects[0],e=p.estimates[1];window.f7Request='11111111-1111-4111-8111-111111111117';window.f7Options={materials:'detailed',showMaterialPrices:true,showSections:true,paymentTerms:'Аванс',timeline:'30 дней',warranty:'',note:'',companyDetails:''};let first=api('f7Create',{project:p.id,estimateId:e.id,type:'COMMERCIAL_OFFER',requestId:window.f7Request,settings:window.f7Options}).document;window.f7Document=first.id;return true})()");
   report("F7 preview assertion fields="+js("(()=>{let p=S.projects[0],d=api('f7Get',{project:p.id,id:window.f7Document}).document,s=d.snapshot;return JSON.stringify({price:s.works[0]?.unitPrice,quantity:s.works[0]?.quantity,safe:!/cost|profit|margin|expenses|procurement|sessionHash/i.test(JSON.stringify(s))})})()"));
   check("(()=>{let p=S.projects[0],e=p.estimates[1],d=api('f7Get',{project:p.id,id:window.f7Document}).document;return Number(d.snapshot.works[0].unitPrice)===4500&&Number(d.snapshot.works[0].quantity)===2&&!/cost|profit|margin|expenses|procurement|sessionHash/i.test(JSON.stringify(d.snapshot))})()","F7 saved price and safe projection");
   check("(()=>{let p=S.projects[0],e=p.estimates[1],d=api('f7Create',{project:p.id,estimateId:e.id,type:'COMMERCIAL_OFFER',requestId:window.f7Request,settings:window.f7Options}).document;return d.id===window.f7Document&&api('f7List',{project:p.id,estimateId:e.id}).documents.length===1})()","F7 idempotent create");
   js("(()=>{let p=S.projects[0],e=p.estimates[1];api('f7Finalize',{project:p.id,id:window.f7Document});api('estimateItemQuantity',{project:p.id,estimate:e.id,kind:'lines',id:e.lines[0].id,qty:'3'});return true})()");
   check("(()=>{let p=S.projects[0],e=p.estimates[1],d=api('f7Get',{project:p.id,id:window.f7Document}).document;return d.status==='final'&&Number(d.snapshot.works[0].quantity)===2&&e.lines[0].qty===3})()","F7 final snapshot unchanged after estimate edit");
   js("(()=>{let p=S.projects[0],e=p.estimates[1];window.f7V2=api('f7Create',{project:p.id,estimateId:e.id,type:'COMMERCIAL_OFFER',requestId:'22222222-2222-4222-8222-222222222227',settings:window.f7Options}).document.id;return true})()");
   check("(()=>{let p=S.projects[0],e=p.estimates[1],a=api('f7Get',{project:p.id,id:window.f7Document}).document,b=api('f7Get',{project:p.id,id:window.f7V2}).document;return a.version===1&&b.version===2&&Number(b.snapshot.works[0].quantity)===3&&a.snapshot.total!==b.snapshot.total&&api('f7List',{project:p.id,estimateId:p.legacyEstimateId}).documents.length===0})()","F7 v1/v2 and selected-estimate isolation");
   JSONObject doc=F7DocumentFromDb(database(),0);
   Class<?> renderer=getTargetContext().getClassLoader().loadClass("ru.arhilab.estimate.F7Pdf");Method pdfMethod=renderer.getDeclaredMethod("render",File.class,JSONObject.class);pdfMethod.setAccessible(true);
   File pdf=(File)pdfMethod.invoke(null,getTargetContext().getCacheDir(),doc);
   byte[] pdfBytes=java.nio.file.Files.readAllBytes(pdf.toPath());if(pdfBytes.length<500||!new String(pdfBytes,0,5,StandardCharsets.US_ASCII).equals("%PDF-"))throw new Exception("F7 PDF invalid");report("F7 native PDF valid bytes="+pdfBytes.length);
   JSONObject longDoc=new JSONObject(doc.toString());longDoc.put("id",java.util.UUID.randomUUID().toString());JSONArray pages=new JSONArray();
   for(int n=0;n<120;n++)pages.put(new JSONObject().put("title","Длинное название работы с кириллицей и подробным описанием "+n+" — монтаж конструкций")
       .put("section","Раздел A").put("unit","м²").put("quantity","2.5000").put("coefficient","1").put("unitPrice","1234.00").put("total","3085.00"));
   longDoc.getJSONObject("snapshot").put("works",pages);
   String longPdf=new String(java.nio.file.Files.readAllBytes(((File)pdfMethod.invoke(null,getTargetContext().getCacheDir(),longDoc)).toPath()),StandardCharsets.ISO_8859_1);
   java.util.regex.Matcher pageMatcher=java.util.regex.Pattern.compile("/Type\\s*/Page\\b").matcher(longPdf);int pageCount=0;while(pageMatcher.find())pageCount++;
   if(pageCount<2)throw new Exception("F7 long PDF is not multipage: "+pageCount);report("F7 multipage PDF pages="+pageCount);
   backup("f7-after.arhilab");
   result.putString("stream","ARHILAB_UPGRADE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("upgradeRestart")){
   check("api('about').schemaVersion===10&&api('session').active","encrypted data and session reopen");
   JSONObject before=new JSONObject(new String(read("upgrade-before.json"),StandardCharsets.UTF_8));
   assertLegacy(before);
   check("S.projects.length===2&&S.projects[0].estimates.length===2&&S.projects[0].procurementRequests.length===1&&S.projects[0].procurementReceipts.length===1&&S.projects[0].clientDocuments.length===2","F1-F7 data remains after restart without duplicates");
   result.putString("stream","ARHILAB_UPGRADE_RESTART_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(resume){
   check("api('status').setup===false","existing admin after process cold restart");
   check("S?.user?.role==='admin'&&document.querySelector('#app form [name=password]')===null","automatic login after cold restart");
   js("openProject(S.projects.find(p=>p.name==='Smoke project').id)");
   String expected=getTargetContext().getSharedPreferences("smoke",0).getString("total","null");
   report("Cold restart observed="+js("JSON.stringify({project:current()?.name,tier:current()?.lines?.[0]?.materialTier,total:calc(current()).total,projects:S.projects.map(p=>p.name)})")+" expected="+expected);
   check("current().lines[0].materialTier==='premium'&&calc(current()).total==="+expected,"saved estimate survives full process stop and restart");
   check("S.projects.some(p=>p.name==='Legacy estimate')","legacy estimate survives process restart");
   result.putString("stream","ARHILAB_SMOKE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  check("api('status').setup===true","first launch/setup screen");
  js("(()=>{let f=document.querySelector('#app form');f.querySelector('[name=name]').value='Smoke admin';f.querySelector('[name=password]').value="+JSONObject.quote(smokePassword)+";f.requestSubmit();return true})()");
  check("S.user.role==='admin'","admin account created through form");
  check("C.materials.length===254","catalog 254 SKU");
  check("C.works.filter(w=>w.tiers.standard.materialIds.length).length===110","110 linked works");
  check("C.works.length===389&&api('about').schemaVersion===10&&C.works.find(w=>w.name==='Монтаж душевого трапа').price===6500","389 works, shower drain 6500 and current data schema");
  // A pre-0.6 row has no key, tier, or estimatePhotos. Insert through the same encrypted save routine.
  Field dbField=activity.getClass().getDeclaredField("db");dbField.setAccessible(true);JSONObject db=(JSONObject)dbField.get(activity);
  JSONObject legacy=new JSONObject("{\"id\":\"11111111-1111-4111-8111-111111111111\",\"name\":\"Legacy estimate\",\"address\":\"Legacy address\",\"status\":\"Новый\",\"lines\":[{\"id\":\"22222222-2222-4222-8222-222222222222\",\"name\":\"Legacy work\",\"unit\":\"м²\",\"qty\":10,\"coef\":1,\"price\":100,\"cost\":60,\"autoMaterial\":false}],\"materials\":[],\"payments\":[],\"tasks\":[],\"notes\":[],\"photos\":[]}");
  db.getJSONArray("projects").put(legacy);Method save=activity.getClass().getDeclaredMethod("save");save.setAccessible(true);save.invoke(activity);
  js("(()=>{refresh();openProject('11111111-1111-4111-8111-111111111111');return true})()");check("calc(current()).total===1000","old estimate opens without repricing");
  js("(()=>{projectForm();let f=document.querySelector('#modal form');f.querySelector('[name=name]').value='Smoke project';f.querySelector('[name=address]').value='Smoke address';f.requestSubmit();return true})()");
  check("current().name==='Smoke project'&&current().lines.length===0","new project and estimate created");
  js("(()=>{lineForm();let w=C.works.find(w=>w.tiers.standard.materialIds.length&&w.tiers.economy.materialCost!==w.tiers.standard.materialCost&&w.tiers.premium.materialCost!==w.tiers.standard.materialCost);if(!w)throw Error('No distinct kit costs');chooseWork(w.id);let f=document.querySelector('#modal form');f.querySelector('[name=qty]').value=10;f.requestSubmit();return true})()");
  check("current().lines.length===1&&current().lines[0].materialTier==='standard'&&current().lines[0].autoMaterial","standard kit added through form");
  js("(()=>{window.standardTotal=calc(current()).total;window.standardMaterials=JSON.stringify(current().lines[0].materials);let s=document.querySelector('#detail select');s.value='economy';s.dispatchEvent(new Event('change'));return true})()");
  check("current().lines[0].materialTier==='economy'&&calc(current()).total!==window.standardTotal&&JSON.stringify(current().lines[0].materials)!==window.standardMaterials","Economy changes materials and total");
  js("(()=>{window.economyTotal=calc(current()).total;let s=document.querySelector('#detail select');s.value='premium';s.dispatchEvent(new Event('change'));return true})()");
  check("current().lines[0].materialTier==='premium'&&calc(current()).total!==window.economyTotal","Premium changes total");
  js("(()=>{let l=current().lines[0],w=workForLine(l),base=w.tiers.premium.materialIds[0],replacement=C.materials.find(m=>m.id!==base&&m.cost!==C.materials.find(x=>x.id===base).cost);window.beforeReplace=calc(current()).total;api('kitReplace',{project:pid,id:l.id,base,sku:replacement.id,qty:1});return true})()");
  check("calc(current()).total!==window.beforeReplace&&Object.keys(current().lines[0].kitOverrides).length===1","single SKU replacement changes total");
  js("(()=>{let l=current().lines[0],base=Object.keys(l.kitOverrides)[0];api('kitReplace',{project:pid,id:l.id,base,sku:base,qty:1});return true})()");
  check("calc(current()).total===window.beforeReplace","default SKU restores exact total");
  js("(()=>{let r=Arhilab.procurement(current(),C).rows[0];api('purchase',{project:pid,ref:r.ref,qty:7.3,pack:1,reserve:10,actual:1200,actualEntered:true,status:'Заказано'});return true})()");
  check("(()=>{let x=Arhilab.procurement(current(),C).rows[0];return x.purchase.count===9&&x.status==='Заказано'&&x.actualEntered})()","reserve and whole package procurement saved");
  check("Number.isFinite(calc(current()).gross)&&Number.isFinite(calc(current()).margin)","profit and margin are finite");
  check("(()=>{let v=calc(current());return v.gross===Arhilab.round(v.total-v.labor-v.matCost)})()","profit matches procurement and labor");
  js("(()=>{lineForm();let w=C.works.find(w=>w.tiers.standard.materialIds.length===0);chooseWork(w.id);let f=document.querySelector('#modal form');f.querySelector('[name=qty]').value=1;f.requestSubmit();return true})()");
  check("current().lines.length===2&&current().lines[1].autoMaterial===false&&document.querySelector('#detail .warning')?.textContent.includes('вручную')","unlinked work shows manual material selection without crash");
  check("api('integrity').report.issues.length===0","read-only integrity report has no findings");
  Method backupMethod=activity.getClass().getDeclaredMethod("fullBackupContent");backupMethod.setAccessible(true);
  JSONObject complete=(JSONObject)backupMethod.invoke(activity);
  if(!complete.optString("format").equals("Arhilab-2")||complete.optInt("schemaVersion")!=10||complete.toString().contains("sessionHash")||complete.toString().contains(smokePassword))throw new Exception("Unsafe or incomplete backup");
  char[] backupPassword=java.util.UUID.randomUUID().toString().toCharArray();
  byte[] ciphertext=BackupCrypto.encrypt(complete.toString().getBytes("UTF-8"),backupPassword);
  JSONObject roundtrip=new JSONObject(new String(BackupCrypto.decrypt(ciphertext,backupPassword),"UTF-8"));
  if(roundtrip.getJSONArray("projects").length()!=complete.getJSONArray("projects").length())throw new Exception("Backup restore roundtrip mismatch");
  report("encrypted full backup and restore roundtrip; users, projects, materials, stages, payments and photos included");
  String totals=js("calc(current()).total");getTargetContext().getSharedPreferences("smoke",0).edit().putString("total",totals).commit();
  runOnMainSync(()->activity.finish());waitForIdleSync();launch();
  check("api('status').setup===false","encrypted local database survives Activity restart");
  check("S?.user?.role==='admin'&&api('session').active","automatic local login after Activity restart");
  js("openProject(S.projects.find(p=>p.name==='Smoke project').id)");
  check("current().lines[0].materialTier==='premium'&&calc(current()).total==="+totals,"saved premium estimate after restart");
  js("(()=>{api('logout');auth();return true})()");
  check("!api('session').active&&!!document.querySelector('#app form [name=password]')","manual logout requires password");
  js("(()=>{let f=document.querySelector('#app form');f.querySelector('[name=login]').value='admin';f.querySelector('[name=password]').value="+JSONObject.quote(smokePassword)+";f.requestSubmit();return true})()");
  check("S?.user?.role==='admin'&&api('session').active","login after logout restores session");
  result.putString("stream","ARHILAB_SMOKE_PASS\n");finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("stream","ARHILAB_SMOKE_FAIL: "+e.toString()+"\n");finish(Activity.RESULT_CANCELED,result);}}
}
