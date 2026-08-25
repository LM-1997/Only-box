<#
.SYNOPSIS
    正版化检查工具验证脚本 —— 修改 Windows / Microsoft Office / WPS 的安装日期(测试用途)

.DESCRIPTION
    本脚本用于验证"正版软件检查工具客户端-2026版"的安装日期采集逻辑。
    它修改的数据源与该工具读取的数据源完全一致:

    [1] Windows 安装日期
        HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\InstallDate  (REG_DWORD, Unix 秒)
        工具通过 "cmd /c systeminfo /FO LIST" 的 Original Install Date 读取(底层是同一注册表值)

    [2] Microsoft Office 安装日期(专业增强版等)
        卸载注册表键下的 InstallDate 值:
        - HKLM\...\CurrentVersion\Uninstall\<Office子键>
        - HKLM\...\Wow6432Node\...\Uninstall\<Office子键>   (32 位软件)
        - HKCU\...\Uninstall\<Office子键>

        【覆盖所有版本】匹配规则基于 DisplayName 通配:
        "Microsoft Office ..." 或 "Microsoft 365 ..." 均命中,包括:
        - Office 2013 / 2016 / 2019 / 2021 / 2024 专业增强版(Professional Plus)
        - Office 家庭和学生版 / 家庭和企业版 / 小型企业版 / 标准版等
        - Microsoft 365 应用版(原 Office 365 ProPlus)
        - 中英文语言包、Proofing、MUI 等干扰项会被排除

        【MSI 版 vs Click-to-Run 版(微软官方文档确认)】
        - 2013/2016 同时存在 MSI 与 C2R 两种部署;
        - 2019/2021/2024 仅 C2R 部署;
        - InstallDate 是 Windows Installer(MSI)属性,MSI 安装的键上有值,
          且每次打补丁会被 MSI 重写;
        - C2R 安装的卸载键通常没有 InstallDate,脚本会自动新建
          REG_SZ "YYYYMMDD"(与微软官方卸载工具 OffScrub 的做法一致),
          正版检查工具 RegQueryValueExW 读到即生效。

    [3] WPS Office(教育版等)安装日期
        - HKLM/HKCU\SOFTWARE\kingsoft\Office\6.0\Common\InstallTime
        - <WPS安装目录>\utility\install.ini 中的安装时间字段
        - 卸载注册表键 "WPS Office" 的 InstallDate

    所有被修改的值都会先备份到 BackupFile(默认脚本同目录 InstallDateBackup.json),
    可用 -Restore 参数一键还原。

    注意:修改 HKLM 需要管理员权限;修改后 Windows 系统多处会显示新的"安装日期",
          测试完成后请及时还原。

.PARAMETER Date
    目标安装日期。支持格式:
      "2025-01-15"            -> 当天 00:00:00
      "2025-01-15 09:30"      -> 精确到分钟
      "2025-01-15 09:30:00"   -> 精确到秒
      "20250115"              -> 8 位数字,当天 00:00:00

.PARAMETER Restore
    从备份文件还原所有原始值(不修改任何新值)。

.PARAMETER BackupFile
    备份文件路径。默认:脚本所在目录\InstallDateBackup.json

.EXAMPLE
    # 把所有安装日期改为 2025-01-15
    .\Set-InstallDate.ps1 -Date 2025-01-15

.EXAMPLE
    # 改为带时间的日期
    .\Set-InstallDate.ps1 -Date "2024-06-01 08:30:00"

.EXAMPLE
    # 一键还原
    .\Set-InstallDate.ps1 -Restore
#>
[CmdletBinding()]
param(
    [string]$Date,
    [switch]$Restore,
    [string]$BackupFile = ""
)

$ErrorActionPreference = 'Stop'

# ---------- 辅助函数 ----------

