#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Scans the CD-Catalog GitHub repository and generates a comprehensive inventory
    of all remote files with metadata needed for selective deletion operations.

.DESCRIPTION
    This script recursively traverses the GitHub repository structure and outputs
    a CSV file containing all files with their paths, SHAs, sizes, and other metadata.
    This inventory can be used to identify and delete files that are no longer needed.

.PARAMETER OutputFile
    Path to the output CSV file. Defaults to 'remote_inventory.csv' in current directory.

.PARAMETER DebugApi
    If specified, logs all GitHub API calls and responses for troubleshooting.

.EXAMPLE
    .\inventory_remote_files.ps1
    .\inventory_remote_files.ps1 -OutputFile C:\temp\inventory.csv -DebugApi
#>
param(
    [string]$OutputFile = "remote_inventory.csv",
    [switch]$DebugApi
)

Write-Host "SCRIPT RUNNING UNDER: $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)"
Write-Host ""

# ============================
# GitHub Configuration
# ============================
$repoOwner = "davegulliksen"
$repoName  = "CD-Catalog"
$branch    = "main"
$cdRoot    = "CD"

# ============================
# GitHub Auth Check
# ============================
$authStatus = gh auth status 2>&1
if ($authStatus -match "not logged in" -or $authStatus -match "You are not logged into any GitHub hosts") {
    Write-Error "GitHub CLI is not authenticated. Run: gh auth login"
    exit 1
}
Write-Host "GitHub CLI authentication detected."

# ============================
# Rate Limit & Helpers
# ============================
function Test-RateLimit {
    param([string]$Raw)
    if ($Raw -match "API rate limit exceeded" -or
        $Raw -match "secondary rate limit" -or
        $Raw -match '"status":"403"' -or
        $Raw -match '"status":"429"') {
        return $true
    }
    return $false
}

function Invoke-GhApiSafe {
    param(
        [string]$ApiArgs,
        [string]$ContextLabel
    )

    $maxAttempts = 3
    $attempt = 0
    $lastOutput = $null
    $lastExit = 0

    while ($attempt -lt $maxAttempts) {
        $attempt++
        if ($DebugApi) { Write-Host "[DEBUG] gh api call (attempt $attempt) [$ContextLabel]: gh api $ApiArgs" }

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
            Write-Host "[DEBUG] ExitCode: $exitCode [$ContextLabel]"
        }

        # Rate limit detection
        if (Test-RateLimit -Raw $output) {
            Write-Host "[ERROR] GitHub rate limit exceeded. Stopping script. [$ContextLabel]" -ForegroundColor Red
            return $null
        }

        if ($exitCode -eq 0) {
            return $output
        }

        if ($attempt -lt $maxAttempts) {
            $delay = [math]::Pow(2, $attempt - 1)
            Write-Host "[WARN] gh api failed (attempt $attempt/$maxAttempts, exit $exitCode). Retrying in $delay seconds. [$ContextLabel]" -ForegroundColor Yellow
            Start-Sleep -Seconds $delay
        }
    }

    Write-Host "[ERROR] gh api failed after $maxAttempts attempts. [$ContextLabel]" -ForegroundColor Red
    return $lastOutput
}

# ============================
# Recursive File Enumeration
# ============================
$fileList = New-Object System.Collections.Generic.List[PSObject]

function Get-RemoteTree {
    param([string]$Path)

    $args = "/repos/$repoOwner/$repoName/contents/$Path"
    $items = Invoke-GhApiSafe -ApiArgs $args -ContextLabel "LIST $Path"
    
    if (-not $items) { return }

    try {
        $jsonItems = $items | ConvertFrom-Json
    } catch {
        Write-Host "[ERROR] Failed to parse JSON for path '$Path'. Skipping." -ForegroundColor Red
        return
    }

    if ($jsonItems -isnot [System.Collections.IEnumerable]) { $jsonItems = @($jsonItems) }

    foreach ($item in $jsonItems) {
        Write-Host "  $($item.type): $($item.path)"

        if ($item.type -eq "file") {
            # Add file metadata to inventory
            $fileList.Add([PSCustomObject]@{
                Path         = $item.path
                Name         = $item.name
                SHA          = $item.sha
                Size         = $item.size
                Type         = "file"
                URL          = $item.url
                DownloadURL  = $item.download_url
                HtmlURL      = $item.html_url
            })
        } elseif ($item.type -eq "dir") {
            # Recursively scan subdirectories
            Get-RemoteTree -Path $item.path
        } else {
            Write-Host "[WARN] Unknown item type '$($item.type)' at '$($item.path)'" -ForegroundColor Yellow
        }
    }
}

# ============================
# Main Execution
# ============================
Write-Host "=== Starting Remote File Inventory ===" -ForegroundColor Cyan
Write-Host "Scanning repository: $repoOwner/$repoName (branch: $branch)"
Write-Host "Root path: $cdRoot"
Write-Host ""

Get-RemoteTree -Path $cdRoot

# ============================
# Output Results
# ============================
Write-Host ""
Write-Host "=== Inventory Complete ===" -ForegroundColor Cyan
Write-Host "Total files found: $($fileList.Count)"
Write-Host ""

if ($fileList.Count -eq 0) {
    Write-Host "No files found in repository." -ForegroundColor Yellow
    exit 0
}

# Export to CSV
$fileList | Export-Csv -Path $OutputFile -NoTypeInformation -Encoding UTF8
Write-Host "Inventory exported to: $OutputFile" -ForegroundColor Green
Write-Host ""

# Display summary by folder
Write-Host "=== Summary by Folder ===" -ForegroundColor Cyan
$byFolder = $fileList | Group-Object { 
    $parts = $_.Path -split '/'
    if ($parts.Count -gt 2) {
        $parts[0..($parts.Count - 2)] -join '/'
    } else {
        $parts[0]
    }
} | Sort-Object Name

foreach ($folder in $byFolder) {
    Write-Host "$($folder.Name): $($folder.Count) file(s)"
}

Write-Host ""
Write-Host "=== File Listing ===" -ForegroundColor Cyan
$fileList | Select-Object Path, Size, SHA | Format-Table -AutoSize

Write-Host ""
Write-Host "To delete a file, use:"
Write-Host "  gh api -X DELETE ""/repos/$repoOwner/$repoName/contents/PATH"" --raw-field ""message=DELETE message"" --raw-field ""sha=SHA_VALUE"""
Write-Host ""
