package ru.arhilab.estimate;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import com.googlecode.tesseract.android.TessBaseAPI;
import java.io.*;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.CipherOutputStream;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

/** Private AES-GCM originals and bundled Russian/English Tesseract; no network path. */
final class ImportEngine {
 final Context context; final SecretKey key; final File dir;
 ImportEngine(Context context,SecretKey key){this.context=context;this.key=key;dir=new File(context.getFilesDir(),"imports");dir.mkdirs();}
 File file(String id)throws Exception{UUID.fromString(id);return new File(dir,id+".enc");}
 void put(String id,InputStream source)throws Exception{
  File target=file(id),temp=new File(dir,id+".tmp");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);
  try(FileOutputStream raw=new FileOutputStream(temp)){raw.write(c.getIV());try(CipherOutputStream out=new CipherOutputStream(raw,c)){
   byte[] buf=new byte[65536];long count=0;int n;while((n=source.read(buf))!=-1){count+=n;if(count>80L*1024*1024)throw new IOException("Файл больше 80 МБ");out.write(buf,0,n);}out.flush();}}
  catch(Exception e){temp.delete();throw e;}
  if(!temp.renameTo(target)){temp.delete();throw new IOException("Не удалось сохранить оригинал");}
 }
 InputStream open(String id)throws Exception{FileInputStream raw=new FileInputStream(file(id));try{byte[] iv=new byte[12];if(raw.read(iv)!=12)throw new IOException("Оригинал повреждён");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));return new CipherInputStream(raw,c);}catch(Exception e){raw.close();throw e;}}
 File plaintext(String id)throws Exception{File temp=File.createTempFile("pdf-import-",".pdf",context.getCacheDir());try(InputStream in=open(id);OutputStream out=new FileOutputStream(temp)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);return temp;}catch(Exception e){temp.delete();throw e;}}
 int pageCount(String id,boolean pdf)throws Exception{if(!pdf)return 1;File temp=plaintext(id);try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(temp,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer renderer=new PdfRenderer(fd)){if(renderer.getPageCount()>100)throw new IOException("PDF содержит больше 100 страниц");return renderer.getPageCount();}finally{temp.delete();}}
 Bitmap bitmap(String id,boolean pdf,int page,int max)throws Exception{
  if(pdf){File temp=plaintext(id);try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(temp,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer renderer=new PdfRenderer(fd);PdfRenderer.Page p=renderer.openPage(page)){
   float scale=Math.min((float)max/Math.max(p.getWidth(),p.getHeight()),2.5f);Bitmap b=Bitmap.createBitmap(Math.max(1,Math.round(p.getWidth()*scale)),Math.max(1,Math.round(p.getHeight()*scale)),Bitmap.Config.ARGB_8888);b.eraseColor(-1);p.render(b,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);return b;}finally{temp.delete();}}
  BitmapFactory.Options opts=new BitmapFactory.Options();opts.inJustDecodeBounds=true;try(InputStream in=open(id)){BitmapFactory.decodeStream(in,null,opts);}int factor=1;while(Math.max(opts.outWidth,opts.outHeight)/factor>max)factor*=2;opts.inJustDecodeBounds=false;opts.inSampleSize=factor;try(InputStream in=open(id)){Bitmap b=BitmapFactory.decodeStream(in,null,opts);if(b==null)throw new IOException("Не удалось открыть изображение");return b;}
 }
 String preview(String id,boolean pdf,int page,int rotation,JSONArray crop)throws Exception{Bitmap b=bitmap(id,pdf,page,1200);try{Bitmap trimmed=cropped(b,crop),shown=rotated(trimmed,rotation);ByteArrayOutputStream out=new ByteArrayOutputStream();shown.compress(Bitmap.CompressFormat.JPEG,75,out);if(shown!=trimmed)shown.recycle();if(trimmed!=b)trimmed.recycle();return "data:image/jpeg;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);}finally{b.recycle();}}
 static Bitmap cropped(Bitmap b,JSONArray crop){if(crop==null||crop.length()!=4)return b;int left=(int)(b.getWidth()*crop.optDouble(0)),top=(int)(b.getHeight()*crop.optDouble(1)),right=(int)(b.getWidth()*crop.optDouble(2)),bottom=(int)(b.getHeight()*crop.optDouble(3));if(left<0||top<0||right>b.getWidth()||bottom>b.getHeight()||right-left<100||bottom-top<100)return b;return Bitmap.createBitmap(b,left,top,right-left,bottom-top);}
 static Bitmap rotated(Bitmap b,int degrees){if(degrees%360==0)return b;Matrix m=new Matrix();m.postRotate(degrees);return Bitmap.createBitmap(b,0,0,b.getWidth(),b.getHeight(),m,true);}
 void prepareModels()throws Exception{File models=new File(dir,"tesseract/tessdata");if(!models.exists()&&!models.mkdirs())throw new IOException("Нет места для модели OCR");for(String language:new String[]{"rus","eng"}){File target=new File(models,language+".traineddata");if(target.length()>1000000)continue;File temp=new File(models,language+".tmp");try(InputStream in=context.getAssets().open("tessdata/"+language+".traineddata");OutputStream out=new FileOutputStream(temp)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);}if(!temp.renameTo(target))throw new IOException("Модель OCR не сохранена");}}
 JSONArray recognize(JSONArray pages,Progress progress)throws Exception{
  prepareModels();TessBaseAPI tess=new TessBaseAPI();if(!tess.init(new File(dir,"tesseract").getAbsolutePath(),"rus+eng")){tess.recycle();throw new IOException("Локальная модель OCR недоступна");}
  JSONArray result=new JSONArray();try{for(int i=0;i<pages.length();i++){if(progress.cancelled())throw new IOException("Распознавание отменено");JSONObject source=pages.getJSONObject(i);progress.page(i+1,pages.length());Bitmap b=bitmap(source.getString("fileId"),source.optBoolean("pdf"),source.optInt("index"),2400);
   try{Bitmap cropped=cropped(b,source.optJSONArray("crop")),scan=rotated(cropped,source.optInt("rotation"));try{tess.setImage(scan);String text=tess.getUTF8Text();result.put(new JSONObject().put("page",i+1).put("text",text==null?"":text).put("ocrConfidence",tess.meanConfidence()));}finally{if(scan!=cropped)scan.recycle();if(cropped!=b)cropped.recycle();}}finally{b.recycle();}}
  }finally{tess.recycle();}return result;
 }
 interface Progress{void page(int current,int total)throws Exception;boolean cancelled();}
}
