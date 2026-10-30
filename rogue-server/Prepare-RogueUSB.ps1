# Prepare-RogueUSB.ps1
# Builds the Rogue Server self-installing USB. Run it from START-HERE.cmd.
#
# What it does, in order:
#   1. Checks the laptop (disk space, OpenSSL from Git, ssh-keygen, SSH key)
#   2. Downloads Ubuntu Server 26.04.1 and verifies its SHA256 (stops on mismatch)
#   3. Asks for your inputs (password and Tailscale key are never shown)
#   4. Builds usb-payload\ (autoinstall.yaml + dashboard + first-boot files)
#   5. Pauses while you flash the USB with Rufus
#   6. Finds the USB, shows it to you, and waits for "yes"
#   7. Copies files to the USB, adds "autoinstall" to GRUB, sets timeout 3s, ejects
#
# It never formats, partitions, or raw-writes any disk. Rufus does that, and you click Start.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$Root       = $PSScriptRoot
$IsoName    = 'ubuntu-26.04.1-live-server-amd64.iso'
$IsoUrl     = "https://releases.ubuntu.com/26.04.1/$IsoName"
$SumsUrl    = 'https://releases.ubuntu.com/26.04.1/SHA256SUMS'
# Checked against Ubuntu's SHA256SUMS on 2026-10-30. The script also re-reads SHA256SUMS live.
$IsoSha256  = 'cc8a95cde20f6ced61a322420de00f10cc3c90ced545daa46cb9c1a117f1d927'
$IsoDir     = Join-Path $Root 'iso'
$IsoPath    = Join-Path $IsoDir $IsoName
$Staging    = Join-Path $Root 'usb-payload'
$Utf8NoBom  = New-Object System.Text.UTF8Encoding($false)

function Say($msg)  { Write-Host "`n$msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Stop-Here($msg) { Write-Host "`nSTOPPED: $msg" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function Ask-YesNo($q) {
  while ($true) {
    $a = (Read-Host "$q (y/n)").Trim().ToLower()
    if ($a -eq 'y' -or $a -eq 'yes') { return $true }
    if ($a -eq 'n' -or $a -eq 'no')  { return $false }
  }
}
function SecureToPlain($s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Write-Lf($path, $text) {
  [IO.File]::WriteAllText($path, ($text -replace "`r`n", "`n"), $Utf8NoBom)
}

# ---------------------------------------------------------------- 1. Laptop checks
Say 'Step 1 of 7: checking the laptop'

$drive = Get-PSDrive -Name ($Root.Substring(0,1))
if ($drive.Free -lt 6GB) { Stop-Here ("Need about 6 GB free on {0}: , found {1:N1} GB." -f $drive.Name, ($drive.Free/1GB)) }
Ok ("{0:N1} GB free" -f ($drive.Free/1GB))

$openssl = $null
$cmd = Get-Command openssl.exe -ErrorAction SilentlyContinue
if ($cmd) { $openssl = $cmd.Source }
foreach ($p in @("$env:ProgramFiles\Git\usr\bin\openssl.exe", "$env:ProgramFiles\Git\mingw64\bin\openssl.exe", "${env:ProgramFiles(x86)}\Git\usr\bin\openssl.exe", "$env:LOCALAPPDATA\Programs\Git\usr\bin\openssl.exe")) {
  if (-not $openssl -and (Test-Path $p)) { $openssl = $p }
}
if (-not $openssl) { Stop-Here 'OpenSSL not found. It comes with Git for Windows (Git Bash). Install that, then run this again.' }
Ok "OpenSSL: $openssl"

if (-not (Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue)) { Stop-Here 'ssh-keygen not found. Turn on Windows "OpenSSH Client" (Settings > Apps > Optional features).' }
$PubKeyPath = Join-Path $env:USERPROFILE '.ssh\id_ed25519.pub'
if (-not (Test-Path $PubKeyPath)) {
  Say 'No SSH key yet. Creating one now. Press Enter to accept the default file, then pick a passphrase (or Enter twice for none).'
  New-Item -ItemType Directory -Force -Path (Split-Path $PubKeyPath) | Out-Null
  & ssh-keygen.exe -t ed25519 -f (Join-Path $env:USERPROFILE '.ssh\id_ed25519')
  if (-not (Test-Path $PubKeyPath)) { Stop-Here 'SSH key was not created.' }
}
$PubKey = (Get-Content $PubKeyPath -Raw).Trim()
if ($PubKey -notmatch '^ssh-ed25519 ') { Stop-Here "$PubKeyPath doesn't look like an ed25519 public key." }
Ok "SSH key: $PubKeyPath"

