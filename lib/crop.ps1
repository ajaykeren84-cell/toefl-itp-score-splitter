param(
    [string]$srcPath,
    [int]$cut1,
    [int]$cut2,
    [int]$cut3,
    [string]$outDir,
    [string]$baseName
)

Add-Type -AssemblyName System.Drawing

if (!(Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$w = $src.Width
$h = $src.Height
$canvasHeight = 750

$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]95)

function Save-Cropped([int]$srcY, [int]$srcH, [string]$destPath) {
    $dest = New-Object System.Drawing.Bitmap($w, $canvasHeight)
    $dest.SetResolution($src.HorizontalResolution, $src.VerticalResolution)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $actualH = [math]::Min($srcH, $canvasHeight)
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $w, $actualH)
    $srcRect = New-Object System.Drawing.Rectangle(0, $srcY, $w, $actualH)

    $g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $dest.Save($destPath, $encoder, $encoderParams)
    $dest.Dispose()
}

$part1Path = Join-Path $outDir "${baseName}_part1.jpg"
$part2Path = Join-Path $outDir "${baseName}_part2.jpg"
$part3Path = Join-Path $outDir "${baseName}_part3.jpg"

# Part 1: Top margin 35 to cut1
$h1 = $cut1 - 35
Save-Cropped 35 $h1 $part1Path

# Part 2: cut1 to cut2
$h2 = $cut2 - $cut1
Save-Cropped $cut1 $h2 $part2Path

# Part 3: cut2 to cut3
$h3 = $cut3 - $cut2
Save-Cropped $cut2 $h3 $part3Path

$src.Dispose()
Write-Output "OK"
