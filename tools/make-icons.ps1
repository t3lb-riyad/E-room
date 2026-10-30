# Generates the RoomSet PNG icons (Windows PowerShell / .NET Framework).
# Usage: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-RoomSetIcon {
    param(
        [int]$Size,
        [string]$Path,
        [double]$ContentScale = 1.0,
        [switch]$Transparent
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $cx = $Size / 2.0
    $cy = $Size / 2.0

    if (-not $Transparent) {
        $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
        $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            $rect,
            [System.Drawing.ColorTranslator]::FromHtml("#3E3323"),
            [System.Drawing.ColorTranslator]::FromHtml("#2A2215"),
            135
        )
        $g.FillRectangle($bg, $rect)
        $bg.Dispose()
    }

    $unit = $Size / 512.0 * $ContentScale

    # Outer plate
    $plateR = 168 * $unit
    $plateBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.RectangleF(($cx - $plateR), ($cy - $plateR), ($plateR * 2), ($plateR * 2))),
        [System.Drawing.ColorTranslator]::FromHtml("#3F4F12"),
        [System.Drawing.ColorTranslator]::FromHtml("#2C380B"),
        135
    )
    $g.FillEllipse($plateBrush, ($cx - $plateR), ($cy - $plateR), ($plateR * 2), ($plateR * 2))
    $plateBrush.Dispose()

    $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(38, 255, 255, 255), [float](6 * $unit))
    $g.DrawEllipse($ringPen, ($cx - $plateR), ($cy - $plateR), ($plateR * 2), ($plateR * 2))
    $ringPen.Dispose()

    # Green LED glow
    $glowSteps = 7
    for ($i = $glowSteps; $i -ge 1; $i--) {
        $r = (52 + ($i * 11)) * $unit
        $alpha = [int](6 + (($glowSteps - $i) * 3))
        $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 61, 220, 132))
        $g.FillEllipse($glowBrush, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
        $glowBrush.Dispose()
    }

    # LED core
    $coreR = 52 * $unit
    $coreBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.RectangleF(($cx - $coreR), ($cy - $coreR), ($coreR * 2), ($coreR * 2))),
        [System.Drawing.ColorTranslator]::FromHtml("#8CF7BC"),
        [System.Drawing.ColorTranslator]::FromHtml("#2FD874"),
        135
    )
    $g.FillEllipse($coreBrush, ($cx - $coreR), ($cy - $coreR), ($coreR * 2), ($coreR * 2))
    $coreBrush.Dispose()

    # Specular highlight
    $hlR = 16 * $unit
    $hlBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(110, 255, 255, 255))
    $g.FillEllipse($hlBrush, ($cx - $coreR * 0.52 - $hlR), ($cy - $coreR * 0.52 - $hlR), ($hlR * 2), ($hlR * 2))
    $hlBrush.Dispose()

    # Save
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

function New-BadgeIcon {
    param([int]$Size, [string]$Path)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $r = $Size * 0.34
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($brush, (($Size / 2.0) - $r), (($Size / 2.0) - $r), ($r * 2), ($r * 2))
    $brush.Dispose()

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

New-RoomSetIcon -Size 192 -Path (Join-Path $out "icon-192.png")
New-RoomSetIcon -Size 512 -Path (Join-Path $out "icon-512.png")
New-RoomSetIcon -Size 512 -Path (Join-Path $out "icon-maskable-512.png") -ContentScale 0.82
New-RoomSetIcon -Size 180 -Path (Join-Path $out "apple-touch-icon.png")
New-RoomSetIcon -Size 32 -Path (Join-Path $out "favicon-32.png")
New-BadgeIcon -Size 72 -Path (Join-Path $out "badge-72.png")

Write-Host "Icons written to $out"