function Write-Step($msg) { Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertTo-UnixSeconds([datetime]$localTime) {
    $offset = [TimeZoneInfo]::Local.GetUtcOffset($localTime)
    return [DateTimeOffset]::new($localTime, $offset).ToUnixTimeSeconds()
}

function Get-ValueInfo($regPath, $valueName) {
    # 返回 @{ Exists; Kind; Value } —— 用 .NET API 保留注册表值类型
    try {
        $root = $regPath.Split('\')[0].ToUpper()
        $sub  = $regPath.Substring($regPath.IndexOf('\') + 1)
        $hive = switch ($root) {
            'HKLM:' { [Microsoft.Win32.Registry]::LocalMachine }
            'HKCU:' { [Microsoft.Win32.Registry]::CurrentUser }
            default { $null }
        }
        if (-not $hive) { return @{ Exists = $false } }
        $key = $hive.OpenSubKey($sub)
        if (-not $key) { return @{ Exists = $false } }
        try {
            if ($key.GetValueNames() -notcontains $valueName) { return @{ Exists = $false } }
            return @{ Exists = $true; Kind = $key.GetValueKind($valueName).ToString(); Value = $key.GetValue($valueName) }
        } finally { $key.Close() }
    } catch {
        return @{ Exists = $false }
    }
}

function Set-RegValue($regPath, $valueName, $newValue, $kind) {
    # 用 .NET API 写入,保留原始值类型
    $root = $regPath.Split('\')[0].ToUpper()
    $sub  = $regPath.Substring($regPath.IndexOf('\') + 1)
    $hive = switch ($root) {
        'HKLM:' { [Microsoft.Win32.Registry]::LocalMachine }
        'HKCU:' { [Microsoft.Win32.Registry]::CurrentUser }
        default { throw "未知根键: $root" }
    }
    $key = $hive.OpenSubKey($sub, $true)
    if (-not $key) { throw "无法以写权限打开: $regPath" }
    try {
        $regKind = [Microsoft.Win32.RegistryValueKind]::$kind
        $key.SetValue($valueName, $newValue, $regKind)
    } finally { $key.Close() }
}

function Remove-RegValue($regPath, $valueName) {
    $root = $regPath.Split('\')[0].ToUpper()
    $sub  = $regPath.Substring($regPath.IndexOf('\') + 1)
    $hive = switch ($root) {
        'HKLM:' { [Microsoft.Win32.Registry]::LocalMachine }
        'HKCU:' { [Microsoft.Win32.Registry]::CurrentUser }
        default { throw "未知根键: $root" }
    }
    $key = $hive.OpenSubKey($sub, $true)
    if ($key) {
        try { $key.DeleteValue($valueName, $false) } finally { $key.Close() }
    }
}

function Format-DateString($dt, $originalSample) {
    # 按原样本格式输出新日期字符串
    if ($originalSample -match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}') { return $dt.ToString('yyyy-MM-dd HH:mm:ss') }
    if ($originalSample -match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}')      { return $dt.ToString('yyyy-MM-dd HH:mm') }
    if ($originalSample -match '^\d{4}/\d{2}/\d{2}')                  { return $dt.ToString('yyyy/MM/dd') }
    if ($originalSample -match '^\d{4}-\d{2}-\d{2}')                  { return $dt.ToString('yyyy-MM-dd') }
    return $dt.ToString('yyyy-MM-dd HH:mm:ss')
}

function Get-Prop($obj, $name) {
    if ($null -eq $obj) { return $null }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p) { return $null }
    return $p.Value
}

# ---------- 参数与前置检查 ----------

if (-not $BackupFile) {
    $BackupFile = Join-Path $PSScriptRoot 'InstallDateBackup.json'
}

# 已有旧备份时保留一份,不静默覆盖(防止丢失上一次还原点)
if ((Test-Path $BackupFile) -and -not $Restore) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $keep = "$BackupFile.$stamp.bak"
    Copy-Item $BackupFile $keep
    Write-Warn2 "检测到旧备份,已保留为: $keep"
}

if ($Restore) {
    if (-not (Test-Path $BackupFile)) {
        Write-Host "未找到备份文件: $BackupFile" -ForegroundColor Red
        exit 1
    }
    $backup = Get-Content $BackupFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Step "开始还原(备份创建于 $($backup.CreatedAt))"

    if ($backup.WindowsInstallDate) {
        $wi = $backup.WindowsInstallDate
        Set-RegValue $wi.Path $wi.ValueName $wi.Value $wi.Kind
        Write-Ok "Windows 安装日期已还原: $($wi.Value) ($($wi.Kind))"
    }
    foreach ($item in @($backup.OfficeKeys) + @($backup.WpsUninstallKeys) + @($backup.WpsKeys)) {
        if (-not $item) { continue }
        if ($item.Existed) {
            Set-RegValue $item.Path $item.ValueName $item.Value $item.Kind
            Write-Ok "已还原: $($item.Path)\$($item.ValueName) = $($item.Value)"
        } else {
            Remove-RegValue $item.Path $item.ValueName
            Write-Ok "已删除(还原为原本不存在): $($item.Path)\$($item.ValueName)"
        }
    }
    foreach ($ini in @($backup.WpsIniFiles)) {
        if ($ini -and $ini.Path -and (Test-Path $ini.Path) -and $ini.OriginalBase64) {
            [System.IO.File]::WriteAllBytes($ini.Path, [Convert]::FromBase64String($ini.OriginalBase64))
            Write-Ok "已还原: $($ini.Path)"
        }
    }
    Write-Host "`n还原完成。" -ForegroundColor Green
    exit 0
}

if (-not $Date) {
    $Date = Read-Host '请输入目标安装日期 (格式: YYYY-MM-DD 或 YYYY-MM-DD HH:mm, 例如 2025-01-15)'
}

# 解析日期
$dt = [datetime]::MinValue
$clean = $Date.Trim()
if ($clean -match '^\d{8}$') {
    $clean = $clean.Substring(0,4) + '-' + $clean.Substring(4,2) + '-' + $clean.Substring(6,2)
}
if (-not [datetime]::TryParse($clean, [ref]$dt)) {
    Write-Host "日期格式无法解析: '$Date'。示例: 2025-01-15 或 2025-01-15 09:30" -ForegroundColor Red
    exit 1
}
# 只有日期没有时间 -> 补零点
if ($clean -notmatch ':\d{2}') {
    $dt = [datetime]::new($dt.Year, $dt.Month, $dt.Day, 0, 0, 0)
}

$isAdmin = Test-Admin
if (-not $isAdmin) {
    Write-Warn2 "当前不是管理员权限,HKLM 部分(Windows 安装日期、Office 卸载键、WPS HKLM 键)将无法修改;HKCU 部分可以。建议用管理员身份重新运行 PowerShell。"
}

$epoch      = ConvertTo-UnixSeconds $dt
$dateStr    = $dt.ToString('yyyy-MM-dd')
$dateStrFull = $dt.ToString('yyyy-MM-dd HH:mm:ss')
$dateCompact = $dt.ToString('yyyyMMdd')

if ($epoch -gt [int]::MaxValue) {
    Write-Warn2 "目标日期过晚:Unix 秒 $epoch 超过 32 位上限 $([int]::MaxValue)(对应 2038-01-19),DWord 类型值将无法写入,请改用 2038 年之前的日期"
}

Write-Host "`n========== 目标日期 ==========" -ForegroundColor Cyan
Write-Host "  本地时间 : $dateStrFull"
Write-Host "  Unix 秒  : $epoch   (Windows InstallDate / WPS InstallTime 的 DWORD 值)"
Write-Host "  紧凑格式 : $dateCompact   (卸载键 InstallDate 的字符串值)"
Write-Host "  备份文件 : $BackupFile"

$backup = [ordered]@{
    CreatedAt          = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    TargetDate         = $dateStrFull
    WindowsInstallDate = $null
    OfficeKeys         = @()
    WpsUninstallKeys   = @()
    WpsKeys            = @()
    WpsIniFiles        = @()
}

# ========== 1. Windows 安装日期 ==========
Write-Step "1/4 修改 Windows 安装日期"
$winPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$winInfo = Get-ValueInfo $winPath 'InstallDate'
if ($winInfo.Exists) {
    $backup.WindowsInstallDate = [ordered]@{ Path = $winPath; ValueName = 'InstallDate'; Kind = $winInfo.Kind; Value = $winInfo.Value }
    if ($isAdmin) {
        Set-RegValue $winPath 'InstallDate' $epoch 'DWord'
        $after = Get-ValueInfo $winPath 'InstallDate'
        Write-Ok "已修改: $winPath\InstallDate"
        Write-Host "         原值: $($winInfo.Value)  ->  新值: $($after.Value)"
    } else {
        Write-Warn2 "跳过(需要管理员): $winPath\InstallDate"
    }
} else {
    Write-Warn2 "未找到 InstallDate 值(跳过): $winPath"
}

# ========== 2. Office / WPS 卸载注册表键 ==========
Write-Step "2/4 修改卸载注册表键中的 Office / WPS InstallDate"
$uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
$officeCount = 0
$wpsUnCount  = 0
foreach ($root in $uninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {
        $subPath   = $_.PSPath
        $childName = $_.PSChildName
        $props     = Get-ItemProperty -Path $subPath -ErrorAction SilentlyContinue
        $disp      = Get-Prop $props 'DisplayName'
        $pub       = Get-Prop $props 'Publisher'
        if (-not $disp) { return }

        # 排除语言包/校对等干扰项(与工具 ExcludeFeature 思路一致)
        if ($disp -match '语言包|Proofing|Language Pack|MUI') { return }

        # Office 匹配:覆盖 2013/2016/2019/2021/2024/365 所有中英文形式
        $isOffice = ($disp -match 'Microsoft (Office|365)') -or (($disp -match 'Office') -and ($pub -match 'Microsoft'))
        $isWps    = ($disp -match 'WPS') -or ($pub -match 'Kingsoft') -or ($childName -match 'WPS')
        if (-not ($isOffice -or $isWps)) { return }

        $info  = Get-ValueInfo $subPath 'InstallDate'
        $kind  = if ($info.Exists) { $info.Kind } else { 'String' }
        $newVal = if ($kind -eq 'DWord' -or $kind -eq 'QWord') { $epoch } else { $dateCompact }

        $rec = [ordered]@{ Path = $subPath; ValueName = 'InstallDate'; Kind = $kind; Existed = $info.Exists; Value = $info.Value }
        if ($isOffice) {
            $backup.OfficeKeys += $rec
            $tag = 'Office'
            $officeCount++
        } else {
            $backup.WpsUninstallKeys += $rec
            $tag = 'WPS'
            $wpsUnCount++
        }

        $canWrite = $subPath.StartsWith('HKCU:') -or $isAdmin
        if ($canWrite) {
            try {
                Set-RegValue $subPath 'InstallDate' $newVal $kind
                Write-Ok "[$tag] $disp"
                Write-Host "         $subPath"
                Write-Host "         原值: $(if($info.Exists){$info.Value}else{'(无)'})  ->  新值: $newVal"
            } catch {
                Write-Warn2 "[$tag] 写入失败: $subPath ($($_.Exception.Message))"
            }
        } else {
            Write-Warn2 "[$tag] 跳过(需要管理员): $disp"
        }
    }
}
Write-Ok "Office 键 $officeCount 个, WPS 键 $wpsUnCount 个"

# ========== 3. WPS kingsoft InstallTime ==========
Write-Step "3/4 修改 WPS kingsoft 注册表 InstallTime"
$kingRoots = @(
    'HKLM:\SOFTWARE\kingsoft\Office\6.0\Common',
    'HKLM:\SOFTWARE\WOW6432Node\kingsoft\Office\6.0\Common',
    'HKCU:\SOFTWARE\kingsoft\Office\6.0\Common'
)
foreach ($kpath in $kingRoots) {
    if (-not (Test-Path $kpath)) { continue }
    $info = Get-ValueInfo $kpath 'InstallTime'
    if (-not $info.Exists) { Write-Warn2 "键存在但无 InstallTime: $kpath"; continue }

    $kind = $info.Kind
    if ($kind -eq 'DWord' -or $kind -eq 'QWord') {
        $newVal = $epoch
    } else {
        $sample = "$($info.Value)"
        if ($sample -match '^\d+$') { $newVal = "$epoch" }
        else { $newVal = Format-DateString $dt $sample }
    }

    $backup.WpsKeys += [ordered]@{ Path = $kpath; ValueName = 'InstallTime'; Kind = $kind; Existed = $true; Value = $info.Value }
    $canWrite = $kpath.StartsWith('HKCU:') -or $isAdmin
    if ($canWrite) {
        try {
            Set-RegValue $kpath 'InstallTime' $newVal $kind
            Write-Ok "已修改: $kpath\InstallTime"
            Write-Host "         原值: $($info.Value)  ->  新值: $newVal"
        } catch {
            Write-Warn2 "写入失败: $kpath ($($_.Exception.Message))"
        }
    } else {
        Write-Warn2 "跳过(需要管理员): $kpath"
    }
}

# ========== 4. WPS utility\install.ini ==========
Write-Step "4/4 修改 WPS utility\install.ini"
$candidates = @()
foreach ($root in $uninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {
        $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
        $disp  = Get-Prop $props 'DisplayName'
        $loc   = Get-Prop $props 'InstallLocation'
        if ($disp -match 'WPS' -and $loc) { $candidates += $loc }
    }
}
$candidates += @(
    (Join-Path $env:LOCALAPPDATA 'Kingsoft\WPS Office'),
    'C:\Program Files (x86)\Kingsoft\WPS Office',
    'C:\Program Files\Kingsoft\WPS Office'
)
$iniPaths = @($candidates |
    Where-Object { $_ -and (Test-Path $_) } |
    ForEach-Object { Join-Path $_ 'utility\install.ini' } |
    Where-Object { Test-Path $_ } |
    Select-Object -Unique)

if ($iniPaths.Count -eq 0) {
    Write-Warn2 "未找到 WPS 的 utility\install.ini(请手动检查 WPS 安装目录)"
} else {
    foreach ($ini in $iniPaths) {
        # 备份(原始字节 Base64,避免编码问题)
        $bytes = [System.IO.File]::ReadAllBytes($ini)
        $backup.WpsIniFiles += [ordered]@{ Path = $ini; OriginalBase64 = [Convert]::ToBase64String($bytes) }

        # 字节级行处理:Latin1(ISO-8859-1)是 0-255 字节的无损映射,
        # 不依赖 BOM/GBK/UTF-8 猜测,未修改的行写回时字节完全不变,
        # 彻底规避编码损坏风险(同时兼容 PS5.1 / PS7)
        $enc  = [System.Text.Encoding]::GetEncoding(28591)
        $text = $enc.GetString($bytes)
        $eol  = if ($text.Contains("`r`n")) { "`r`n" } elseif ($text.Contains("`n")) { "`n" } else { "`r`n" }
        $lines  = $text -split "`r?`n"
        $changed = 0
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($line -match '^\s*[#;]') { continue }
            if ($line -match '^([^=]+)=(.*)$') {
                $field  = $Matches[1].Trim()
                $oldVal = $Matches[2].Trim()   # 立即捕获,避免被后续 -match 覆盖 $Matches
                if ($field -match '(?i)(time|date)') {
                    if ($oldVal -match '^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$') {
                        $newVal = Format-DateString $dt $oldVal
                    } elseif ($oldVal -match '^\d+$') {
                        $newVal = "$epoch"
                    } else {
                        $newVal = $dateStrFull
                    }
                    $lines[$i] = "$field=$newVal"
                    Write-Ok "  $ini : [$field] $oldVal -> $newVal"
                    $changed++
                }
            }
        }
        if ($changed -eq 0) {
            Write-Warn2 "  $ini : 未找到时间/日期字段(已备份,请手动检查)"
        } else {
            $outText = $lines -join $eol
            [System.IO.File]::WriteAllBytes($ini, $enc.GetBytes($outText))
            Write-Ok "  $ini 已写回(共修改 $changed 个字段,字节级处理无编码损坏)"
        }
    }
}

# ========== 保存备份 ==========
$backupJson = $backup | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($BackupFile, $backupJson, [Text.Encoding]::UTF8)
Write-Step "备份已保存: $BackupFile"

# ========== 验证输出 ==========
Write-Step "验证(修改后的当前值)"
if ($isAdmin) {
    try {
        $sysinfo = & cmd.exe /c systeminfo 2>$null
        $sysinfo | Select-String 'Original Install Date|初始安装日期|原始安装日期' | ForEach-Object {
            Write-Host "[systeminfo] $($_.Line.Trim())"
        }
    } catch {
        Write-Warn2 "systeminfo 执行失败(可手动运行验证)"
    }
}
foreach ($root in $uninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {
        $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
        $disp  = Get-Prop $props 'DisplayName'
        $inst  = Get-Prop $props 'InstallDate'
        if ($disp -match 'Microsoft (Office|365)|WPS' -and $inst) {
            Write-Host "[卸载键] $disp  InstallDate=$inst  ($($_.PSPath))"
        }
    }
}
foreach ($kpath in $kingRoots) {
    $info = Get-ValueInfo $kpath 'InstallTime'
    if ($info.Exists) { Write-Host "[kingsoft] $kpath\InstallTime = $($info.Value) ($($info.Kind))" }
}

Write-Host "`n========== 完成 ==========" -ForegroundColor Green
Write-Host "已修改的目标日期: $dateStrFull"
Write-Host "下一步: 重启客户端(或等待服务器下发检查指令),查看上报 JSON 中 softwares[].date 字段是否变为 $dateStr"
Write-Host "日志位置: %APPDATA%\SoftwareInspect\Log\"
Write-Host "还原方法: .\Set-InstallDate.ps1 -Restore"