foreach ($f in @('installer\autoinstall.template.yaml', 'payload\firstboot\rogue-firstboot.sh', 'payload\firstboot\rogue-firstboot.service', 'dashboard\index.html', 'dashboard\data\meta.json')) {
  if (-not (Test-Path (Join-Path $Root $f))) { Stop-Here "Missing $f. Run this from the rogue-server folder you downloaded." }
}
Ok 'Build files present'

# ---------------------------------------------------------------- 2. ISO
Say 'Step 2 of 7: Ubuntu Server ISO'
New-Item -ItemType Directory -Force -Path $IsoDir | Out-Null

try {
  $sums = (& curl.exe -fsSL $SumsUrl) -join "`n"
  $live = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($IsoName) }) -replace '\s.*$', ''
  if ($live -and $live -ne $IsoSha256) { Stop-Here "Ubuntu's SHA256SUMS lists a different hash than this script expects. Not guessing. Ask Claude to recheck." }
  if ($live) { Ok 'Live SHA256SUMS matches the expected hash' }
} catch { Write-Host '  (could not re-read SHA256SUMS, using the hash built into this script)' -ForegroundColor Yellow }

$needDownload = $true
if (Test-Path $IsoPath) {
  Write-Host '  Found an ISO already, checking it...'
  if ((Get-FileHash $IsoPath -Algorithm SHA256).Hash.ToLower() -eq $IsoSha256) { $needDownload = $false; Ok 'Existing ISO verified' }
}
if ($needDownload) {
  Write-Host '  Downloading about 2.9 GB. This can take a while...'
  & curl.exe -fL -C - --retry 5 -o $IsoPath $IsoUrl
  if ($LASTEXITCODE -ne 0) { Stop-Here 'ISO download failed. Run this again, it resumes where it left off.' }
  Write-Host '  Verifying SHA256...'
  $got = (Get-FileHash $IsoPath -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $IsoSha256) { Remove-Item $IsoPath; Stop-Here "ISO hash mismatch (got $got). Deleted it. Run again to re-download." }
  Ok 'ISO downloaded and verified'
}

# ---------------------------------------------------------------- 3. Inputs
Say 'Step 3 of 7: your inputs'

