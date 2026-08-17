[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Runtime
)

$ErrorActionPreference = "Stop"
$runtimeRoot = (Resolve-Path -LiteralPath $Runtime).Path
$sitePackages = Join-Path $runtimeRoot "Lib\site-packages"

# These tools are needed only while CI installs the runtime. setuptools stays because
# SAM3 uses pkg_resources to locate its bundled BPE vocabulary.
$removablePaths = @(
    (Join-Path $runtimeRoot "Scripts"),
    (Join-Path $runtimeRoot "Lib\ensurepip"),
    (Join-Path $sitePackages "pip"),
    (Join-Path $sitePackages "pip-*.dist-info"),
    (Join-Path $sitePackages "wheel"),
    (Join-Path $sitePackages "wheel-*.dist-info")
)

foreach ($pattern in $removablePaths) {
    Get-ChildItem -Path $pattern -Force -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction Stop
}

Get-ChildItem -Path $runtimeRoot -Directory -Recurse -Force -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction Stop
Get-ChildItem -Path $runtimeRoot -File -Recurse -Force -Include "*.pyc", "*.pyo" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction Stop

$required = @(
    (Join-Path $runtimeRoot "python.exe"),
    (Join-Path $sitePackages "torch\__init__.py"),
    (Join-Path $sitePackages "torchvision\__init__.py"),
    (Join-Path $sitePackages "transformers\__init__.py"),
    (Join-Path $sitePackages "sam3\model_builder.py"),
    (Join-Path $sitePackages "sam3\assets\bpe_simple_vocab_16e6.txt.gz"),
    (Join-Path $sitePackages "setuptools\__init__.py")
)
$missing = $required | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
if ($missing.Count -gt 0) {
    $missing | ForEach-Object { Write-Error "Required CPU runtime file is missing after pruning: $_" }
    throw "CPU runtime pruning removed or lost a required file."
}

Write-Host "CPU runtime pruning completed: $runtimeRoot"
