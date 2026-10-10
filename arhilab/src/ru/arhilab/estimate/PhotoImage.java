package ru.arhilab.estimate;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** Bounded decode, EXIF correction and independent preview; originals are never retained. */
final class PhotoImage {
 static byte[] encode(ContentResolver resolver,Uri uri,int edge,int maxBytes)throws Exception{
  BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
  try(InputStream in=resolver.openInputStream(uri)){if(in==null)throw new Exception("Фото недоступно");BitmapFactory.decodeStream(in,null,bounds);}
  if(bounds.outWidth<1||bounds.outHeight<1||((long)bounds.outWidth*bounds.outHeight)>180000000L)throw new Exception("Некорректный размер фото");
  BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;
  while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>edge*2)options.inSampleSize*=2;
  options.inPreferredConfig=Bitmap.Config.RGB_565;
  Bitmap source;try(InputStream in=resolver.openInputStream(uri)){source=BitmapFactory.decodeStream(in,null,options);}
  if(source==null)throw new Exception("Не удалось открыть фото");
  int orientation=ExifInterface.ORIENTATION_NORMAL;
  try(InputStream in=resolver.openInputStream(uri)){orientation=new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);}catch(Exception ignored){}
  Matrix matrix=new Matrix();switch(orientation){case ExifInterface.ORIENTATION_ROTATE_90:matrix.postRotate(90);break;case ExifInterface.ORIENTATION_ROTATE_180:matrix.postRotate(180);break;case ExifInterface.ORIENTATION_ROTATE_270:matrix.postRotate(270);break;case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:matrix.postScale(-1,1);break;case ExifInterface.ORIENTATION_FLIP_VERTICAL:matrix.postScale(1,-1);break;case ExifInterface.ORIENTATION_TRANSPOSE:matrix.postRotate(90);matrix.postScale(-1,1);break;case ExifInterface.ORIENTATION_TRANSVERSE:matrix.postRotate(270);matrix.postScale(-1,1);break;}
  Bitmap oriented=matrix.isIdentity()?source:Bitmap.createBitmap(source,0,0,source.getWidth(),source.getHeight(),matrix,true);
  if(oriented!=source)source.recycle();
  int longest=Math.max(oriented.getWidth(),oriented.getHeight());Bitmap scaled=longest>edge?Bitmap.createScaledBitmap(oriented,Math.max(1,Math.round(oriented.getWidth()*edge/(float)longest)),Math.max(1,Math.round(oriented.getHeight()*edge/(float)longest)),true):oriented;
  if(scaled!=oriented)oriented.recycle();
  try{ByteArrayOutputStream out=new ByteArrayOutputStream();for(int quality=85;quality>=55;quality-=10){out.reset();scaled.compress(Bitmap.CompressFormat.JPEG,quality,out);if(out.size()<=maxBytes)return out.toByteArray();}throw new Exception("Фото слишком большое");}finally{scaled.recycle();}
 }
 static byte[] thumbnail(byte[] jpeg)throws Exception{
  BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(jpeg,0,jpeg.length,bounds);
  BitmapFactory.Options opt=new BitmapFactory.Options();opt.inSampleSize=1;while(Math.max(bounds.outWidth,bounds.outHeight)/opt.inSampleSize>480)opt.inSampleSize*=2;
  Bitmap source=BitmapFactory.decodeByteArray(jpeg,0,jpeg.length,opt);if(source==null)throw new Exception("Фото повреждено");
  int longest=Math.max(source.getWidth(),source.getHeight());Bitmap small=longest>320?Bitmap.createScaledBitmap(source,Math.max(1,Math.round(source.getWidth()*320f/longest)),Math.max(1,Math.round(source.getHeight()*320f/longest)),true):source;
  if(small!=source)source.recycle();try{ByteArrayOutputStream out=new ByteArrayOutputStream();small.compress(Bitmap.CompressFormat.JPEG,75,out);return out.toByteArray();}finally{small.recycle();}
 }
}
