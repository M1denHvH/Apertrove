[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
  [ValidateSet('public','private')][string]$Visibility='public',
  [switch]$Publish
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $projectRoot
try {
  & node scripts/preflight.cjs --list
  if ($LASTEXITCODE -ne 0) { throw 'Source preflight failed.' }
  & node scripts/source-zip.cjs --stage
  if ($LASTEXITCODE -ne 0) { throw 'Staging failed. Review/rename the preserved export before retrying.' }
  Write-Host "Plan: create NEW $Visibility repository $Repository from the clean allowlist export."
  if (-not $Publish) {
    Write-Host 'Review artifacts/github-upload. No repository or network mutation was performed. Run gh auth login, then repeat with -Publish.'
    return
  }
  foreach ($command in @('git','gh','node')) { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required. Install it and retry." } }
  & gh auth status
  if ($LASTEXITCODE -ne 0) { throw 'Authenticate separately with gh auth login.' }
  & git var GIT_AUTHOR_IDENT *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Configure your Git user.name and user.email before publishing.' }
  $stagingPath=Join-Path $projectRoot 'artifacts/github-upload'
  & git -C $stagingPath init -b main
  if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
  & git -C $stagingPath add --all
  if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
  & git -C $stagingPath commit -m 'Initial Apertrove open source release'
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
  & gh repo create $Repository "--$Visibility" --source $stagingPath --remote origin --description 'Canon EOS tethering, photo library and LAN camera remote for Windows' --push
  if ($LASTEXITCODE -ne 0) { throw 'GitHub creation/push failed. The staged repository is preserved for inspection and retry; no force-push is used.' }
} finally { Pop-Location }
