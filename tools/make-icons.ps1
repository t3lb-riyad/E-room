Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
$sourcePath = Join-Path $out "icon-512.png"

if (-not (Test-Path $sourcePath)) {
    throw "Missing source icon: $sourcePath"
}

$source = New-Object System.Drawing.Bitmap $sourcePath

function New-Icon {
    param(
        [int]$Size,
        [string]$Path,
        [double]$ContentScale = 1.0
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::White)

    $target = $Size * $ContentScale
    $offset = ($Size - $target) / 2.0
    $dest = [System.Drawing.RectangleF]::new(
        [single]$offset,
        [single]$offset,
        [single]$target,
        [single]$target
    )
    $g.DrawImage($source, $dest)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

New-Icon -Size 192 -Path (Join-Path $out "icon-192.png")
New-Icon -Size 512 -Path (Join-Path $out "icon-maskable-512.png") -ContentScale 0.8
New-Icon -Size 180 -Path (Join-Path $out "apple-touch-icon.png")
New-Icon -Size 32 -Path (Join-Path $out "favicon-32.png")

$source.Dispose()
Write-Host "Icons written to $out"
