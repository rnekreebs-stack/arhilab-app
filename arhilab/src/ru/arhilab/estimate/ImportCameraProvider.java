package ru.arhilab.estimate;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** One private temporary camera destination, never exposed as an original document. */
public final class ImportCameraProvider extends ContentProvider {
 public boolean onCreate(){return true;}
 public String getType(Uri uri){return "image/jpeg";}
 public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){return null;}
 public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
 public int delete(Uri uri,String where,String[] args){return 0;}
 public int update(Uri uri,ContentValues values,String where,String[] args){return 0;}
 public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  if(!"capture".equals(uri.getLastPathSegment()))throw new FileNotFoundException();
  File target=new File(getContext().getCacheDir(),"estimate-capture.jpg");
  return ParcelFileDescriptor.open(target,mode.contains("w")?ParcelFileDescriptor.MODE_CREATE|ParcelFileDescriptor.MODE_TRUNCATE|ParcelFileDescriptor.MODE_READ_WRITE:ParcelFileDescriptor.MODE_READ_ONLY);
 }
}
