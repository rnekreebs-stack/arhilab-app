package ru.arhilab.estimate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Explicit actual expenses; historical planned costs and legacy expense payments are excluded. */
final class F3Expenses {
    private F3Expenses() {}

    static void validate(JSONObject row) throws Exception {
        F2Payments.amount(row.getString("amount"));
        F2Payments.currency(row.getString("currency"));
        LocalDate.parse(row.getString("date"));
        String category=row.getString("category");
        if (!category.matches("materials|labor|subcontractor|delivery|equipment|other"))
            throw new IllegalArgumentException("Выберите категорию расхода");
        String description=row.getString("description").trim();
        if (description.isEmpty() || description.length()>250 || row.optString("note","").length()>1000)
            throw new IllegalArgumentException("Проверьте описание и комментарий");
        row.put("description",description).put("amount",F2Payments.amount(row.getString("amount")));
    }

    /** No FX conversion: only the exact currency and selected estimate contribute to the result. */
    static JSONObject summary(String estimateId, String currency, Object total, Object paid, JSONArray expenses) throws Exception {
        F2Payments.currency(currency);
        BigDecimal expenseTotal=BigDecimal.ZERO;
        boolean mismatch=false;
        for(int i=0;i<expenses.length();i++) {
            JSONObject row=expenses.getJSONObject(i);
            if(!estimateId.equals(row.optString("estimateId")))continue;
            if(!currency.equals(row.getString("currency"))){mismatch=true;continue;}
            expenseTotal=expenseTotal.add(new BigDecimal(row.getString("amount")));
        }
        JSONObject result=new JSONObject().put("currencyMismatch",mismatch)
            .put("actualExpenses",expenseTotal.setScale(2).toPlainString());
        if(mismatch)return result; // Do not report a misleading partial profit.
        BigDecimal estimateTotal=new BigDecimal(String.valueOf(total)).setScale(2,RoundingMode.HALF_UP);
        BigDecimal paidTotal=new BigDecimal(String.valueOf(paid)).setScale(2,RoundingMode.HALF_UP);
        result.put("cashResult",paidTotal.subtract(expenseTotal).setScale(2).toPlainString())
            .put("forecastGrossProfit",estimateTotal.subtract(expenseTotal).setScale(2).toPlainString());
        if(estimateTotal.signum()>0)result.put("forecastMarginPercent",estimateTotal.subtract(expenseTotal)
            .multiply(new BigDecimal("100")).divide(estimateTotal,2,RoundingMode.HALF_UP).toPlainString());
        return result;
    }

    static JSONObject projectTotals(JSONArray expenses) throws Exception {
        Map<String,BigDecimal> totals=new HashMap<>();
        for(int i=0;i<expenses.length();i++){
            JSONObject row=expenses.getJSONObject(i);
            String currency=F2Payments.currency(row.getString("currency"));
            totals.put(currency,totals.getOrDefault(currency,BigDecimal.ZERO).add(new BigDecimal(row.getString("amount"))));
        }
        JSONObject result=new JSONObject();
        for(Map.Entry<String,BigDecimal> entry:totals.entrySet())result.put(entry.getKey(),entry.getValue().setScale(2).toPlainString());
        return result;
    }
}
