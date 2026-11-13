param([string]$Blend, [string]$Version = "dev", [string]$Log = "$env:TEMP\export_glb.log")
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path (Split-Path -Parent $here) "assets"
$p = Start-Process -FilePath "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" `
  -ArgumentList "-b",$Blend,"-t","4","--python",(Join-Path $here "export_glb.py"),"--",(Join-Path $out "van.glb"),(Join-Path $out "manifest.json"),"--version",$Version `
  -PassThru -NoNewWindow -RedirectStandardOutput $Log
$p.PriorityClass = "BelowNormal"; $p.WaitForExit()
