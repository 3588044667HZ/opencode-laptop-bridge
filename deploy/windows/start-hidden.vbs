Option Explicit

Dim fso, shell, project, launcher, logDir, logFile, command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' This file lives in deploy\windows, so the project root is three levels up.
project = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
launcher = fso.BuildPath(project, "deploy\windows\start-bridge.ps1")
If Not fso.FileExists(launcher) Then WScript.Quit 1

logDir = fso.BuildPath(project, "logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = fso.BuildPath(logDir, "bridge.log")

shell.CurrentDirectory = project
command = "cmd.exe /d /c powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Quote(launcher) & " >> " & Quote(logFile) & " 2>&1"
shell.Run command, 0, False

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
