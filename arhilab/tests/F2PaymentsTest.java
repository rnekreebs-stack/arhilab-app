package ru.arhilab.estimate;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F2PaymentsTest {
    private static void check(boolean test, String label) { if(!test)throw new AssertionError(label); }
    public static void main(String[] args) throws Exception {
        String projectId=UUID.randomUUID().toString(),paymentId=UUID.randomUUID().toString();
        JSONObject oldPayment=new JSONObject().put("id",paymentId).put("kind","income")
            .put("amount","50000.00").put("paid","30000.00").put("date","2026-09-27")
            .put("planDate","2026-10-01").put("note","Первый этап");
        JSONObject project=new JSONObject().put("id",projectId).put("name","Объект")
            .put("payments",new JSONArray().put(oldPayment)).put("lines",new JSONArray())
            .put("materials",new JSONArray());
        JSONObject db=new JSONObject().put("schemaVersion",3).put("users",new JSONArray())
            .put("projects",new JSONArray().put(project));
        db=DataMigration.migrate(db);project=db.getJSONArray("projects").getJSONObject(0);
        oldPayment=project.getJSONArray("payments").getJSONObject(0);
        JSONObject estimate=project.getJSONArray("estimates").getJSONObject(0);
        check(!oldPayment.has("currency")&&!oldPayment.has("estimateId"),"old currency/owner was invented");
        check(F2Payments.summary(estimate,project.getJSONArray("payments"),"100000.00")
            .getBoolean("currencyRequired"),"unresolved old estimate must block balance");
        F1SyncLedger.capture(db);
        check(db.getJSONObject("f1Sync").getBoolean("paymentCurrencyRequired"),"missing currency not visible");
        check(db.getJSONObject("f1Sync").getJSONArray("operations").length()==2,"unresolved payment was queued");
        estimate.put("currency","EUR");
        oldPayment.put("currency","EUR").put("estimateId",estimate.getString("id"));
        F1SyncLedger.capture(db);
        JSONArray jobs=db.getJSONObject("f1Sync").getJSONArray("operations");
        check(jobs.length()==4,"payment/estimate were not queued");
        JSONObject pending=null;for(int i=0;i<jobs.length();i++)if(jobs.getJSONObject(i).getString("entityType").equals("payment"))pending=jobs.getJSONObject(i);
        check(pending!=null&&pending.getJSONObject("payload").getString("paidAmount").equals("30000.00"),"planned amount replaced paid amount");
        JSONObject restarted=new JSONObject(db.toString());F1SyncLedger.capture(restarted);
        JSONArray repeated=restarted.getJSONObject("f1Sync").getJSONArray("operations");
        check(repeated.length()==jobs.length(),"retry duplicated payment");
        check(repeated.getJSONObject(repeated.length()-1).getString("idempotencyKey")
            .equals(pending.getString("idempotencyKey")),"restart changed payment operation");
        JSONObject amounts=F2Payments.summary(estimate,project.getJSONArray("payments"),"100000.00");
        check(amounts.getString("paid").equals("30000.00")&&amounts.getString("remaining").equals("70000.00"),"old partial receipt total changed");
        oldPayment.put("paid","50000.00");
        check(F2Payments.summary(estimate,project.getJSONArray("payments"),"100000.00").getString("remaining").equals("50000.00"),"edit not recalculated");
        check(F2Payments.amount("0.01").equals("0.01"),"smallest amount");
        try{F2Payments.amount("-1");throw new AssertionError("negative accepted");}catch(IllegalArgumentException expected){}
        if(args.length>0) {
            JSONArray operations=new JSONArray();
            for(int i=0;i<jobs.length();i++){
                JSONObject operation=new JSONObject(jobs.getJSONObject(i).toString());operation.remove("state");operations.put(operation);
            }
            java.nio.file.Files.write(java.nio.file.Paths.get(args[0]),
                new JSONObject().put("operations",operations).put("paymentId",paymentId)
                    .put("estimateId",estimate.getString("id")).put("projectId",projectId)
                    .toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        JSONObject oldEdit=new JSONObject(oldPayment.toString());
        F2Payments.edit(oldEdit,"35000.00","2026-09-28","Исправлено");
        check(oldEdit.getString("amount").equals("50000.00")&&oldEdit.getString("paid").equals("35000.00"),
            "editing old received amount changed its original planned amount");
        F2Payments.edit(oldEdit,"0","2026-09-28","");
        check(oldEdit.getString("paid").equals("0.00"),"old planned payment cannot return to unpaid state");
        JSONObject newEdit=new JSONObject().put("amount","100.00").put("paid","100.00");
        F2Payments.edit(newEdit,"110.00","2026-09-28","");
        check(newEdit.getString("amount").equals("110.00")&&newEdit.getString("paid").equals("110.00"),
            "editing new payment did not change the received amount");
        JSONObject edited=new JSONObject(db.toString());
        JSONObject changed=edited.getJSONArray("projects").getJSONObject(0).getJSONArray("payments").getJSONObject(0);
        changed.put("amount","55000.00").put("paid","55000.00");
        F1SyncLedger.capture(edited);
        check(edited.getJSONObject("f1Sync").getJSONArray("operations").length()==5,"payment edit not queued");
        edited.getJSONArray("projects").getJSONObject(0).getJSONArray("payments").remove(0);
        F1SyncLedger.capture(edited);
        JSONArray afterDelete=edited.getJSONObject("f1Sync").getJSONArray("operations");
        check(afterDelete.length()==6 && afterDelete.getJSONObject(5).getString("operationType").equals("delete"),
            "payment tombstone not queued");
        check(new JSONObject(new JSONObject(db.toString()).toString()).getJSONArray("projects")
            .getJSONObject(0).getJSONArray("payments").length()==1,"payment lost on backup/restart copy");
        System.out.println("F2 Android payment migration, currency, encrypted-queue payload and restart passed");
    }
}
