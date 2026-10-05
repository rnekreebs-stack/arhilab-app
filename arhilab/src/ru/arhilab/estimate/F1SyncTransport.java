package ru.arhilab.estimate;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/** HTTPS transport for the existing Stage 3–5 wire contract; keeps tokens out of WebView state. */
final class F1SyncTransport {
    static final class Failure extends Exception {
        final int status;
        Failure(int status) { super("Сервер синхронизации недоступен или отклонил запрос"); this.status = status; }
    }

    private final String base;
    F1SyncTransport(String address) throws Exception {
        URI uri = new URI(address);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException("Укажите HTTPS адрес сервера");
        base = address.replaceAll("/+$", "") + "/api/v1";
    }

    JSONObject request(String method, String path, JSONObject input, String access) throws Exception {
        if (!path.startsWith("/") || path.contains("..")) throw new IllegalArgumentException("Неверный путь API");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(20000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
            if (input != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                byte[] body = input.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new Failure(status);
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int size;
                while ((size = stream.read(buffer)) != -1) {
                    if (output.size() + size > 8 * 1024 * 1024) throw new Failure(413);
                    output.write(buffer, 0, size);
                }
                return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
    }

    JSONObject login(String organization, String email, String password, String deviceId) throws Exception {
        return request("POST", "/auth/login", new JSONObject().put("organizationId", organization)
            .put("email", email).put("password", password).put("deviceId", deviceId), null);
    }

    JSONObject refresh(String refreshToken) throws Exception {
        return request("POST", "/auth/refresh", new JSONObject().put("refreshToken", refreshToken), null);
    }

    JSONObject push(JSONObject operation, String access) throws Exception {
        JSONObject payload = new JSONObject(operation.toString());
        payload.remove("state"); payload.remove("conflictId");
        return request("POST", "/sync/push", new JSONObject().put("operations", new JSONArray().put(payload)), access);
    }

    JSONObject pull(String cursor, String access) throws Exception {
        if (!cursor.matches("0|[1-9][0-9]{0,18}")) throw new IllegalArgumentException("Неверный курсор");
        return request("GET", "/sync/pull?cursor=" + cursor, null, access);
    }

    JSONObject snapshot(String access) throws Exception { return request("GET", "/sync/snapshot", null, access); }
}
