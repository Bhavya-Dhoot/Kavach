# Aegis Shield — Documentation Verification Script
# Verifies: PRD structure (16 sections), mermaid/tables, required docs exist,
# and every relative markdown link in *.md files resolves to a real file
# (with heading-anchor checks for links into local markdown files).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/verify-docs.ps1
# Exit code 0 = all checks pass; 1 = failure.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]

function Fail([string]$msg) { [void]$failures.Add($msg) }

# PS 5.1 Get-Content defaults to ANSI for UTF-8-no-BOM files (em-dashes become mojibake).
# Always read as UTF-8 so GitHub anchors and Unicode content match on-disk bytes.
function Read-Utf8([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

# ---------- C1: PRD end-to-end structure ----------
$prdPath = Join-Path $repoRoot 'PRD.md'
if (-not (Test-Path -LiteralPath $prdPath)) {
    Fail 'PRD.md missing'
} else {
    $prd = Read-Utf8 $prdPath
    $expected = @(
        '## 1. Executive Summary', '## 2. Problem Statement', '## 3. Goals and Non-Goals',
        '## 4. Target Users and Use Cases', '## 5. Hardware Utilization', '## 6. System Architecture',
        '## 7. Feature 1', '## 8. Feature 2', '## 9. On-Device ML Pipeline',
        '## 10. User Experience and Flows', '## 11. Performance Requirements', '## 12. Privacy and Security',
        '## 13. Success Metrics and KPIs', '## 14. Risks and Mitigations', '## 15. Roadmap and Milestones',
        '## 16. Competitive Landscape'
    )
    $last = -1
    foreach ($h in $expected) {
        $i = $prd.IndexOf($h)
        if ($i -lt 0) { Fail "PRD missing section header: $h" }
        elseif ($i -le $last) { Fail "PRD sections out of order: $h" }
        else { $last = $i }
    }
    $sections = [regex]::Matches($prd, '(?ms)^## \d+\..*?(?=^## \d+\.|\z)')
    if ($sections.Count -ne 16) { Fail "PRD expected 16 sections, parsed $($sections.Count)" }
    foreach ($m in $sections) {
        $hdr = ($m.Value -split "`n")[0]
        if ($m.Value.Trim().Length -lt 200) { Fail "PRD section too short/empty: $hdr" }
    }
    if ($prd -notmatch '```mermaid') { Fail 'PRD missing mermaid architecture diagram' }
    if ($prd -notmatch 'flowchart TD') { Fail 'PRD missing flowchart TD' }
    $tables = ([regex]::Matches($prd, '(?m)^\|[\s\-|]+\|$')).Count
    if ($tables -lt 8) { Fail "PRD expected >=8 markdown tables, found $tables" }
    foreach ($n in @('SynthID watermark decoder', 'under 300ms, p95', 'under 15mW sustained',
                     'Watermark stripping becomes trivial', 'Phase 0')) {
        if (-not $prd.Contains($n)) { Fail "PRD missing expected content: $n" }
    }
}

# ---------- C2/C3: required documentation files ----------
$requiredDocs = @(
    'README.md',
    'docs/architecture.md',
    'docs/roadmap.md',
    'docs/metrics-and-risks.md',
    'scripts/verify-docs.ps1'
)
foreach ($rel in $requiredDocs) {
    $p = Join-Path $repoRoot ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $p)) { Fail "Required file missing: $rel" }
    elseif ((Get-Item -LiteralPath $p).Length -lt 500) { Fail "Required file too small: $rel" }
}

# README content requirements
$readmePath = Join-Path $repoRoot 'README.md'
if (Test-Path -LiteralPath $readmePath) {
    $readme = Read-Utf8 $readmePath
    foreach ($n in @('Aegis Shield', 'PRD.md', 'docs/architecture.md', 'docs/roadmap.md',
                     'docs/metrics-and-risks.md', 'verify-docs.ps1')) {
        if (-not $readme.Contains($n)) { Fail "README missing expected content: $n" }
    }
}

# Docs coherence: each docs file must link back to PRD
foreach ($rel in @('docs/architecture.md', 'docs/roadmap.md', 'docs/metrics-and-risks.md')) {
    $p = Join-Path $repoRoot ($rel -replace '/', '\')
    if (Test-Path -LiteralPath $p) {
        $txt = Read-Utf8 $p
        if ($txt -notmatch 'PRD\.md') { Fail "$rel does not reference PRD.md" }
    }
}

# ---------- C4: link integrity across all markdown ----------
function Get-GitHubAnchor([string]$heading) {
    # GitHub slug: lowercase; strip punctuation (keep letters/digits/space/hyphen/underscore);
    # each whitespace becomes one hyphen (consecutive spaces => consecutive hyphens, e.g. em-dash removal)
    $h = $heading.Trim()
    $h = $h -replace '\A#+\s*', ''
    $h = $h.ToLowerInvariant()
    $h = $h -replace '[^\p{L}\p{N}\s\-_]', ''
    $h = $h -replace '\s', '-'
    return $h
}

function Get-HeadingAnchors([string]$filePath) {
    $anchors = @{}
    $lines = (Read-Utf8 $filePath) -split "`r?`n"
    foreach ($line in $lines) {
        if ($line -match '^#{1,6}\s+(.+)$') {
            $a = Get-GitHubAnchor $Matches[1]
            $anchors[$a] = $true
        }
    }
    return $anchors
}

$mdFiles = Get-ChildItem -LiteralPath $repoRoot -Recurse -Filter '*.md' -File |
    Where-Object { $_.FullName -notmatch '\\\.git\\' }
$linkCount = 0
foreach ($md in $mdFiles) {
    $dir = $md.DirectoryName
    $text = Read-Utf8 $md.FullName
    # [text](target) — skip external URLs and pure anchors handled below
    $matches2 = [regex]::Matches($text, '\[[^\]]*\]\(([^)]+)\)')
    foreach ($m in $matches2) {
        $target = $m.Groups[1].Value.Trim()
        if ($target -match '^(https?|mailto):') { continue }
        $linkCount++
        $anchor = $null
        $pathPart = $target
        if ($target -match '^(.*)#(.*)$') {
            $pathPart = $Matches[1]
            $anchor = $Matches[2]
        }
        $relMd = $md.Name
        if ($pathPart -eq '') {
            # same-file anchor
            if ($anchor) {
                $anchors = Get-HeadingAnchors $md.FullName
                if (-not $anchors.ContainsKey($anchor)) {
                    Fail "${relMd}: broken same-file anchor (#$anchor)"
                }
            }
            continue
        }
        $resolved = Join-Path $dir ($pathPart -replace '/', '\')
        if (-not (Test-Path -LiteralPath $resolved)) {
            Fail "${relMd}: broken link target -> $target"
            continue
        }
        if ($anchor -and (Test-Path -LiteralPath $resolved) -and -not (Get-Item -LiteralPath $resolved).PSIsContainer) {
            $anchors = Get-HeadingAnchors $resolved
            if (-not $anchors.ContainsKey($anchor)) {
                Fail "${relMd}: broken anchor in $pathPart#$anchor"
            }
        }
    }
}

# ---------- Report ----------
Write-Output "Repo root: $repoRoot"
Write-Output "Markdown files scanned: $($mdFiles.Count); relative links checked: $linkCount"
if ($failures.Count -eq 0) {
    Write-Output 'RESULT: ALL DOCUMENTATION CHECKS PASS'
    exit 0
} else {
    Write-Output "RESULT: $($failures.Count) FAILURE(S)"
    $failures | ForEach-Object { Write-Output "  - $_" }
    exit 1
}