$Username = (Read-Host 'Linux username (lowercase, e.g. kaliko)').Trim()
if ($Username -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { Stop-Here 'Username must be lowercase letters/numbers, starting with a letter.' }
$Hostname = (Read-Host 'Hostname [rogue-server]').Trim()
if (-not $Hostname) { $Hostname = 'rogue-server' }
if ($Hostname -notmatch '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') { Stop-Here 'Hostname must be lowercase letters, numbers, and dashes.' }

while ($true) {
  $p1 = SecureToPlain (Read-Host 'Linux password' -AsSecureString)
  $p2 = SecureToPlain (Read-Host 'Same password again' -AsSecureString)
  if ($p1 -ne $p2) { Write-Host '  They did not match. Try again.' -ForegroundColor Yellow; continue }
  if ($p1.Length -lt 8) { Write-Host '  Use at least 8 characters.' -ForegroundColor Yellow; continue }
  break
}
# SHA-512 crypt hash via OpenSSL. Password goes in on stdin, never on a command line or in a file.
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $openssl; $psi.Arguments = 'passwd -6 -stdin'
$psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.UseShellExecute = $false
$proc = [Diagnostics.Process]::Start($psi)
$proc.StandardInput.Write($p1 + "`n"); $proc.StandardInput.Close()
$PwHash = $proc.StandardOutput.ReadToEnd().Trim(); $proc.WaitForExit()
$p1 = $null; $p2 = $null
if ($PwHash -notmatch '^\$6\$') { Stop-Here 'Password hashing failed.' }
Ok 'Password hashed (SHA-512). The plain password is not saved anywhere.'

Write-Host @'

  Make the Tailscale auth key now:
    Tailscale admin console > Settings > Keys > Generate auth key
    Reusable OFF, Ephemeral OFF, Pre-approved ON, Expiration 1 day
'@
$TsKey = (SecureToPlain (Read-Host 'Paste the auth key (hidden)' -AsSecureString)).Trim()
if ($TsKey -notmatch '^tskey-auth-') { Stop-Here "That doesn't look like a Tailscale auth key (should start with tskey-auth-)." }
Ok 'Auth key received (not shown, only written to the USB)'

Say 'Quick confirmations'
if (-not (Ask-YesNo 'MagicDNS AND HTTPS Certificates are both ON in Tailscale admin > DNS?')) { Stop-Here 'Turn both on first. The https link needs them.' }
if (-not (Ask-YesNo 'Tailscale app is installed and signed in on the Portal, phone, and laptop?')) { Stop-Here 'Set those up first. The Portal can only reach the dashboard through Tailscale.' }
if (-not (Ask-YesNo 'The tower will be plugged into the Netgear router by Ethernet during install?')) { Stop-Here 'The installer needs wired internet.' }

# ---------------------------------------------------------------- 4. Build payload
Say 'Step 4 of 7: building usb-payload'
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $Staging 'payload') | Out-Null
Copy-Item (Join-Path $Root 'dashboard') (Join-Path $Staging 'payload\dashboard') -Recurse
Copy-Item (Join-Path $Root 'payload\firstboot') (Join-Path $Staging 'payload\firstboot') -Recurse
foreach ($f in Get-ChildItem (Join-Path $Staging 'payload\firstboot') -File) { Write-Lf $f.FullName ([IO.File]::ReadAllText($f.FullName)) }

$yaml = [IO.File]::ReadAllText((Join-Path $Root 'installer\autoinstall.template.yaml'))
$yaml = $yaml.Replace('__HOSTNAME__', $Hostname).Replace('__USERNAME__', $Username).Replace('__PASSWORD_HASH__', $PwHash).Replace('__SSH_PUBKEY__', $PubKey)
if ($yaml -match '__[A-Z_]+__') { Stop-Here "autoinstall.yaml still has a placeholder: $($Matches[0])" }
Write-Lf (Join-Path $Staging 'autoinstall.yaml') $yaml
Ok "Staged in $Staging (the auth key is NOT stored here, it goes straight to the USB)"

