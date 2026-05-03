$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\GhostArcade.lnk")

# Point to the installer so user can install it
$InstallerPath = "C:\Users\justi\OneDrive\Documents\001RISKCAPITAL\CustomPlugins\ghost-arcade\src-tauri\target\release\bundle\nsis\GhostArcade_0.1.0_x64-setup.exe"

if (Test-Path $InstallerPath) {
    Write-Host "Found GhostArcade installer!"
    Write-Host ""
    Write-Host "To install GhostArcade as a standalone app, run:"
    Write-Host $InstallerPath
    Write-Host ""
    Write-Host "After installation, GhostArcade will be available in your Start menu and you can pin it to taskbar."

    # Open explorer to the installer location
    explorer.exe /select,$InstallerPath
} else {
    Write-Host "Installer not found at: $InstallerPath"
}
