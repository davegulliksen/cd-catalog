param(
    [switch]$DryRun,
    [switch]$DebugApi
)

Write-Host "SCRIPT RUNNING UNDER: $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)"
Write-Host ""

# ============================
# GitHub Configuration
# ============================
$repoOwner    = "davegulliksen"
$repoName     = "CD-Catalog"
$branch       = "main"
$githubCdRoot = "CD"

# ROOT OF YOUR REAL FLAC LIBRARY
$root = "L:\Users\fran\Music\Foobar2000 flac"

# ============================
# Log File
# ============================
$logFile = Join-Path $PSScriptRoot "upload_log.txt"
Set-Content -Path $logFile -Value "=== New Run Started $(Get-Date) ==="

function Log {
    param([string]$Message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -Path $logFile -Value "$timestamp  $Message"
    Write-Host $Message
}

# ============================
# GitHub Auth Check
# ============================
$authStatus = gh auth status 2>&1
if ($authStatus -match "not logged in" -or $authStatus -match "You are not logged into any GitHub hosts") {
    Log "ERROR: GitHub CLI is not authenticated. Run: gh auth login"
    exit 1
}
Log "GitHub CLI authentication detected."

# ============================
# Helpers
# ============================
function Encode-UrlSegment {
    param([string]$Segment)
    [System.Uri]::EscapeDataString($Segment)
}

function Get-AlbumFolderName {
    param([string]$AlbumFolderPath)

    $firstFlac = Get-ChildItem -Path $AlbumFolderPath -File -Filter *.flac | Select-Object -First 1
    if (-not $firstFlac) { return $null }

    $ffprobeOutput = ffprobe -v error -show_entries format_tags=album -of default=nw=1:nk=1 -- "$($firstFlac.FullName)" 2>$null
    $albumMeta = $ffprobeOutput.Trim()
    if ([string]::IsNullOrWhiteSpace($albumMeta)) { return $null }

    if ($albumMeta -match "^(.* )(.+)$") { $Matches[2] } else { $albumMeta }
}

$global:StopAll = $false

# Precomputed base64 for "."
$global:Base64Dot = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("."))

# Track which album folders we've already checked/created
$script:AlbumChecked = @{}

# ============================
# Rate Limit Detection
# ============================
function Test-RateLimit {
    param([string]$Raw)

    if ($Raw -match "API rate limit exceeded" -or
        $Raw -match "secondary rate limit"   -or
        $Raw -match '"status":"403"'         -or
        $Raw -match '"status":"429"') {
        return $true
    }
    return $false
}

function Get-RetryAfterSeconds {
    param([string]$Raw)

    try {
        $json = $Raw | ConvertFrom-Json
        if ($json.retry_after) { return [int]$json.retry_after }
    } catch { }
    return $null
}

# ============================
# Suspicious Response Detection
# ============================
function Is-SuspiciousResponse {
    param($JsonObject, [string]$Raw)

    if (-not $JsonObject) { return $true }
    if ($Raw -match "<html" -or $Raw -match "<!DOCTYPE html") { return $true }
    if (-not $JsonObject.type -or -not $JsonObject.sha) { return $true }
    if ($JsonObject.type -ne "file") { return $true }
    return $false
}

