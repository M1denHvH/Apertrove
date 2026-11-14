param([Parameter(Mandatory=$true)][ValidateLength(1,160)][string]$Model,[switch]$Probe)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport,Guid("5EB2502A-8CF1-11D1-BF92-0060081ED811"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ApertroveWiaManager {
 [PreserveSig] int EnumDeviceInfo(uint flags,out IntPtr result);
 [PreserveSig] int CreateDevice([MarshalAs(UnmanagedType.BStr)] string id,[MarshalAs(UnmanagedType.Interface)] out object root);
}
[ComImport,Guid("6291EF2C-36EF-4532-876A-8E132593778D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ApertroveWiaExtras {
 [PreserveSig] int GetExtendedErrorInfo([MarshalAs(UnmanagedType.BStr)] out string text);
 [PreserveSig] int Escape(uint code,IntPtr input,uint inputSize,IntPtr output,uint outputSize,out uint actual);
 [PreserveSig] int CancelPendingIO();
}
public static class ApertroveFlash {
 static byte[] Exchange(ApertroveWiaExtras extras,ushort opcode,bool read) {
  byte[] input=new byte[38],output=new byte[65566];input[0]=(byte)opcode;input[1]=(byte)(opcode>>8);input[34]=(byte)(read?3:5);
  IntPtr pin=Marshal.AllocCoTaskMem(input.Length),pout=Marshal.AllocCoTaskMem(output.Length);
  try {Marshal.Copy(input,0,pin,input.Length);uint actual;int hr=extras.Escape(0x100,pin,(uint)input.Length,pout,(uint)output.Length,out actual);
   if(hr<0)throw new Exception("WIA HRESULT 0x"+hr.ToString("X8"));if(actual<30||actual>output.Length)throw new Exception("Invalid PTP response size");
   Marshal.Copy(pout,output,0,(int)actual);int response=BitConverter.ToUInt16(output,0);if(response!=0x2001)throw new Exception("PTP response 0x"+response.ToString("X4"));
   byte[] data=new byte[actual-30];Array.Copy(output,30,data,0,data.Length);return data;
  } finally {Marshal.FreeCoTaskMem(pin);Marshal.FreeCoTaskMem(pout);}
 }
 static bool SupportsPopup(byte[] data) {
  if(data.Length<15)return false;int offset=8;int textLength=data[offset];offset+=1+textLength*2+2;if(offset+4>data.Length)return false;
  uint count=BitConverter.ToUInt32(data,offset);offset+=4;if(count>4096||offset+count*2>data.Length)return false;
  for(int i=0;i<count;i++)if(BitConverter.ToUInt16(data,offset+i*2)==0x9131)return true;return false;
 }
 public static bool Run(string id,bool probe) {
  object manager=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("A1F4E726-8CF1-11D1-BF92-0060081ED811"))),root=null;
  try {int hr=((ApertroveWiaManager)manager).CreateDevice(id,out root);Marshal.ThrowExceptionForHR(hr);var extras=(ApertroveWiaExtras)root;
   bool supported=SupportsPopup(Exchange(extras,0x1001,true));if(!probe){if(!supported)throw new Exception("Camera does not advertise built-in flash popup");Exchange(extras,0x9131,false);}return supported;
  } finally {if(root!=null)Marshal.ReleaseComObject(root);Marshal.ReleaseComObject(manager);}
 }
}
'@
function Normalized([string]$Name){return ($Name.ToLowerInvariant() -replace '[^a-z0-9]','')}
$manager=New-Object -ComObject WIA.DeviceManager
try {
 $expected=Normalized $Model
 $cameras=@($manager.DeviceInfos | Where-Object { $_.Type -eq 2 -and (Normalized (($_.Properties | Where-Object Name -eq 'Name').Value)) -eq $expected })
 if($cameras.Count -eq 0){throw 'Camera not found in Windows WIA'}
 if($cameras.Count -gt 1){throw 'Multiple matching cameras in Windows WIA; disconnect the other identical camera'}
 $available=[ApertroveFlash]::Run($cameras[0].DeviceID,$Probe.IsPresent)
 @{available=$available;accepted=(-not $Probe.IsPresent -and $available)} | ConvertTo-Json -Compress
}finally{[Runtime.InteropServices.Marshal]::FinalReleaseComObject($manager) | Out-Null}
