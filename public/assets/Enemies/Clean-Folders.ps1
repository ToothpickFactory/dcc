<#
.SYNOPSIS
    Deletes specific named folders inside each subfolder of a parent folder,
    then removes any "Frames" folders from what remains.

.DESCRIPTION
    For the given -Root folder, the script:
      1. Looks inside every subfolder of -Root (recursively) and deletes any
         folder whose name matches one of the target names below.
      2. Then deletes any remaining folder named "Frames".

    By default the script runs in PREVIEW mode and only lists what it WOULD
    delete. Add -Execute to actually delete.

.EXAMPLE
    .\Clean-Folders.ps1 -Root "C:\Path\To\Parent"
        Preview only. Shows everything that would be deleted.

.EXAMPLE
    .\Clean-Folders.ps1 -Root "C:\Path\To\Parent" -Execute
        Actually deletes the matching folders.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Root,

    [switch]$Execute
)

# Folder names to delete (case-insensitive match)
$TargetNames = @(
    'Fall',
    'Hit React',
    'idle_right',
    'jump_right',
    'run_right',
    'Sleep',
    'walk_right',
    'attack_right'
)

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Write-Error "Root folder not found: $Root"
    exit 1
}

if (-not $Execute) {
    Write-Host "=== PREVIEW MODE (nothing will be deleted). Re-run with -Execute to delete. ===" -ForegroundColor Yellow
}

function Remove-MatchingFolders {
    param(
        [string[]]$Names,
        [string]$Label
    )

    Write-Host ""
    Write-Host ">> Removing $Label..." -ForegroundColor Cyan

    # Get all matching directories, deepest first so nested deletes don't conflict
    $matches = Get-ChildItem -LiteralPath $Root -Directory -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $Names -contains $_.Name } |
        Sort-Object { $_.FullName.Length } -Descending

    if (-not $matches) {
        Write-Host "   (none found)"
        return 0
    }

    foreach ($dir in $matches) {
        if ($Execute) {
            try {
                Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction Stop
                Write-Host "   Deleted: $($dir.FullName)" -ForegroundColor Green
            }
            catch {
                Write-Warning "   Failed:  $($dir.FullName) -- $($_.Exception.Message)"
            }
        }
        else {
            Write-Host "   Would delete: $($dir.FullName)"
        }
    }

    return $matches.Count
}

# Step 1: delete the named target folders
$n1 = Remove-MatchingFolders -Names $TargetNames -Label "target folders ($($TargetNames -join ', '))"

# Step 2: delete remaining "Frames" folders
$n2 = Remove-MatchingFolders -Names @('Frames') -Label "'Frames' folders"

Write-Host ""
if ($Execute) {
    Write-Host "Done. Removed $n1 target folder(s) and $n2 'Frames' folder(s)." -ForegroundColor Green
}
else {
    Write-Host "Preview complete. Would remove $n1 target folder(s) and $n2 'Frames' folder(s)." -ForegroundColor Yellow
    Write-Host "Run again with -Execute to perform the deletions." -ForegroundColor Yellow
}
