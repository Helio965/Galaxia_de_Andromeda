<#
  Mini servidor local para abrir o Galaxy Explorer no navegador, sem instalar nada.

  Os módulos JavaScript (ES Modules) não carregam quando o index.html é aberto
  direto do disco (file://). Este script serve a pasta do projeto em
  http://localhost:8000 (ou na próxima porta livre) e abre o projeto.

  Placa de vídeo: uma página WebGL só pode PEDIR a GPU rápida; quem escolhe é o
  Windows. Em notebooks com duas placas (ex.: Intel + NVIDIA RTX) o Windows
  costuma rodar o navegador na mais fraca. Por isso:
    1. o projeto abre numa janela própria do Chrome (ou Edge), com perfil
       separado em %LOCALAPPDATA%\AndromedaGalaxy e a opção
       --force-high-performance-gpu;
    2. o script explica e oferece gravar a preferência "Alto desempenho" do
       Windows para esse navegador (HKCU\Software\Microsoft\DirectX\UserGpuPreferences,
       GpuPreference=2). É o mesmo que Configurações > Sistema > Tela >
       Elementos gráficos, e pode ser desfeito por lá.

  Uso: dê dois cliques em iniciar.bat
   ou: powershell -ExecutionPolicy Bypass -File tools\servidor.ps1 [opções]

  -Port 8000          primeira porta tentada (usa a próxima livre)
  -Quality ultra      abre com ?quality=ultra|high|medium|low
  -DefaultBrowser     abre no navegador padrão, numa aba comum
  -NoBrowser          só inicia o servidor
  -NoGpuPreference    nunca pergunta sobre a preferência de GPU do Windows

  Compatível com Windows PowerShell 5.1 e PowerShell 7+.
#>
param(
  [int]$Port = 8000,
  [ValidateSet('', 'ultra', 'high', 'medium', 'low')]
  [string]$Quality = '',
  [switch]$NoBrowser,
  [switch]$DefaultBrowser,
  [switch]$NoGpuPreference
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$appName = 'AndromedaGalaxy'
$gpuPreferencesKey = 'Software\Microsoft\DirectX\UserGpuPreferences'

$mimeTypes = @{
  '.html'  = 'text/html; charset=utf-8'
  '.js'    = 'text/javascript; charset=utf-8'
  '.mjs'   = 'text/javascript; charset=utf-8'
  '.css'   = 'text/css; charset=utf-8'
  '.json'  = 'application/json; charset=utf-8'
  '.md'    = 'text/markdown; charset=utf-8'
  '.txt'   = 'text/plain; charset=utf-8'
  '.jpg'   = 'image/jpeg'
  '.jpeg'  = 'image/jpeg'
  '.png'   = 'image/png'
  '.webp'  = 'image/webp'
  '.svg'   = 'image/svg+xml'
  '.ico'   = 'image/x-icon'
  '.woff2' = 'font/woff2'
}

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

function Get-LocalPath([string]$urlPath) {
  $relative = [Uri]::UnescapeDataString($urlPath).TrimStart('/')
  if ($relative -eq '' -or $relative.EndsWith('/')) { $relative += 'index.html' }
  try { $path = [IO.Path]::GetFullPath((Join-Path $root $relative)) } catch { return $null }
  # Only files inside the project folder are ever served.
  if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  return $path
}

function Send-Response($context) {
  $request = $context.Request
  $response = $context.Response
  try {
    $path = Get-LocalPath $request.Url.AbsolutePath
    if ($path) {
      $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
      $response.ContentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($path)
    } else {
      $response.StatusCode = 404
      $response.ContentType = 'text/plain; charset=utf-8'
      $bytes = [Text.Encoding]::UTF8.GetBytes('404 - arquivo não encontrado')
    }

    $response.Headers['Cache-Control'] = 'no-cache'
    $response.Headers['X-Content-Type-Options'] = 'nosniff'
    $response.ContentLength64 = $bytes.Length
    if ($request.HttpMethod -ne 'HEAD') { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
    Write-Host ('  {0}  {1}' -f $response.StatusCode, $request.Url.AbsolutePath)
  } catch {
    # The browser closed the connection mid-response: nothing to do.
  } finally {
    $response.Close()
  }
}

# ---------------------------------------------------------------------------
# Browser + graphics card
# ---------------------------------------------------------------------------

function Test-Windows {
  return [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
}

# Chrome first, then Edge: both are Chromium and accept the switches used below.
function Find-ChromiumBrowser {
  $bases = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ }
  $relatives = @('Google\Chrome\Application\chrome.exe', 'Microsoft\Edge\Application\msedge.exe')
  foreach ($relative in $relatives) {
    foreach ($base in $bases) {
      $path = [IO.Path]::Combine($base, $relative)
      if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
  }
  return $null
}

# Windows keeps one "GpuPreference=N;" entry per program (0 = automatic,
# 1 = power saving, 2 = high performance), next to other settings that must be kept.
function Get-UpdatedGpuPreference([string]$current) {
  if ($current -match 'GpuPreference=\d;') { return $current -replace 'GpuPreference=\d;', 'GpuPreference=2;' }
  return $current + 'GpuPreference=2;'
}

function Get-GpuPreference([string]$exe) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($gpuPreferencesKey)
  if (-not $key) { return '' }
  try { return [string]$key.GetValue($exe, '') } finally { $key.Close() }
}

function Set-HighPerformanceGpu([string]$exe) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($gpuPreferencesKey)
  try {
    $value = Get-UpdatedGpuPreference ([string]$key.GetValue($exe, ''))
    $key.SetValue($exe, $value, [Microsoft.Win32.RegistryValueKind]::String)
  } finally {
    $key.Close()
  }
}

# Explains exactly what would change, asks once, and remembers a "no".
function Request-HighPerformanceGpu([string]$exe, [string]$stateDir) {
  if ((Get-GpuPreference $exe) -match 'GpuPreference=2;') {
    Write-Host '  Windows: este navegador já está configurado para a placa de alto desempenho.'
    Write-Host ''
    return
  }
  $declined = [IO.Path]::Combine($stateDir, 'gpu-preference-declined.txt')
  if ((Test-Path -LiteralPath $declined) -and ((Get-Content -LiteralPath $declined -Raw).Trim() -eq $exe)) { return }

  Write-Host '  ------------------------------------------------------------------------'
  Write-Host '  PLACA DE VÍDEO DE ALTO DESEMPENHO'
  Write-Host '  ------------------------------------------------------------------------'
  Write-Host '  Em notebooks com duas placas de vídeo (ex.: Intel + NVIDIA), o Windows'
  Write-Host '  costuma rodar o navegador na placa mais fraca e as galáxias ficam lentas.'
  Write-Host ''
  Write-Host '  Posso pedir ao Windows que use a placa de alto desempenho SOMENTE neste'
  Write-Host '  navegador. O que será gravado (apenas no seu usuário):'
  Write-Host "    Programa : $exe"
  Write-Host "    Registro : HKEY_CURRENT_USER\$gpuPreferencesKey"
  Write-Host '    Valor    : GpuPreference=2;   (2 = Alto desempenho)'
  Write-Host ''
  Write-Host '  É o mesmo que Configurações > Sistema > Tela > Elementos gráficos >'
  Write-Host '  (navegador) > Alto desempenho. Nenhuma outra configuração do Windows é'
  Write-Host '  alterada, e dá para desfazer por aquela mesma tela.'
  Write-Host ''
  $answer = Read-Host '  Configurar agora? [S/n]'
  if ($answer -match '^\s*(s|sim|y|yes)?\s*$') {
    Set-HighPerformanceGpu $exe
    Write-Host '  Pronto: o Windows vai usar a placa de alto desempenho nesse navegador.'
  } else {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Set-Content -LiteralPath $declined -Value $exe
    Write-Host '  Tudo bem, nada foi alterado. Esta pergunta não aparece de novo.'
  }
  Write-Host ''
}

function Get-BrowserArguments([string]$url, [string]$profileDir) {
  # A separate profile starts a separate browser instance, so these switches
  # apply even when the browser is already open (and your tabs are untouched).
  return @(
    "--user-data-dir=`"$profileDir`"",
    '--force-high-performance-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    "--app=$url"
  )
}

function Open-Project([string]$url) {
  $browser = $null
  if (-not $DefaultBrowser -and (Test-Windows)) { $browser = Find-ChromiumBrowser }

  if (-not $browser) {
    try { Start-Process $url } catch { Write-Host "  Abra $url no navegador." }
    return
  }

  $stateDir = [IO.Path]::Combine($env:LOCALAPPDATA, $appName)
  if (-not $NoGpuPreference) {
    try {
      Request-HighPerformanceGpu $browser $stateDir
    } catch {
      Write-Host "  Não foi possível ajustar a preferência de GPU do Windows: $($_.Exception.Message)"
    }
  }

  $arguments = Get-BrowserArguments $url ([IO.Path]::Combine($stateDir, 'browser-profile'))
  Start-Process -FilePath $browser -ArgumentList $arguments
  Write-Host "  Janela aberta no $([IO.Path]::GetFileName($browser)), pedindo a placa de vídeo de alto desempenho."
  Write-Host '  Confira no painel do projeto: com a placa dedicada, o ponto ao lado da GPU fica verde.'
  Write-Host ''
}

# ---------------------------------------------------------------------------
# Main (skipped when the script is dot-sourced, e.g. by tests)
# ---------------------------------------------------------------------------

if ($MyInvocation.InvocationName -eq '.') { return }

# Use the first free port starting at $Port.
$listener = $null
for ($candidate = $Port; $candidate -lt $Port + 20; $candidate++) {
  $attempt = New-Object System.Net.HttpListener
  $attempt.Prefixes.Add("http://localhost:$candidate/")
  try {
    $attempt.Start()
    $listener = $attempt
    $Port = $candidate
    break
  } catch {
    $attempt.Close()
  }
}

if (-not $listener) {
  Write-Host "Nenhuma porta livre entre $Port e $($Port + 19). Feche outros servidores e tente de novo."
  exit 1
}

$url = "http://localhost:$Port/"
if ($Quality) { $url += "?quality=$Quality" }

Write-Host ''
Write-Host '  GALAXY EXPLORER - servidor local'
Write-Host "  Endereço: $url"
Write-Host '  Deixe esta janela aberta enquanto usa o projeto. Para parar: feche-a ou pressione Ctrl+C.'
Write-Host ''

if (-not $NoBrowser) { Open-Project $url }

try {
  while ($listener.IsListening) {
    $pending = $listener.GetContextAsync()
    # Short waits keep Ctrl+C responsive.
    while (-not $pending.Wait(500)) { }
    Send-Response $pending.Result
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
