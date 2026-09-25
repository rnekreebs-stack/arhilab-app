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
 public void onStart(){Bundle result=new Bundle();try{
  launch();
  if(mode.equals("upgradePrepare")){
   check("api('status').setup===true","0.6.1 baseline clean install");
   js("api('setup',{name:'Upgrade admin',password:'upgrade-password-2026'})");
   js("enter()");
   check("api('session').active","0.6.1 admin registered");
   js("api('project',{name:'Upgrade project',address:'Upgrade address',status:'Новый',delivery:0,discount:0,deliveryCost:0,overhead:0,otherCost:0})");
   js("api('line',{project:S.projects[0].id,work:C.works.find(w=>w.tiers.standard.materialIds.length).id,qty:3,coef:1,price:100,autoMaterial:true,tier:'standard',cost:60})");
   js("api('material',{project:S.projects[0].id,material:C.materials[0].id,qty:2,cost:C.materials[0].cost})");
   js("api('task',{project:S.projects[0].id,name:'Upgrade stage',planDate:'2026-10-01'})");
   js("api('payment',{project:S.projects[0].id,amount:1000,kind:'income',date:'2026-09-25',type:'Аванс',paid:0})");
   check("S.projects[0].lines.length===1&&S.projects[0].materials.length===1&&S.projects[0].tasks.length===1&&S.projects[0].payments.length===1","0.6.1 upgrade fixture saved");
   result.putString("stream","ARHILAB_UPGRADE_PREPARE_PASS\n");finish(Activity.RESULT_OK,result);return;
  }
  if(mode.equals("upgradeVerify")){
   check("api('about').version==='0.6.2'&&api('about').schemaVersion===2","0.6.2 schema migrated");
   check("S?.user?.role==='admin'&&api('session').active","admin session survives installation update");
   check("(()=>{let p=S.projects.find(p=>p.name==='Upgrade project');return !!p&&p.lines.length===1&&p.materials.length===1&&p.tasks[0].name==='Upgrade stage'&&p.payments[0].amount===1000})()","objects, estimates, materials, stages and payments preserved");
   check("api('integrity').report.issues.length===0","data integrity after upgrade");
   result.putString("stream","ARHILAB_UPGRADE_PASS\n");finish(Activity.RESULT_OK,result);return;
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
  js("(()=>{let f=document.querySelector('#app form');f.querySelector('[name=name]').value='Smoke admin';f.querySelector('[name=password]').value='smoke-password-2026';f.requestSubmit();return true})()");
  check("S.user.role==='admin'","admin account created through form");
  check("C.materials.length===254","catalog 254 SKU");
  check("C.works.filter(w=>w.tiers.standard.materialIds.length).length===110","110 linked works and 261 manual works");
  check("C.works.length===371&&api('about').schemaVersion===2","371 works and current data schema");
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
  if(!complete.optString("format").equals("Arhilab-2")||complete.optInt("schemaVersion")!=2||complete.toString().contains("sessionHash")||complete.toString().contains("smoke-password-2026"))throw new Exception("Unsafe or incomplete backup");
  char[] backupPassword="separate-backup-2026".toCharArray();
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
  js("(()=>{let f=document.querySelector('#app form');f.querySelector('[name=login]').value='admin';f.querySelector('[name=password]').value='smoke-password-2026';f.requestSubmit();return true})()");
  check("S?.user?.role==='admin'&&api('session').active","login after logout restores session");
  result.putString("stream","ARHILAB_SMOKE_PASS\n");finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("stream","ARHILAB_SMOKE_FAIL: "+e.toString()+"\n");finish(Activity.RESULT_CANCELED,result);}}
}
