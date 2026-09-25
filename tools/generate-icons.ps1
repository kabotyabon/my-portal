Add-Type -AssemblyName System.Drawing

function New-Icon {
    param([int]$Size, [string]$OutPath, [bool]$Maskable)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $colorTop    = [System.Drawing.ColorTranslator]::FromHtml("#3a2a3c")
    $colorBottom = [System.Drawing.ColorTranslator]::FromHtml("#150e1a")
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $colorTop, $colorBottom, 90.0)

    if ($Maskable) {
        $g.FillRectangle($bgBrush, $rect)
        $glowScale = 0.5
        $glowCxR = 0.62
        $glowCyR = 0.38
        $moonScale = 0.17
    } else {
        $r = [int]($Size * 0.22)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
        $path.AddArc(($Size - $r * 2), 0, $r * 2, $r * 2, 270, 90)
        $path.AddArc(($Size - $r * 2), ($Size - $r * 2), $r * 2, $r * 2, 0, 90)
        $path.AddArc(0, ($Size - $r * 2), $r * 2, $r * 2, 90, 90)
        $path.CloseFigure()
        $g.FillPath($bgBrush, $path)
        $glowScale = 0.62
        $glowCxR = 0.66
        $glowCyR = 0.34
        $moonScale = 0.24
    }

    # 温かいグロー（コーラル、半透明の円を重ねるだけの簡易版）
    $glowR = [int]($Size * $glowScale)
    $glowCx = [int]($Size * $glowCxR)
    $glowCy = [int]($Size * $glowCyR)
    $glowColor = [System.Drawing.Color]::FromArgb(90, 230, 154, 115)
    $glowBrush = New-Object System.Drawing.SolidBrush($glowColor)
    $g.FillEllipse($glowBrush, ($glowCx - $glowR), ($glowCy - $glowR), ($glowR * 2), ($glowR * 2))

    # 三日月
    $moonR = [int]($Size * $moonScale)
    $cx = [int]($Size * 0.5)
    $cy = [int]($Size * 0.5)
    $moonBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#f2cfc9"))
    $g.FillEllipse($moonBrush, ($cx - $moonR), ($cy - $moonR), ($moonR * 2), ($moonR * 2))

    $cutR = [int]($moonR * 0.92)
    $cutCx = [int]($cx + $moonR * 0.42)
    $cutCy = [int]($cy - $moonR * 0.28)
    $cutBrush = New-Object System.Drawing.SolidBrush($colorBottom)
    $g.FillEllipse($cutBrush, ($cutCx - $cutR), ($cutCy - $cutR), ($cutR * 2), ($cutR * 2))

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$dir = "C:\Users\user\OneDrive\ドキュメント\ag-project\my-portal\portal-app\assets\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

New-Icon -Size 192 -OutPath "$dir\icon-192.png" -Maskable $false
New-Icon -Size 512 -OutPath "$dir\icon-512.png" -Maskable $false
New-Icon -Size 512 -OutPath "$dir\icon-512-maskable.png" -Maskable $true

Get-Item "$dir\*.png" | Select-Object Name, Length
