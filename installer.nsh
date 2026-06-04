!macro customInstall
  DetailPrint "Adding Firewall Exception for ZKTeco ADMS Server..."
  ; Remove any old rules just in case
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ZKTeco ADMS Server"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ZKTeco ADMS App"'
  
  ; Allow the specific program (the installed .exe) on all profiles
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ZKTeco ADMS App" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" profile=any'
  
  ; Allow the default port (80) or 8081 if they used that. We will allow the program itself which is usually enough, but we can also open a range or specific ports.
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ZKTeco ADMS Server" dir=in action=allow protocol=TCP localport=80,8081 profile=any'
!macroend

!macro customUnInstall
  DetailPrint "Removing Firewall Exception for ZKTeco ADMS Server..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ZKTeco ADMS Server"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ZKTeco ADMS App"'
!macroend
