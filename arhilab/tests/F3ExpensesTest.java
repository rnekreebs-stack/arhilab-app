package ru.arhilab.estimate;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public final class F3ExpensesTest {
    private static void check(boolean valid,String name){if(!valid)throw new AssertionError(name);}
    public static void main(String[] args) throws Exception {
        String projectId=UUID.randomUUID().toString(),expenseId=UUID.randomUUID().toString(),paymentId=UUID.randomUUID().toString();
        JSONObject project=new JSONObject().put("id",projectId).put("name","Объект с расходами")
            .put("lines",new JSONArray()).put("materials",new JSONArray()).put("payments",new JSONArray());
        JSONObject db=DataMigration.migrate(new JSONObject().put("schemaVersion",3).put("users",new JSONArray())
            .put("projects",new JSONArray().put(project)));
        project=db.getJSONArray("projects").getJSONObject(0);
        String estimateId=project.getString("legacyEstimateId");
        project.getJSONArray("estimates").getJSONObject(0).put("currency","EUR");
        check(project.getJSONArray("expenses").length()==0&&db.getInt("schemaVersion")==DataMigration.CURRENT,"upgrade dropped expenses");
        JSONObject expense=new JSONObject().put("id",expenseId).put("estimateId",estimateId)
            .put("category","materials").put("amount","210000.00").put("currency","EUR")
            .put("date","2026-09-27").put("description","Закупка материалов").put("note","");
        F3Expenses.validate(expense);project.getJSONArray("expenses").put(expense);
        project.getJSONArray("payments").put(new JSONObject().put("id",paymentId).put("estimateId",estimateId)
            .put("kind","income").put("amount","400000.00").put("paid","400000.00")
            .put("currency","EUR").put("date","2026-09-27"));
        JSONObject summary=F3Expenses.summary(estimateId,"EUR","1000000.00","400000.00",project.getJSONArray("expenses"));
        check(summary.getString("cashResult").equals("190000.00")&&summary.getString("forecastGrossProfit").equals("790000.00")
            &&summary.getString("forecastMarginPercent").equals("79.00"),"money formula");
        check(F3Expenses.projectTotals(project.getJSONArray("expenses")).getString("EUR").equals("210000.00"),"project currency totals");
        JSONObject restored=DataMigration.migrate(new JSONObject().put("schemaVersion",DataMigration.CURRENT)
            .put("users",new JSONArray()).put("projects",new JSONArray(db.getJSONArray("projects").toString())));
        JSONObject restoredExpense=restored.getJSONArray("projects").getJSONObject(0).getJSONArray("expenses").getJSONObject(0);
        check(restoredExpense.getString("id").equals(expenseId)
            &&F3Expenses.summary(estimateId,"EUR","1000000.00","400000.00",
                restored.getJSONArray("projects").getJSONObject(0).getJSONArray("expenses"))
                .getString("cashResult").equals("190000.00"),"new backup/restore changed expense or totals");
        for(String amount:new String[]{"0","-1","NaN","1.234"}){
            try{F3Expenses.validate(new JSONObject(expense.toString()).put("amount",amount));throw new AssertionError("accepted "+amount);}
            catch(IllegalArgumentException expected){}
        }
        F1SyncLedger.capture(db);
        JSONArray operations=db.getJSONObject("f1Sync").getJSONArray("operations");
        check(operations.length()==4,"project, estimate, payment, expense dependency order");
        check(operations.getJSONObject(3).getString("entityType").equals("expense"),"expense operation absent");
        JSONObject restarted=DataMigration.migrate(new JSONObject(db.toString()));F1SyncLedger.capture(restarted);
        JSONArray pending=restarted.getJSONObject("f1Sync").getJSONArray("operations");
        check(pending.length()==4&&pending.getJSONObject(3).getString("idempotencyKey")
            .equals(operations.getJSONObject(3).getString("idempotencyKey")),"restart duplicated expense");
        JSONObject acknowledged=new JSONObject(restarted.toString());
        for(int i=0;i<pending.length();i++)F1SyncLedger.acknowledge(acknowledged,
            new JSONObject().put("operationId",pending.getJSONObject(i).getString("operationId"))
                .put("status","applied").put("resultingRevision",1));
        acknowledged=new JSONObject(acknowledged.toString());F1SyncLedger.capture(acknowledged);
        check(acknowledged.getJSONObject("f1Sync").getJSONArray("operations").length()==0
            &&acknowledged.getJSONArray("projects").getJSONObject(0).getJSONArray("expenses").length()==1,
            "response acknowledgement did not clear queue or duplicated expense after restart");
        if(args.length>0){JSONArray submitted=new JSONArray();for(int i=0;i<pending.length();i++){
            JSONObject op=new JSONObject(pending.getJSONObject(i).toString());op.remove("state");submitted.put(op);
        }java.nio.file.Files.write(java.nio.file.Paths.get(args[0]),new JSONObject()
            .put("operations",submitted).put("projectId",projectId).put("estimateId",estimateId)
            .put("expenseId",expenseId).put("paymentId",paymentId).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        JSONObject deviceB=new JSONObject().put("schemaVersion",5).put("users",new JSONArray()).put("projects",new JSONArray());
        for(int i=0;i<4;i++){
            JSONObject operation=pending.getJSONObject(i),snapshot=new JSONObject(operation.getJSONObject("payload").toString());
            snapshot.put("deletedAt",JSONObject.NULL);
            F1SyncMerge.apply(deviceB,new JSONObject().put("entityType",operation.getString("entityType"))
                .put("entityId",operation.getString("entityId")).put("revision",1).put("snapshot",snapshot));
        }
        check(new JSONObject(deviceB.toString()).getJSONArray("projects").getJSONObject(0)
            .getJSONArray("expenses").getJSONObject(0).getString("id").equals(expenseId),"offline device B lost expense");
        expense.put("amount","220000.00");F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length()==4,"unexpected mutation from detached object");
        JSONObject actual=restarted.getJSONArray("projects").getJSONObject(0).getJSONArray("expenses").getJSONObject(0);
        actual.put("amount","220000.00");F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").length()==5,"expense edit missing from queue");
        restarted.getJSONArray("projects").getJSONObject(0).getJSONArray("expenses").remove(0);F1SyncLedger.capture(restarted);
        check(restarted.getJSONObject("f1Sync").getJSONArray("operations").getJSONObject(5)
            .getString("operationType").equals("delete"),"expense tombstone missing");
        System.out.println("F3 local expense migration, exact totals, queue, restart and second device passed");
    }
}
