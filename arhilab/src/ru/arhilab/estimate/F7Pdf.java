package ru.arhilab.estimate;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.provider.OpenableColumns;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** Minimal native PDF renderer: draws only values from the client-safe snapshot. */
final class F7Pdf {
    private final PdfDocument pdf=new PdfDocument();
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private Canvas canvas;private PdfDocument.Page page;private int pageNo=0,y=0;
    private static final int WIDTH=595,HEIGHT=842,LEFT=42,RIGHT=553;
    private F7Pdf(){paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));paint.setColor(Color.rgb(18,45,58));}
    private void start(String number){page=pdf.startPage(new PdfDocument.PageInfo.Builder(WIDTH,HEIGHT,++pageNo).create());canvas=page.getCanvas();y=56;
        paint.setTextSize(19);canvas.drawText("Arhilab Смета",LEFT,y,paint);y+=27;paint.setTextSize(9);canvas.drawText(number+" · страница "+pageNo,LEFT,y,paint);y+=30;}
    private void next(String number){pdf.finishPage(page);start(number);}
    private void text(String value,int size,String number){paint.setTextSize(size);String content=value==null?"":value.replace('\r',' ').replace('\n',' ');
        StringBuilder line=new StringBuilder();for(int offset=0;offset<content.length();){int cp=content.codePointAt(offset);offset+=Character.charCount(cp);
            String candidate=line.toString()+new String(Character.toChars(cp));if(paint.measureText(candidate)>RIGHT-LEFT&&line.length()>0){line(line.toString(),number);line.setLength(0);}
            line.appendCodePoint(cp);
        }line(line.toString(),number);}
    private void line(String value,String number){if(y>HEIGHT-60)next(number);canvas.drawText(value,LEFT,y,paint);y+=Math.max(16,(int)paint.getTextSize()+5);}
    private void row(JSONObject row,String number)throws Exception {
        text(row.optString("title"),11,number);
        String v=row.optString("quantity")+" "+row.optString("unit")+" × "+row.optString("coefficient","1");
        if(row.has("unitPrice"))v+=" · "+row.optString("unitPrice")+" ₽";
        text(v+" = "+row.optString("total")+" ₽",10,number);y+=7;
    }
    private void rows(JSONArray rows,String number,boolean sections,boolean summary)throws Exception {
        if(summary){
            LinkedHashMap<String,BigDecimal> totals=new LinkedHashMap<>();
            for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String section=row.optString("section","Общие работы");
                totals.put(section,totals.getOrDefault(section,BigDecimal.ZERO).add(new BigDecimal(row.getString("total"))));}
            for(java.util.Map.Entry<String,BigDecimal> entry:totals.entrySet())text(entry.getKey()+": "+entry.getValue().toPlainString()+" ₽",11,number);
            return;
        }
        String previous=null;
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String section=row.optString("section","Общие работы");
            if(sections&&!section.equals(previous)){text(section,12,number);previous=section;}row(row,number);}
    }
    static File render(File root,JSONObject doc)throws Exception {
        String id=doc.getString("id");java.util.UUID.fromString(id);
        JSONObject data=doc.getJSONObject("snapshot"),settings=data.getJSONObject("settings");
        File dir=new File(root,"f7");if(!dir.isDirectory()&&!dir.mkdirs())throw new java.io.IOException("PDF directory unavailable");
        File target=new File(dir,id+".pdf"),temp=new File(dir,id+".tmp");
        F7Pdf r=new F7Pdf();String number=doc.getString("number")+" v"+doc.getInt("version");
        try{
            r.start(number);
            String title=doc.getString("type").equals("COMMERCIAL_OFFER")?"Коммерческое предложение":doc.getString("type").equals("DETAILED_ESTIMATE")?"Подробная смета":"Краткая смета";
            r.text(title,17,number);r.text("Дата: "+doc.optString("finalizedAt",doc.optString("createdAt")),10,number);
            r.text("Клиент: "+data.optString("clientName"),11,number);
            r.text("Объект: "+data.optString("projectName")+" · "+data.optString("address"),11,number);
            r.text("Смета: "+data.optString("estimateName"),11,number);r.y+=15;
            JSONArray works=data.getJSONArray("works"),materials=data.getJSONArray("materials");
            r.text("Работы",14,number);
            boolean summary=doc.getString("type").equals("SUMMARY_ESTIMATE");
            if(summary){for(int i=0;i<data.getJSONArray("sections").length();i++){
                JSONObject section=data.getJSONArray("sections").getJSONObject(i);
                r.text(section.getString("title")+" · работы "+section.getString("workTotal")+" ₽",11,number);
                if(!settings.optString("materials").equals("hidden"))r.text("Материалы "+section.getString("materialTotal")+" ₽ · раздел "+section.getString("total")+" ₽",10,number);
            }}else r.rows(works,number,settings.optBoolean("showSections",true),false);
            r.text("Работы: "+data.getString("workTotal")+" ₽",12,number);
            if(!summary&&settings.optBoolean("showSections",true))for(int i=0;i<data.getJSONArray("sections").length();i++){
                JSONObject section=data.getJSONArray("sections").getJSONObject(i);
                r.text("Раздел "+section.getString("title")+": "+section.getString("workTotal")+" ₽"+
                    (settings.optString("materials").equals("hidden")?"":" · материалы "+section.getString("materialTotal")+" ₽"),10,number);
            }
            r.text("Наценка на работы: "+data.getString("workMarkup")+" ₽",11,number);
            if(!settings.optString("materials").equals("hidden")){
                if(settings.optString("materials").equals("detailed")&&!doc.getString("type").equals("SUMMARY_ESTIMATE")){
                    r.text("Материалы",14,number);r.rows(materials,number,settings.optBoolean("showSections",true),false);
                }
                r.text("Материалы: "+data.getString("materialTotal")+" ₽",12,number);
            }
            r.text("Доставка: "+data.getString("delivery")+" ₽ · Скидка: "+data.getString("discount")+" ₽",11,number);
            r.y+=10;r.text("ИТОГО: "+data.getString("total")+" ₽",17,number);
            for(String key:new String[]{"paymentTerms","timeline","warranty","note","companyDetails"})if(!settings.optString(key).isEmpty())r.text(settings.getString(key),11,number);
            r.y+=25;r.text("Заказчик: ____________________   Исполнитель: ____________________",11,number);
            r.pdf.finishPage(r.page);
            try(FileOutputStream out=new FileOutputStream(temp)){r.pdf.writeTo(out);out.getFD().sync();}
            if(!temp.renameTo(target))throw new java.io.IOException("PDF save failed");
            return target;
        }finally{r.pdf.close();}
    }
    public static final class Provider extends ContentProvider {
        public boolean onCreate(){return true;}
        public String getType(Uri uri){return "application/pdf";}
        public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException {
            if(!"r".equals(mode)||!uri.getPath().matches("/[0-9a-f-]{36}\\.pdf"))throw new FileNotFoundException();
            File root=new File(getContext().getCacheDir(),"f7"),file=new File(root,uri.getLastPathSegment());
            try{if(!file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator)||!file.isFile())throw new FileNotFoundException();}
            catch(java.io.IOException e){throw new FileNotFoundException();}
            return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);
        }
        public Cursor query(Uri u,String[] p,String s,String[] a,String o){
            if(!u.getPath().matches("/[0-9a-f-]{36}\\.pdf"))return null;
            String[] columns=p==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:p;
            MatrixCursor result=new MatrixCursor(columns);Object[] row=new Object[columns.length];
            for(int i=0;i<columns.length;i++){
                if(columns[i].equals(OpenableColumns.DISPLAY_NAME))row[i]="Arhilab_"+u.getLastPathSegment();
                else if(columns[i].equals(OpenableColumns.SIZE))row[i]=new File(new File(getContext().getCacheDir(),"f7"),u.getLastPathSegment()).length();
            }result.addRow(row);return result;
        }
        public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
        public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
        public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
    }
}
