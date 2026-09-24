package ru.arhilab.estimate;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

public final class CloudSync {
 public static final class Vault {
  public final int revision;public final byte[] ciphertext;
  Vault(int revision,byte[] ciphertext){this.revision=revision;this.ciphertext=ciphertext;}
 }
 public final String url;private String token;
 public CloudSync(String url)throws Exception{URI parsed=new URI(url.trim());if(!"https".equals(parsed.getScheme())||parsed.getHost()==null||parsed.getRawUserInfo()!=null||parsed.getQuery()!=null||parsed.getFragment()!=null||!parsed.getPath().matches("/?"))throw new IllegalArgumentException("Укажите адрес сервера https:// без пути");this.url=parsed.getScheme()+"://"+parsed.getRawAuthority();}
 private JSONObject request(String method,String endpoint,JSONObject payload)throws Exception{
  HttpsURLConnection conn=(HttpsURLConnection)new URL(url+endpoint).openConnection();conn.setConnectTimeout(10000);conn.setReadTimeout(20000);conn.setInstanceFollowRedirects(false);conn.setRequestMethod(method);conn.setRequestProperty("Accept","application/json");if(token!=null)conn.setRequestProperty("Authorization","Bearer "+token);
  try{if(payload!=null){conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json; charset=utf-8");byte[] data=payload.toString().getBytes(StandardCharsets.UTF_8);conn.setFixedLengthStreamingMode(data.length);try(OutputStream out=conn.getOutputStream()){out.write(data);}}
   int status=conn.getResponseCode();InputStream source=status>=400?conn.getErrorStream():conn.getInputStream();if(source==null)throw new IOException("Сервер не ответил");ByteArrayOutputStream buffer=new ByteArrayOutputStream();try(InputStream in=source){byte[] part=new byte[8192];int n;while((n=in.read(part))!=-1){if(buffer.size()+n>128*1024*1024)throw new IOException("Ответ сервера слишком большой");buffer.write(part,0,n);}}JSONObject response=new JSONObject(buffer.toString("UTF-8"));if(status>=300)throw new IOException(response.optString("error","Ошибка сервера")+" ("+status+")");return response;
  }finally{conn.disconnect();}
 }
 public void login(String login,char[] password)throws Exception{token=request("POST","/v1/login",new JSONObject().put("login",login).put("password",new String(password))).getString("token");}
 public Vault fetch()throws Exception{JSONObject response=request("GET","/v1/vault",null);String data=response.optString("ciphertext","");return new Vault(response.getInt("revision"),data.isEmpty()?null:Base64.getDecoder().decode(data));}
 public int push(int expectedRevision,byte[] encrypted)throws Exception{return request("PUT","/v1/vault",new JSONObject().put("expectedRevision",expectedRevision).put("ciphertext",Base64.getEncoder().encodeToString(encrypted))).getInt("revision");}
}
