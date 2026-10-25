# Makes the app's images from the owner's RosterBots art in docs/brand/rosterbots (Oct 25).
# Windows PowerShell 5.1, System.Drawing only, so nothing to install.
#   powershell -NoProfile -File apps/mobile/scripts/brand-assets.ps1
# Replaces scripts/brand-assets.py, which made the HangoverBot images and needed Pillow.

Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$src = Join-Path $root "docs\brand\rosterbots"
$out = Join-Path $root "apps\mobile\assets"

function Load($name) { [System.Drawing.Bitmap]::FromFile((Join-Path $src $name)) }

# The smallest rectangle holding every pixel that is not fully transparent.
function OpaqueBounds($bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    $row = $y * $data.Stride
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      if ($bytes[$row + $x * 4 + 3] -gt 8) {
        if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
}

# Draws part of an image onto a new canvas of the given size, scaled to fit inside `box`
# (centred), over a solid colour or transparent.
function Compose($img, $from, $w, $h, $box, $fill) {
  $canvas = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  if ($fill) { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($fill)) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  $scale = [Math]::Min($box.Width / $from.Width, $box.Height / $from.Height)
  $dw = [int]($from.Width * $scale); $dh = [int]($from.Height * $scale)
  $dx = $box.X + [int](($box.Width - $dw) / 2); $dy = $box.Y + [int](($box.Height - $dh) / 2)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle $dx, $dy, $dw, $dh), $from, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $canvas
}

function Save($bmp, $path) { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); Write-Output ("{0}" -f (Resolve-Path $path)) }

$lockup = Load "lockup-by-turbo-devs.png"
$tight = OpaqueBounds $lockup
$pad = 24

# The lockup for Welcome, the error screens, inner-screen headers and About: trimmed, a
# little padding, 1400 wide (420 points at 3x is 1260).
$w = 1400; $h = [int]($w * ($tight.Height + 2 * $pad) / ($tight.Width + 2 * $pad))
Save (Compose $lockup $tight $w $h (New-Object System.Drawing.Rectangle 0, 0, $w, $h) $null) (Join-Path $out "brand\rosterbots-lockup.png")
Write-Output ("lockup aspect {0:N4}" -f ($w / $h))

# The splash: the lockup on transparent, with room around it; app.config.ts sets Midnight behind.
Save (Compose $lockup $tight 1200 600 (New-Object System.Drawing.Rectangle 60, 60, 1080, 480) $null) (Join-Path $out "splash-icon.png")

# The robot's head and shoulders from the lockup, for the peek beside "You're covered" on Home.
$head = New-Object System.Drawing.Rectangle ($tight.X + [int]($tight.Width * 0.115)), $tight.Y, ([int]($tight.Width * 0.235)), ([int]($tight.Height * 0.60))
$hw = 600; $hh = [int]($hw * $head.Height / $head.Width)
Save (Compose $lockup $head $hw $hh (New-Object System.Drawing.Rectangle 0, 0, $hw, $hh) $null) (Join-Path $out "brand\robot-peek.png")
Write-Output ("peek aspect {0:N4}" -f ($hw / $hh))
$lockup.Dispose()

# The app icon and Android's adaptive foreground: the owner's square art, which keeps its
# ring inside the middle 66% that every Android mask leaves visible.
$icon = Load "icon-art.png"
$all = New-Object System.Drawing.Rectangle 0, 0, $icon.Width, $icon.Height
Save (Compose $icon $all 1024 1024 (New-Object System.Drawing.Rectangle 0, 0, 1024, 1024) "#010436") (Join-Path $out "icon.png")
Save (Compose $icon $all 1024 1024 (New-Object System.Drawing.Rectangle 0, 0, 1024, 1024) "#010436") (Join-Path $out "adaptive-icon.png")
$icon.Dispose()