# ---------------------------------------------------------------- 5. Rufus
Say 'Step 5 of 7: flash the USB with Rufus (you do this part)'
Write-Host @"
  1. Plug in the USB stick. Everything on it will be erased.
  2. Open Rufus. Device: pick the USB stick (double-check it's the right one).
  3. Boot selection: SELECT > $IsoPath
  4. Partition scheme: MBR     Target system: BIOS or UEFI
  5. Leave the rest as is. Click START.
  6. If it asks ISO Image mode or DD Image mode: pick ISO Image mode (Recommended).
  7. If it offers to download newer GRUB files: click Yes.
  8. Wait for READY (green bar), then close Rufus.
"@
Read-Host 'Press Enter here when Rufus says READY'

# ---------------------------------------------------------------- 6. Find + confirm USB
Say 'Step 6 of 7: finding the USB'
$cands = @(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Removable' -and (Test-Path ("{0}:\casper" -f $_.DriveLetter)) })
if ($cands.Count -eq 0) { Stop-Here 'No removable drive with a casper folder found. Did Rufus finish, in ISO Image mode?' }
$vol = $cands[0]
if ($cands.Count -gt 1) {
  for ($i = 0; $i -lt $cands.Count; $i++) { Write-Host ("  [{0}] {1}:  {2}  {3:N1} GB" -f $i, $cands[$i].DriveLetter, $cands[$i].FileSystemLabel, ($cands[$i].Size/1GB)) }
  $vol = $cands[[int](Read-Host 'More than one found. Type the number to use')]
}
$Usb = "{0}:\" -f $vol.DriveLetter
Write-Host ''
Write-Host ("  Drive letter : {0}:" -f $vol.DriveLetter) -ForegroundColor White
Write-Host ("  Label        : {0}" -f $vol.FileSystemLabel) -ForegroundColor White
Write-Host ("  Size         : {0:N1} GB" -f ($vol.Size/1GB)) -ForegroundColor White
Write-Host ("  casper folder: found") -ForegroundColor White
$confirm = Read-Host "`nCopy the Rogue Server files to this drive? Type yes to continue"
if ($confirm.Trim().ToLower() -ne 'yes') { Stop-Here 'You did not type yes. Nothing was copied.' }

# ---------------------------------------------------------------- 7. Copy + GRUB
Say 'Step 7 of 7: copying files and setting up GRUB'
Copy-Item (Join-Path $Staging 'autoinstall.yaml') $Usb -Force
if (Test-Path (Join-Path $Usb 'payload')) { Remove-Item (Join-Path $Usb 'payload') -Recurse -Force }
Copy-Item (Join-Path $Staging 'payload') $Usb -Recurse -Force
[IO.File]::WriteAllText((Join-Path $Usb 'payload\ts-authkey'), $TsKey, (New-Object System.Text.ASCIIEncoding))
$TsKey = $null
Ok 'autoinstall.yaml and payload\ copied next to casper'

function Patch-Grub($path) {
  if (-not (Test-Path $path)) { return $false }
  $text = [IO.File]::ReadAllText($path) -replace "`r`n", "`n"
  $lines = $text -split "`n"
  $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*set\s+timeout=') { $lines[$i] = $lines[$i] -replace 'timeout=\S+', 'timeout=3' }
    # First "linux" line belongs to the first (default) menuentry.
    if (-not $done -and $lines[$i] -match '^\s*linux\s' -and $lines[$i] -match '\s---') {
      if ($lines[$i] -notmatch '\sautoinstall(\s|$)') { $lines[$i] = $lines[$i] -replace '\s---', ' autoinstall ---' }
      $done = $true
    }
  }
  if (-not $done) { Stop-Here "Couldn't find the kernel line in $path. Not guessing. Ask Claude to look." }
  Write-Lf $path ($lines -join "`n")
  return $true
}
$grub = Join-Path $Usb 'boot\grub\grub.cfg'
if (-not (Patch-Grub $grub)) { Stop-Here "$grub not found." }
Ok 'grub.cfg: autoinstall added to default entry, timeout 3s'
if (Patch-Grub (Join-Path $Usb 'boot\grub\loopback.cfg')) { Ok 'loopback.cfg patched too' }

# Final check
$g = [IO.File]::ReadAllText($grub)
$checks = @(
  @{ n = 'autoinstall.yaml on USB'; ok = Test-Path (Join-Path $Usb 'autoinstall.yaml') },
  @{ n = 'payload\dashboard on USB'; ok = Test-Path (Join-Path $Usb 'payload\dashboard\index.html') },
  @{ n = 'payload\firstboot on USB'; ok = Test-Path (Join-Path $Usb 'payload\firstboot\rogue-firstboot.sh') },
  @{ n = 'Tailscale key on USB';     ok = (Get-Item (Join-Path $Usb 'payload\ts-authkey')).Length -gt 20 },
  @{ n = 'GRUB autoinstall keyword'; ok = $g -match 'linux\s+\S+.*\sautoinstall\s+---' },
  @{ n = 'GRUB timeout 3';           ok = $g -match 'set\s+timeout=3' }
)
$bad = $false
foreach ($c in $checks) { if ($c.ok) { Ok $c.n } else { Write-Host "  FAIL $($c.n)" -ForegroundColor Red; $bad = $true } }
if ($bad) { Stop-Here 'A final check failed. Do not use this USB yet.' }

# Eject
try {
  (New-Object -ComObject Shell.Application).Namespace(17).ParseName($Usb.TrimEnd('\')).InvokeVerb('Eject')
  Ok 'USB ejected. Safe to remove.'
} catch { Write-Host '  Could not auto-eject. Use "Safely Remove Hardware" before pulling it.' -ForegroundColor Yellow }

Say 'DONE. Next: follow docs\TOWER-STEPS.md (start with the Caps Lock test).'
Write-Host '  Reminder: the Tailscale key expires in 1 day, so install the tower today.' -ForegroundColor Yellow
Read-Host 'Press Enter to close'
