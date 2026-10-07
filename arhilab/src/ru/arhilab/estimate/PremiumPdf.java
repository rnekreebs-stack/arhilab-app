package ru.arhilab.estimate;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Offline, vector-text client renderer. Input is exclusively F7Documents' safe, immutable snapshot. */
final class PremiumPdf {
    interface ImageSource { byte[] get(String id)throws Exception; }
    static final int W=960,H=540,LEFT=34,RIGHT=926,TOP=160,BOTTOM=452;
    static final int BG=Color.rgb(19,22,22),PANEL=Color.rgb(29,33,33),WHITE=Color.rgb(243,243,239),MUTED=Color.rgb(174,174,169),GOLD=Color.rgb(202,165,107);
    private final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);private Canvas c;
    private final JSONObject doc,s,settings;private final ImageSource photos;
    private final ArrayList<Sheet> sheets=new ArrayList<>();
    static final class Sheet {String title,photoId;int part,count;List<JSONObject> rows;JSONObject section;boolean cover,summary,details,photoFeature;Sheet(String name){title=name;rows=new ArrayList<>();}}
    private PremiumPdf(JSONObject d,ImageSource images)throws Exception{doc=d;s=d.getJSONObject("snapshot");settings=s.getJSONObject("settings");photos=images;}
    private void paint(int color,float size,boolean bold){p.setColor(color);p.setTextSize(size);p.setTypeface(Typeface.create("sans-serif",bold?Typeface.BOLD:Typeface.NORMAL));p.setStyle(Paint.Style.FILL);}
    private void label(String text,float x,float y,int color,float size,boolean bold){paint(color,size,bold);c.drawText(text==null?"":text,x,y,p);}
    private void right(String text,float x,float y,int color,float size,boolean bold){paint(color,size,bold);c.drawText(text,x-p.measureText(text),y,p);}
    private void fill(float x,float y,float x2,float y2,int color){paint(color,10,false);c.drawRect(x,y,x2,y2,p);}
    private void rule(float x,float y,float x2,int color){fill(x,y,x2,y+0.7f,color);}
    private String money(String n){try{NumberFormat f=NumberFormat.getNumberInstance(new Locale("ru","RU"));f.setMinimumFractionDigits(0);f.setMaximumFractionDigits(2);return f.format(new BigDecimal(n)).replace('\u00a0',' ').replace('\u202f',' ')+" ₽";}catch(Exception e){return "—";}}
    private String clean(String text){return (text==null?"":text).replace('\r',' ').replace('\n',' ').replaceAll("\\s+"," ").trim();}
    private boolean imageAvailable(String id){if(photos==null||id.isEmpty())return false;try{byte[] bytes=photos.get(id);if(bytes==null||bytes.length>24*1024*1024)return false;BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);return options.outWidth>0&&options.outHeight>0;}catch(Exception ignored){return false;}}
    private List<String> wrap(String text,float width,float size,boolean bold){paint(WHITE,size,bold);ArrayList<String> lines=new ArrayList<>();StringBuilder current=new StringBuilder();for(String word:clean(text).split(" ")){
        if(word.isEmpty())continue;String proposed=current.length()==0?word:current+" "+word;
        if(p.measureText(proposed)>width&&current.length()>0){lines.add(current.toString());current.setLength(0);}
        for(int pos=0;pos<word.length();){int next=word.offsetByCodePoints(pos,1);String part=word.substring(pos,next);
            if(p.measureText(current+part)>width&&current.length()>0){lines.add(current.toString());current.setLength(0);}
            current.append(part);pos=next;
        }current.append(' ');
    }if(current.length()>0)lines.add(current.toString().trim());if(lines.isEmpty())lines.add("");return lines;}
    private int rowHeight(JSONObject row,boolean quantity,boolean price,boolean amount){float nameWidth=amount?430:price?540:quantity?610:780;int n=wrap(row.optString("title"),nameWidth,13,false).size();int notes=settings.optBoolean("includeNotes",true)&&!row.optString("note").isEmpty()?wrap(row.optString("note"),nameWidth,10,false).size():0;return Math.max(29,13+n*17+notes*13);}
    private void plan()throws Exception{
        boolean commercial=doc.optString("type").equals("COMMERCIAL_OFFER"),summaryOnly=settings.optBoolean("onlySectionTotals")||doc.optString("type").equals("SUMMARY_ESTIMATE");
        if(commercial){Sheet cover=new Sheet("Коммерческое предложение");cover.cover=true;sheets.add(cover);}
        LinkedHashMap<String,List<JSONObject>> groups=new LinkedHashMap<>();JSONArray sections=s.getJSONArray("sections");for(int i=0;i<sections.length();i++)groups.put(sections.getJSONObject(i).getString("title"),new ArrayList<>());
        if(!summaryOnly){for(String kind:new String[]{"works","materials"}){JSONArray entries=s.optJSONArray(kind);if(entries==null)continue;for(int i=0;i<entries.length();i++){JSONObject row=entries.getJSONObject(i);groups.computeIfAbsent(row.optString("section","Общие работы"),k->new ArrayList<>()).add(row);}}}
        if(!summaryOnly){for(java.util.Map.Entry<String,List<JSONObject>> group:groups.entrySet()){
            JSONObject section=null;for(int j=0;j<sections.length();j++)if(sections.getJSONObject(j).optString("title").equals(group.getKey())){section=sections.getJSONObject(j);break;}
            int first=sheets.size();Sheet sheet=new Sheet(group.getKey());sheet.section=section;int used=0;
            for(JSONObject row:group.getValue()){
                int h=rowHeight(row,settings.optBoolean("showQuantity",true),settings.optBoolean("showUnitPrice",true)&&!settings.optBoolean("hideLinePrices"),settings.optBoolean("showRowTotal",true)&&!settings.optBoolean("hideLinePrices"));
                if(used+h>BOTTOM-TOP-40&&sheet.rows.size()>0){sheets.add(sheet);sheet=new Sheet(group.getKey());sheet.section=section;used=0;}
                sheet.rows.add(row);used+=h;
            }sheets.add(sheet);
            JSONObject photoMap=settings.optJSONObject("sectionPhotoIds");String selectedPhoto=settings.optBoolean("includePhotos",true)&&photoMap!=null?photoMap.optString(group.getKey()):"";if(!imageAvailable(selectedPhoto))selectedPhoto="";
            if(!selectedPhoto.isEmpty()){int firstHeight=0;for(JSONObject row:sheets.get(first).rows)firstHeight+=rowHeight(row,settings.optBoolean("showQuantity",true),settings.optBoolean("showUnitPrice",true)&&!settings.optBoolean("hideLinePrices"),settings.optBoolean("showRowTotal",true)&&!settings.optBoolean("hideLinePrices"));
                if(firstHeight>150){Sheet photoPage=new Sheet(group.getKey());photoPage.photoFeature=true;photoPage.photoId=selectedPhoto;photoPage.section=section;sheets.add(first,photoPage);}}
            int count=sheets.size()-first;for(int j=first;j<sheets.size();j++){sheets.get(j).part=j-first+1;sheets.get(j).count=count;}
        }}
        // Summary rows are paginated separately so fifteen or more sections remain legible.
        int perPage=6;int pages=Math.max(1,(sections.length()+perPage-1)/perPage);
        for(int j=0;j<pages;j++){Sheet summary=new Sheet("Итоговая стоимость проекта");summary.summary=true;summary.part=j+1;summary.count=pages;sheets.add(summary);}
        if(commercial){Sheet detail=new Sheet("Условия проекта");detail.details=true;int used=0;
            String[][] values={{"includeTimeline","ДАТА НАЧАЛА","startDate"},{"includeTimeline","ОРИЕНТИРОВОЧНЫЙ СРОК","timeline"},{"includeTimeline","РАБОЧИХ ДНЕЙ","workingDays"},{"includeNotes","ПРИМЕЧАНИЕ","note"},{"includeNotes","УСЛОВИЯ ОПЛАТЫ","paymentTerms"},{"includeNotes","ГАРАНТИЯ","warranty"},{"includeCompanyDetails","ИСПОЛНИТЕЛЬ","companyDetails"},{"includeCompanyDetails","ТЕЛЕФОН","phone"},{"includeCompanyDetails","EMAIL","email"},{"includeCompanyDetails","САЙТ","site"},{"includeCompanyDetails","ИНН","taxId"}};
            for(String[] spec:values){if(!settings.optBoolean(spec[0],!spec[0].equals("includeCompanyDetails")))continue;String value=settings.optString(spec[2]);if(value.isEmpty())continue;List<String> lines=wrap(value,RIGHT-LEFT-250,13,false);for(int offset=0;offset<lines.size();offset+=12){String chunk=android.text.TextUtils.join(" ",lines.subList(offset,Math.min(lines.size(),offset+12)));int h=wrap(chunk,RIGHT-LEFT-250,13,false).size()*17+24;if(used+h>285&&detail.rows.size()>0){sheets.add(detail);detail=new Sheet("Условия проекта");detail.details=true;used=0;}detail.rows.add(new JSONObject().put("title",spec[1]+(offset>0?" · ПРОДОЛЖЕНИЕ":"")).put("value",chunk));used+=h;}}
            if(settings.optBoolean("includeSignatures")){if(used>195&&detail.rows.size()>0){sheets.add(detail);detail=new Sheet("Условия проекта");detail.details=true;}detail.rows.add(new JSONObject().put("title","SIGNATURES"));}
            if(!detail.rows.isEmpty())sheets.add(detail);
        }
        // Project summary remains the final page, including when optional conditions are present.
        ArrayList<Sheet> summaries=new ArrayList<>();for(Sheet sheet:sheets)if(sheet.summary)summaries.add(sheet);sheets.removeAll(summaries);sheets.addAll(summaries);
    }
    private void frame(Sheet sheet,int page){c.drawColor(BG);if(photos!=null)try{photograph("brand-logo",LEFT,15,35,39);}catch(Exception ignored){}label("ARHILAB",LEFT+45,38,WHITE,20,true);label("АРХИТЕКТУРА  •  СТРОИТЕЛЬСТВО  •  РЕМОНТ",LEFT+45,52,MUTED,8,false);right("ВСЁ ПРОСТРАНСТВО В ОДНИХ РУКАХ",RIGHT,37,GOLD,9,true);rule(LEFT,64,RIGHT,Color.rgb(89,82,69));
        if(!sheet.cover){String title=sheet.title.toUpperCase(new Locale("ru","RU"));for(String line:wrap(title,RIGHT-LEFT,28,true)){label(line,LEFT,96,WHITE,28,true);break;}fill(LEFT,108,70,110,GOLD);if(sheet.count>1)right(String.format(Locale.ROOT,"%02d / %02d",sheet.part,sheet.count),RIGHT,114,GOLD,10,true);}
        rule(LEFT,510,RIGHT,Color.rgb(73,70,65));label("ARHILAB / "+(doc.optString("type").equals("COMMERCIAL_OFFER")?"КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ":"СМЕТА"),LEFT,524,MUTED,8,false);right(String.format(Locale.ROOT,"%02d / %02d",page,sheets.size()),RIGHT,524,GOLD,9,true);
    }
    private void photograph(String id,float x,float y,float w,float h)throws Exception{if(photos==null||id.isEmpty())return;byte[] bytes;try{bytes=photos.get(id);}catch(Exception unavailable){return;}if(bytes==null||bytes.length>24*1024*1024)return;BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,o);o.inSampleSize=Math.max(1,Math.max(o.outWidth/1800,o.outHeight/1200));o.inJustDecodeBounds=false;Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,o);if(bitmap==null)return;float scale=Math.max(w/bitmap.getWidth(),h/bitmap.getHeight()),bw=w/scale,bh=h/scale;float sx=(bitmap.getWidth()-bw)/2,sy=(bitmap.getHeight()-bh)/2;
        c.save();c.clipRect(x,y,x+w,y+h);p.setFilterBitmap(true);p.setAlpha(255);c.drawBitmap(bitmap,new android.graphics.Rect(Math.round(sx),Math.round(sy),Math.round(sx+bw),Math.round(sy+bh)),new RectF(x,y,x+w,y+h),p);c.restore();bitmap.recycle();}
    private void cover(Sheet sheet)throws Exception{String photo=settings.optBoolean("includePhotos",true)?settings.optString("coverPhotoId"):"";
        if(!photo.isEmpty())photograph(photo,570,92,356,343);
        label("КОММЕРЧЕСКОЕ",LEFT,190,WHITE,38,true);label("ПРЕДЛОЖЕНИЕ",LEFT,235,WHITE,38,true);fill(LEFT,250,92,253,GOLD);
        int y=290;for(String line:wrap(s.optString("projectName"),photo.isEmpty()?850:500,19,true)){label(line,LEFT,y,GOLD,19,true);y+=25;if(y>390)break;}
        for(String line:wrap(s.optString("address"),photo.isEmpty()?830:490,12,false)){label(line,LEFT,y,MUTED,12,false);y+=17;if(y>415)break;}
        right(money(s.optString("total")),RIGHT,481,GOLD,25,true);
    }
    private void section(Sheet sheet)throws Exception{label(sheet.section==null||sheet.section.optString("note").isEmpty()?"Состав работ и материалов по смете":clean(sheet.section.optString("note")),LEFT,121,MUTED,10,false);int y=TOP-14;label("№",LEFT,y,GOLD,10,true);label("РАБОТЫ И МАТЕРИАЛЫ",LEFT+36,y,GOLD,10,true);
        boolean showQty=settings.optBoolean("showQuantity",true),showPrice=settings.optBoolean("showUnitPrice",true)&&!settings.optBoolean("hideLinePrices")&&!settings.optBoolean("onlySectionTotals"),showTotal=settings.optBoolean("showRowTotal",true)&&!settings.optBoolean("hideLinePrices");
        if(showQty)label("КОЛИЧЕСТВО",641,y,GOLD,9,true);if(showPrice)label("ЦЕНА",754,y,GOLD,9,true);if(showTotal)right("СТОИМОСТЬ",RIGHT,y,GOLD,9,true);rule(LEFT,y+8,RIGHT,Color.rgb(89,82,69));y+=22;
        int rowNo=1;for(int prior=0;prior<sheets.indexOf(sheet);prior++)if(sheets.get(prior).title.equals(sheet.title))rowNo+=sheets.get(prior).rows.size();
        for(JSONObject row:sheet.rows){int height=rowHeight(row,showQty,showPrice,showTotal);fill(LEFT,y-12,RIGHT,y+height-13,rowNo%2==0?PANEL:BG);label(String.format(Locale.ROOT,"%02d",rowNo++),LEFT+6,y,MUTED,11,false);
            int index=0;for(String line:wrap(row.optString("title"),showTotal?430:showPrice?540:showQty?610:780,13,false))label(line,LEFT+36,y+index++*17,WHITE,13,false);
            if(settings.optBoolean("includeNotes",true)&&!row.optString("note").isEmpty())for(String note:wrap(row.optString("note"),430,10,false))label(note,LEFT+36,y+index++*13,MUTED,10,false);
            if(showQty)label(clean(row.optString("quantity")+" "+row.optString("unit")),641,y,MUTED,11,false);
            if(showPrice&&!row.optString("unitPrice").isEmpty())right(money(row.optString("unitPrice")),820,y,MUTED,11,false);
            if(showTotal)right(money(row.optString("total")),RIGHT-7,y,WHITE,12,true);
            rule(LEFT,y+height-13,RIGHT,Color.rgb(66,65,60));y+=height;
        }
        if(sheet.part==1&&settings.optBoolean("includePhotos",true)&&y+125<455){String photo=settings.optJSONObject("sectionPhotoIds")==null?"":settings.optJSONObject("sectionPhotoIds").optString(sheet.title);if(!photo.isEmpty())photograph(photo,RIGHT-265,y+8,265,120);}
        if(sheet.part==sheet.count&&settings.optBoolean("showSectionTotals",true)&&sheet.section!=null){String amount=sheet.section.optString("total");if(amount.isEmpty())amount=sheet.section.optString("workTotal");fill(LEFT,464,RIGHT,500,GOLD);label("ИТОГО "+sheet.title.toUpperCase(new Locale("ru","RU")),LEFT+14,487,BG,15,true);right(money(amount),RIGHT-14,490,BG,23,true);}
    }
    private void featuredPhoto(Sheet sheet)throws Exception{label("РАЗДЕЛ ПРОЕКТА",LEFT,128,GOLD,12,true);photograph(sheet.photoId,LEFT,150,RIGHT-LEFT,315);}
    private void summary(Sheet sheet)throws Exception{JSONArray sections=s.getJSONArray("sections");int begin=(sheet.part-1)*6,end=Math.min(sections.length(),begin+6),y=145;label("№",LEFT,y,GOLD,10,true);label("РАЗДЕЛ",LEFT+38,y,GOLD,10,true);label("СОСТАВ",LEFT+320,y,GOLD,10,true);right("СТОИМОСТЬ",RIGHT,y,GOLD,10,true);rule(LEFT,y+8,RIGHT,Color.rgb(89,82,69));y+=30;
        for(int i=begin;i<end;i++){JSONObject section=sections.getJSONObject(i);String amount=section.optString("total");if(amount.isEmpty())amount=section.optString("workTotal");fill(LEFT,y-17,RIGHT,y+5,i%2==0?PANEL:BG);label(String.format(Locale.ROOT,"%02d",i+1),LEFT+6,y,MUTED,10,false);
            List<String> name=wrap(section.optString("title"),270,11,true);label(name.get(0),LEFT+38,y,WHITE,11,true);label("Работы"+(section.optString("materialTotal").isEmpty()?"":" и материалы"),LEFT+320,y,MUTED,10,false);right(money(amount),RIGHT-7,y,WHITE,12,true);y+=25;}
        if(sheet.part==sheet.count){y=Math.max(y+8,345);label("ИТОГО РАБОТЫ",LEFT,y,WHITE,13,true);right(money(new BigDecimal(s.optString("workTotal","0")).add(new BigDecimal(s.optString("workMarkup","0"))).toPlainString()),RIGHT,y,WHITE,14,true);y+=27;
            if(!s.optString("materialTotal").isEmpty()&&new BigDecimal(s.optString("materialTotal")).signum()!=0){label("ИТОГО МАТЕРИАЛЫ",LEFT,y,WHITE,13,true);right(money(s.optString("materialTotal")),RIGHT,y,WHITE,14,true);y+=27;}
            if(new BigDecimal(s.optString("delivery","0")).signum()!=0){label("ДОСТАВКА",LEFT,y,WHITE,13,true);right(money(s.optString("delivery")),RIGHT,y,WHITE,14,true);y+=27;}
            if(new BigDecimal(s.optString("discount","0")).signum()!=0){label("СКИДКА",LEFT,y,WHITE,13,true);right("−"+money(s.optString("discount")),RIGHT,y,WHITE,14,true);y+=27;}
            if(settings.optBoolean("showGrandTotal",true)){fill(LEFT,464,RIGHT,500,GOLD);label("ОБЩАЯ СТОИМОСТЬ ПРОЕКТА",LEFT+14,487,BG,15,true);right(money(s.optString("total")),RIGHT-14,490,BG,24,true);}
        }
    }
    private void details(Sheet sheet){int y=145;for(JSONObject row:sheet.rows){if(row.optString("title").equals("SIGNATURES")){y+=25;label("Исполнитель ____________________",LEFT,y,WHITE,13,false);label("Заказчик ____________________",LEFT+475,y,WHITE,13,false);label("Дата ____________________",LEFT,y+45,MUTED,12,false);}else y=detail(row.optString("title"),row.optString("value"),y);}
    }
    private int detail(String title,String value,int y){label(title,LEFT,y,GOLD,10,true);int offset=0;for(String line:wrap(value,RIGHT-LEFT-250,13,false))label(line,LEFT+250,y+offset++*17,WHITE,13,false);rule(LEFT,y+Math.max(1,offset)*17+5,RIGHT,Color.rgb(66,65,60));return y+Math.max(1,offset)*17+24;}
    static File render(File root,JSONObject doc,ImageSource photos)throws Exception{java.util.UUID.fromString(doc.getString("id"));PremiumPdf renderer=new PremiumPdf(doc,photos);renderer.plan();File dir=new File(root,"premium-pdf");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Недоступно место для PDF");File target=new File(dir,doc.getString("id")+".pdf"),tmp=new File(dir,doc.getString("id")+".tmp");PdfDocument pdf=new PdfDocument();try{
        for(int i=0;i<renderer.sheets.size();i++){Sheet sheet=renderer.sheets.get(i);PdfDocument.Page page=pdf.startPage(new PdfDocument.PageInfo.Builder(W,H,i+1).create());renderer.c=page.getCanvas();renderer.frame(sheet,i+1);if(sheet.cover)renderer.cover(sheet);else if(sheet.summary)renderer.summary(sheet);else if(sheet.details)renderer.details(sheet);else if(sheet.photoFeature)renderer.featuredPhoto(sheet);else renderer.section(sheet);pdf.finishPage(page);}
        try(FileOutputStream out=new FileOutputStream(tmp)){pdf.writeTo(out);out.getFD().sync();}if(!tmp.renameTo(target))throw new IOException("Не удалось записать PDF");return target;
    }finally{pdf.close();tmp.delete();}}
    static JSONObject preview(File file,int pageIndex)throws Exception{try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer renderer=new PdfRenderer(fd)){
        int count=renderer.getPageCount();if(pageIndex<0||pageIndex>=count)throw new IllegalArgumentException("Страница не найдена");try(PdfRenderer.Page page=renderer.openPage(pageIndex)){
            Bitmap image=Bitmap.createBitmap(960,540,Bitmap.Config.ARGB_8888);try{image.eraseColor(Color.WHITE);page.render(image,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);ByteArrayOutputStream out=new ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.PNG,100,out);return new JSONObject().put("pageCount",count).put("pageIndex",pageIndex).put("data","data:image/png;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP));}finally{image.recycle();}
        }
    }}
}