# ============================
# GitHub API Wrapper
# ============================
function Invoke-GhApiSafe {
    param(
        [string]$ApiArgs,
        [switch]$IsWrite,
        [string]$ContextLabel
    )

    if ($global:StopAll) { return $null }

    $maxAttempts = 3
    $attempt = 0
    $lastOutput = $null
    $lastExit = 0

    while ($attempt -lt $maxAttempts) {
        $attempt++
        if ($DebugApi) { Log "[DEBUG] gh api call (attempt $attempt) [$ContextLabel]: gh api $ApiArgs" }

        # If ApiArgs is a simple leading-path (GET), wrap in quotes so spaces are preserved.
        if ($ApiArgs -match '^\s*/') {
            $safeArg = "`"$ApiArgs`""
        } else {
            $safeArg = $ApiArgs
        }
        $command = "gh api $safeArg"
        $output = Invoke-Expression $command 2>&1
        $exitCode = $LASTEXITCODE
        $lastOutput = $output
        $lastExit = $exitCode

        if ($DebugApi) {
            Log "[DEBUG] ExitCode: $exitCode [$ContextLabel]"
            Log "[DEBUG] Raw API Response [$ContextLabel]:"
            Log "$output"
        }

        # RateLimit = C
        if (Test-RateLimit -Raw $output) {
            $retryAfter = Get-RetryAfterSeconds -Raw $output
            if ($retryAfter -and $attempt -eq 1) {
                Log "[ERROR] GitHub rate limit exceeded. Waiting $retryAfter seconds, then retrying once. [$ContextLabel]"
                Start-Sleep -Seconds $retryAfter
                continue
            } else {
                Log "[ERROR] GitHub rate limit exceeded again. Stopping script to avoid corruption. [$ContextLabel]"
                $global:StopAll = $true
                return $null
            }
        }

        if ($exitCode -eq 0) {
            return $output
        }

        if ($attempt -lt $maxAttempts) {
            $delay = [math]::Pow(2, $attempt - 1)
            Log "[WARN] gh api failed (attempt $attempt/$maxAttempts, exit $exitCode). Retrying in $delay seconds. [$ContextLabel]"
            Start-Sleep -Seconds $delay
        }
    }

    Log "[ERROR] gh api failed after $maxAttempts attempts. [$ContextLabel]"
    if ($DebugApi -and $lastOutput) {
        Log "[DEBUG] Last failed response [$ContextLabel]:"
        Log "$lastOutput"
    }
    if ($IsWrite) {
        $global:StopAll = $true
        Log "[ERROR] Write operation failed repeatedly. Stopping script. [$ContextLabel]"
    }
    return $lastOutput
}

# ============================
# Album Folder Management
# ============================
function Ensure-AlbumFolderExists {
    param([string]$AlbumFolder)

    if ($global:StopAll) { return }
    if ($script:AlbumChecked.ContainsKey($AlbumFolder)) { return }

    $path = "$githubCdRoot/$AlbumFolder"
    $args = "/repos/$repoOwner/$repoName/contents/$path"

    $existing = Invoke-GhApiSafe -ApiArgs $args -IsWrite:$false -ContextLabel "CHECK FOLDER $path"
    if ($global:StopAll) { return }

    if (-not $existing -or $existing -match '"Not Found"' -or $existing -match "404") {
        # Folder does not exist: create temporary .keep via JSON PUT
        $keepPath = "$githubCdRoot/$AlbumFolder/.keep"
        $putArgs = @(
            "-X","PUT",
            "-H","Content-Type: application/json",
                        "/repos/$repoOwner/$repoName/contents/$keepPath",
                            "-f","`"message=Init_$AlbumFolder`"",
                            "-f","`"content=$global:Base64Dot`""
        ) -join " "

        if ($DryRun) {
            Log "[DRY RUN] CREATE FOLDER via .keep GitHubPath='$keepPath'"
        } else {
            $result = Invoke-GhApiSafe -ApiArgs $putArgs -IsWrite:$true -ContextLabel "CREATE FOLDER $keepPath"
            if ($global:StopAll) { return }
            if (-not $result) {
                Log "[ERROR] Failed to create folder via .keep at '$keepPath'"
            } else {
                Log "CREATED FOLDER via .keep GitHubPath='$keepPath'"
            }
        }
    }

    $script:AlbumChecked[$AlbumFolder] = $true
}

function Remove-AlbumKeep {
    param([string]$AlbumFolder)

    if ($global:StopAll) { return }

    $keepPath = "$githubCdRoot/$AlbumFolder/.keep"
    $args = "/repos/$repoOwner/$repoName/contents/$keepPath"

    $existing = Invoke-GhApiSafe -ApiArgs $args -IsWrite:$false -ContextLabel "GET TEMP KEEP $keepPath"
    if ($global:StopAll) { return }

    if (-not $existing -or $existing -match '"Not Found"' -or $existing -match "404") {
        # No temp .keep present; nothing to do
        return
    }

    try {
        $json = $existing | ConvertFrom-Json
        $sha  = $json.sha
    } catch {
        Log "[ERROR] Failed to parse JSON for temp .keep at '$keepPath'. Skipping delete."
        return
    }

    if ($DryRun) {
        Log "[DRY RUN] DELETE TEMP .keep GitHubPath='$keepPath'"
        return
    }

    $delArgs = @(
        "-X","DELETE",
        "/repos/$repoOwner/$repoName/contents/$keepPath",
        "--raw-field","`"message=Remove_temp_keep_$AlbumFolder`"",
        "--raw-field","`"sha=$sha`""
    ) -join " "

    $result = Invoke-GhApiSafe -ApiArgs $delArgs -IsWrite:$true -ContextLabel "DELETE TEMP KEEP $keepPath"
    if ($global:StopAll) { return }

    if (-not $result) {
        Log "[ERROR] Failed to delete temp .keep at '$keepPath'"
    } else {
        Log "REMOVED TEMP .keep GitHubPath='$keepPath'"
    }
}

# ============================
# Collect Local Files
# ============================
Log "=== Starting Local Scan ==="

$localFiles = @{}
$albumFolders = Get-ChildItem -Path $root -Recurse -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName "scanned") }

foreach ($album in $albumFolders) {
    $albumPath   = $album.FullName
    $scannedPath = Join-Path $albumPath "scanned"

    $albumFolderName = Get-AlbumFolderName -AlbumFolderPath $albumPath
    if (-not $albumFolderName) {
        Log "WARNING: Could not determine album folder name for '$albumPath'. Skipping."
        continue
    }

    Log "Processing album: $albumFolderName (Source: $albumPath)"

    $images = Get-ChildItem -Path $scannedPath -File |
        Where-Object { $_.Extension -match 'jpg|jpeg|png|bmp|tif|tiff|webp' }

    foreach ($img in $images) {
        $gitHubPath = "$githubCdRoot/$albumFolderName/$($img.Name)"
        if (-not $localFiles.ContainsKey($gitHubPath)) {
            $localFiles[$gitHubPath] = [PSCustomObject]@{
                LocalPath   = $img.FullName
                AlbumFolder = $albumFolderName
                FileName    = $img.Name
            }
        }
    }
}

Log "Local scan complete. Local file count: $($localFiles.Count)"

# ============================
# Sync Single File
# ============================
function Sync-File {
    param(
        [string]$GitHubPath,
        [string]$LocalPath,
        [string]$AlbumFolder
    )

    if ($global:StopAll) { return "SKIPPED" }

    # Preserve root .keep only (no album-level .keep should ever be synced here)
    if ($GitHubPath -eq "CD/.keep") {
        Log "SKIPPED (preserved root .keep) GitHubPath='CD/.keep'"
        return "SKIPPED"
    }

    $localHash = (Get-FileHash -Path $LocalPath -Algorithm SHA1).Hash
    $apiUrl = "/repos/$repoOwner/$repoName/contents/$GitHubPath"

    if ($DebugApi) {
        Log "[DEBUG] Querying GitHubPath='$GitHubPath'"
        Log "[DEBUG] LocalPath='$LocalPath'"
        Log "[DEBUG] API URL: $apiUrl"
    }

    $existing = Invoke-GhApiSafe -ApiArgs $apiUrl -IsWrite:$false -ContextLabel "GET $GitHubPath"
    if ($global:StopAll) { return "SKIPPED" }

    $status = ""
    $remoteSha = $null

    if (-not $existing -or $existing -match '"Not Found"' -or $existing -match "404") {
        $status = "NEW"
    } else {
        try {
            $json = $existing | ConvertFrom-Json

            if (Is-SuspiciousResponse -JsonObject $json -Raw $existing) {
                Log "[ERROR] Suspicious response for $GitHubPath. Stopping script."
                $global:StopAll = $true
                return "SKIPPED"
            }

            $remoteSha = $json.sha

            # The REST contents API may omit the 'content' field or return encoding 'none' for large files.
            # If so, fetch the git blob by SHA which returns base64 content.
            $remoteContentBase64 = $null
            if ($json.content -and ($json.content.Trim() -ne '') -and ($json.encoding -eq 'base64')) {
                $remoteContentBase64 = $json.content -replace "`n","" -replace "`r",""
            } else {
                $blobArgs = "/repos/$repoOwner/$repoName/git/blobs/$remoteSha"
                $blobResult = Invoke-GhApiSafe -ApiArgs $blobArgs -IsWrite:$false -ContextLabel "GET BLOB $GitHubPath"
                if ($global:StopAll -or -not $blobResult -or $blobResult -match '"Not Found"' -or $blobResult -match "404") {
                    Log "[ERROR] Failed to retrieve blob for $GitHubPath. Stopping script."
                    $global:StopAll = $true
                    return "SKIPPED"
                }
                try {
                    $blobJson = $blobResult | ConvertFrom-Json
                } catch {
                    Log "[ERROR] Failed to parse blob JSON for $GitHubPath. Stopping script."
                    $global:StopAll = $true
                    return "SKIPPED"
                }

                if ($blobJson.content -and $blobJson.encoding -eq 'base64') {
                    $remoteContentBase64 = $blobJson.content -replace "`n","" -replace "`r",""
                } else {
                    Log "[ERROR] Blob did not contain base64 content for $GitHubPath. Stopping script."
                    $global:StopAll = $true
                    return "SKIPPED"
                }
            }

            $remoteBytes = [Convert]::FromBase64String($remoteContentBase64)
            $ms = New-Object System.IO.MemoryStream(,$remoteBytes)
            $remoteHash = (Get-FileHash -InputStream $ms -Algorithm SHA1).Hash
            $ms.Dispose()

            if ($remoteHash -eq $localHash) {
                $status = "SKIPPED"
            } else {
                $status = "REPLACED"
            }
        }
        catch {
            Log "[ERROR] JSON parse or hash computation failed for $GitHubPath. Stopping script."
            $global:StopAll = $true
            return "SKIPPED"
        }
    }

    $encodedPath = ($GitHubPath.Split("/") | ForEach-Object { Encode-UrlSegment $_ }) -join "/"
    $rawUrl = "https://raw.githubusercontent.com/$repoOwner/$repoName/$branch/$encodedPath"

    if ($DryRun) {
        Log "[DRY RUN] $status Album='$AlbumFolder' GitHubPath='$GitHubPath' RawURL='$rawUrl'"
        return $status
    }

    if ($status -eq "SKIPPED") {
        Log "SKIPPED Album='$AlbumFolder' GitHubPath='$GitHubPath' RawURL='$rawUrl'"
        return $status
    }

    # Build JSON payload with base64 content and write to a temporary file to avoid command-line length limits
    try {
        $bytes = [System.IO.File]::ReadAllBytes($LocalPath)
        $b64 = [Convert]::ToBase64String($bytes)
    } catch {
        Log "[ERROR] Failed to read local file bytes for '$LocalPath'"
        $global:StopAll = $true
        return "SKIPPED"
    }

    $payload = @{ message = "$status $GitHubPath"; content = $b64 }
    if ($status -eq 'REPLACED' -and $remoteSha) { $payload.sha = $remoteSha }

    $payloadJson = $payload | ConvertTo-Json -Depth 5
    $tmpFile = Join-Path $env:TEMP ("gh_payload_{0}.json" -f ([guid]::NewGuid().ToString()))
    Set-Content -Path $tmpFile -Value $payloadJson -Encoding UTF8

    $putArgs = @(
        "-X","PUT",
        "-H","Content-Type: application/json",
        "--input","`"$tmpFile`"",
        "`"/repos/$repoOwner/$repoName/contents/$GitHubPath`""
    ) -join " "

    $result = Invoke-GhApiSafe -ApiArgs $putArgs -IsWrite:$true -ContextLabel "PUT $GitHubPath"
    # clean up temporary payload file
    try { Remove-Item -LiteralPath $tmpFile -ErrorAction SilentlyContinue } catch { }
    if ($global:StopAll) {
        Log "ERROR uploading $GitHubPath (global stop triggered)."
        return $status
    }

    if (-not $result) {
        Log "ERROR uploading $GitHubPath (no response)."
    } else {
        Log "$status Album='$AlbumFolder' GitHubPath='$GitHubPath' RawURL='$rawUrl'"
    }

    return $status
}

# ============================
# Collect Remote Files
# ============================
Log "=== Starting Remote Scan (GitHub /CD) ==="

$remoteFiles = @{}

function Get-RemoteTree {
    param([string]$Path)

    if ($global:StopAll) { return }

    $args = "/repos/$repoOwner/$repoName/contents/$Path"
    $items = Invoke-GhApiSafe -ApiArgs $args -IsWrite:$false -ContextLabel "LIST $Path"
    if ($global:StopAll -or -not $items) { return }

    try {
        $jsonItems = $items | ConvertFrom-Json
    } catch {
        Log "[ERROR] Suspicious or invalid JSON while listing $Path. Stopping script."
        $global:StopAll = $true
        return
    }

    if ($jsonItems -isnot [System.Collections.IEnumerable]) { $jsonItems = @($jsonItems) }

    foreach ($item in $jsonItems) {

        # Preserve root .keep only
        if ($item.path -eq "CD/.keep") {
            continue
        }

        if ($item.type -eq "file") {
            $remoteFiles[$item.path] = $item.sha
        } elseif ($item.type -eq "dir") {
            Get-RemoteTree -Path $item.path
        } else {
            Log "[ERROR] Suspicious item type '$($item.type)' at path '$($item.path)'. Stopping script."
            $global:StopAll = $true
            return
        }
        if ($global:StopAll) { return }
    }
}

Get-RemoteTree -Path $githubCdRoot
if ($global:StopAll) {
    Log "Remote scan aborted due to error."
} else {
    Log "Remote scan complete. Remote file count: $($remoteFiles.Count)"
}

# ============================
# Sync Local → Remote (by album)
# ============================
Log "=== Syncing Local to GitHub ==="

$newCount = 0
$replacedCount = 0
$skippedCount = 0
$deletedCount = 0
$processedCount = 0
$maxDebugFiles = 5

# Group local files by AlbumFolder so we can manage album-level .keep cleanly
$albums = $localFiles.Values | Group-Object AlbumFolder

foreach ($albumGroup in $albums) {
    if ($global:StopAll) { break }
    $albumName = $albumGroup.Name
    $files     = $albumGroup.Group

    # Ensure album folder exists (via temporary .keep if needed)
    Ensure-AlbumFolderExists -AlbumFolder $albumName
    if ($global:StopAll) { break }

    foreach ($file in $files) {
        if ($global:StopAll) { break }
        if ($processedCount -ge $maxDebugFiles) {
            Log "=== DEBUG LIMIT REACHED: $maxDebugFiles FILES PROCESSED ==="
            break
        }

        $gitHubPath = "$githubCdRoot/$albumName/$($file.FileName)"
        $status = Sync-File -GitHubPath $gitHubPath -LocalPath $file.LocalPath -AlbumFolder $albumName

        switch ($status) {
            "NEW"      { $newCount++ }
            "REPLACED" { $replacedCount++ }
            "SKIPPED"  { $skippedCount++ }
        }

        $processedCount++
    }

    # After processing all files for this album, remove temporary album-level .keep if present
    Remove-AlbumKeep -AlbumFolder $albumName
    if ($global:StopAll) { break }

    if ($processedCount -ge $maxDebugFiles) {
        break
    }
}

# ============================
# Delete Remote Files Not Present Locally
# ============================
if (-not $global:StopAll) {
    Log "=== Deleting Remote Files Not Present Locally (Mirror /CD) ==="

    foreach ($kvp in $remoteFiles.GetEnumerator()) {
        if ($global:StopAll) { break }
        if ($processedCount -ge $maxDebugFiles) {
            Log "=== DEBUG LIMIT REACHED: $maxDebugFiles FILES PROCESSED ==="
            break
        }

        $remotePath = $kvp.Key
        $remoteSha  = $kvp.Value

        # Preserve root .keep
        if ($remotePath -eq "CD/.keep") {
            Log "SKIPPED (preserved root .keep) DELETE GitHubPath='CD/.keep'"
            continue
        }

        if (-not $localFiles.ContainsKey($remotePath)) {
            $encodedPath = ($remotePath.Split("/") | ForEach-Object { Encode-UrlSegment $_ }) -join "/"
            $rawUrl = "https://raw.githubusercontent.com/$repoOwner/$repoName/$branch/$encodedPath"

            if ($DryRun) {
                Log "[DRY RUN] DELETE GitHubPath='$remotePath' RawURL='$rawUrl'"
                $deletedCount++
                $processedCount++
                continue
            }

            $delArgs = @(
                "-X","DELETE",
                "/repos/$repoOwner/$repoName/contents/$remotePath",
                "--raw-field","message=DELETE $remotePath (mirror sync)",
                "--raw-field","sha=$remoteSha"
            ) -join " "

            $result = Invoke-GhApiSafe -ApiArgs $delArgs -IsWrite:$true -ContextLabel "DELETE $remotePath"
            if ($global:StopAll) {
                Log "ERROR deleting $remotePath (global stop triggered)."
                break
            }

            if (-not $result) {
                Log "ERROR deleting GitHubPath='$remotePath'"
            } else {
                Log "DELETED GitHubPath='$remotePath' RawURL='$rawUrl'"
                $deletedCount++
            }

            $processedCount++
        }
    }
}

# ============================
# Summary
# ============================
Log "=== Scan Complete ==="
Log "Summary: NEW=$newCount REPLACED=$replacedCount SKIPPED=$skippedCount DELETED=$deletedCount STOPPED=$global:StopAll"
Write-Host ""
Write-Host "Summary: NEW=$newCount REPLACED=$replacedCount SKIPPED=$skippedCount DELETED=$deletedCount STOPPED=$global:StopAll"