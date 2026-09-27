package ru.arhilab.estimate;

import java.math.BigDecimal;
import org.json.JSONArray;
import org.json.JSONObject;

/** Currency-qualified incoming payments for one selected estimate. No conversion or floating point. */
final class F2Payments {
    private F2Payments() {}

    static String amount(String input) {
        if (!input.matches("(?:0|[1-9][0-9]{0,15})(?:\\.[0-9]{1,2})?"))
            throw new IllegalArgumentException("Введите положительную сумму с точностью до копеек");
        BigDecimal value = new BigDecimal(input);
        if (value.signum() <= 0) throw new IllegalArgumentException("Сумма должна быть больше нуля");
        return value.setScale(2).toPlainString();
    }

    static String currency(String input) {
        if (!input.matches("[A-Z]{3}")) throw new IllegalArgumentException("Укажите валюту тремя латинскими буквами");
        return input;
    }

    static JSONObject summary(JSONObject estimate, JSONArray payments, Object estimateTotal) throws Exception {
        String currency = estimate.optString("currency", "");
        if (!currency.matches("[A-Z]{3}")) return new JSONObject().put("currencyRequired", true);
        BigDecimal total = new BigDecimal(String.valueOf(estimateTotal)).setScale(2);
        BigDecimal paid = BigDecimal.ZERO;
        String estimateId = estimate.getString("id");
        for (int i=0; i<payments.length(); i++) {
            JSONObject row = payments.getJSONObject(i);
            if (!estimateId.equals(row.optString("estimateId")) || !"income".equals(row.optString("kind"))) continue;
            if (!currency.equals(row.optString("currency")))
                return new JSONObject().put("currencyMismatch", true).put("currency", currency);
            paid = paid.add(new BigDecimal(row.has("paid") ? row.get("paid").toString() : row.get("amount").toString()));
        }
        BigDecimal delta = total.subtract(paid);
        return new JSONObject().put("currency",currency)
            .put("paid",paid.setScale(2).toPlainString())
            .put("remaining",delta.max(BigDecimal.ZERO).setScale(2).toPlainString())
            .put("overpayment",delta.negate().max(BigDecimal.ZERO).setScale(2).toPlainString());
    }
}
