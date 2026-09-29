package ru.arhilab.estimate;
import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.*;
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
  for(int i=0;i<100;i++){try{if("true".equals(js("typeof api==='function'")))return;}catch(Exception ignored){}Thread.sleep(100);}throw new Exception("First screen timeout");
 }
 String js(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript("(()=>{try{return "+script+"}catch(e){return 'SMOKE_ERROR:'+e.message}})()",s->{value.set(s);done.countDown();}));if(!done.await(15,TimeUnit.SECONDS))throw new Exception("WebView JS timeout");String s=value.get();if(s!=null&&s.contains("SMOKE_ERROR:"))throw new Exception(s);return s;}
 void check(String expression,String label)throws Exception{if(!"true".equals(js(expression)))throw new Exception(label+": "+js(expression));report(label);}
 void report(String message){Bundle b=new Bundle();b.putString("stream","PASS: "+message+"\n");sendStatus(0,b);}
 JSONObject database()throws Exception{Field field=activity.getClass().getDeclaredField("db");field.setAccessible(true);return (JSONObject)field.get(activity);}
 File fixture(String name){File dir=getContext().getFilesDir();if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException("Cannot create smoke fixture directory");return new File(dir,name);}
 void write(String name,byte[] bytes)throws Exception{try(FileOutputStream out=new FileOutputStream(fixture(name))){out.write(bytes);out.getFD().sync();}}
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
  if(mode.equals("upgradePrepare")){
   check("api('status').setup===true","0.6.2 baseline clean install");
   js("api('setup',{name:'Upgrade admin',password:"+JSONObject.quote(smokePassword)+"})");
   js("enter()");
   check("api('session').active&&api('about').version==='0.6.2'","0.6.2 admin registered and version verified");
   js("api('project',{name:'Upgrade A',address:'Address A',status:'Новый',delivery:0,discount:0,deliveryCost:0,overhead:0,otherCost:0})");
   js("api('line',{project:S.projects[0].id,work:C.works.find(w=>w.tiers.standard.materialIds.length).id,qty:3.5,coef:1,price:1234,autoMaterial:true,tier:'standard',cost:60})");
   js("api('line',{project:S.projects[0].id,work:C.works.find(w=>!w.tiers.standard.materialIds.length).id,qty:7,coef:1,price:9876,autoMaterial:false,tier:'standard',cost:50})");
   js("api('material',{project:S.projects[0].id,material:C.materials[0].id,qty:2,cost:C.materials[0].cost})");
   js("api('task',{project:S.projects[0].id,name:'Upgrade stage',planDate:'2026-10-01'})");
   js("api('payment',{project:S.projects[0].id,amount:1000,kind:'income',date:'2026-09-25',type:'Аванс',paid:0})");
   js("(()=>{let p=S.projects[0],r=Arhilab.procurement(p,C).rows[0];api('purchase',{project:p.id,ref:r.ref,qty:7.3,pack:1,reserve:10,actual:500,actualEntered:true,status:'Заказано'});return true})()");
   js("api('project',{name:'Upgrade B',address:'Address B',status:'Новый',delivery:0,discount:0,deliveryCost:0,overhead:0,otherCost:0})");
   js("api('line',{project:S.projects[1].id,work:C.works.find(w=>w.tiers.standard.materialIds.length).id,qty:11,coef:1,price:4321,autoMaterial:true,tier:'economy',cost:61})");
   check("S.projects.length===2&&S.projects[0].lines.length===2&&S.projects[1].lines.length===1&&S.projects[0].materials.length===1&&S.projects[0].tasks.length===1&&S.projects[0].payments.length===1","0.6.2 deterministic upgrade dataset");
   JSONObject before=snapshot();write("upgrade-before.json",before.toString().getBytes(StandardCharsets.UTF_8));backup("upgrade-before.arhilab");
   report("BEFORE: projects=2 estimates=2 items=3; historical prices=1234,9876,4321; UUIDs and quantities in machine-readable snapshot");
   result.putString("stream","ARHILAB_UPGRADE_PREPARE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("upgradeVerify")){
   check("api('about').version==='0.7.0'&&api('about').versionCode===10&&api('about').schemaVersion===8","0.7.0 schema migrated");
   check("S?.user?.role==='admin'&&api('session').active","admin session survives installation update");
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
   result.putString("stream","ARHILAB_UPGRADE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("upgradeRestart")){
   check("api('about').schemaVersion===8&&api('session').active","encrypted data and session reopen");
   JSONObject before=new JSONObject(new String(read("upgrade-before.json"),StandardCharsets.UTF_8));
   assertLegacy(before);
   check("S.projects.length===2&&S.projects[0].estimates.length===2&&S.projects[0].procurementRequests.length===1&&S.projects[0].procurementReceipts.length===1","F1-F6 data remains after restart without duplicates");
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
  check("C.works.length===389&&api('about').schemaVersion===8&&C.works.find(w=>w.name==='Монтаж душевого трапа').price===6500","389 works, shower drain 6500 and current data schema");
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
  if(!complete.optString("format").equals("Arhilab-2")||complete.optInt("schemaVersion")!=8||complete.toString().contains("sessionHash")||complete.toString().contains(smokePassword))throw new Exception("Unsafe or incomplete backup");
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
