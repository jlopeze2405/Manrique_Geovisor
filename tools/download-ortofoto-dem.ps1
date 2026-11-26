param(
  [string]$DemPath = "data/Raster/DEM/DEM_5m.tif",
  [string]$WorldFilePath = "data/Raster/DEM/DEM_5m.tfw",
  [string]$OutputDirectory = "data/Raster/ortho_tiles_3d",
  [double]$ResolutionMeters = 0.5,
  [int]$JpegQuality = 80
)

$ErrorActionPreference = "Stop"
$service = "https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofoto_Medellin_2024/ImageServer/exportImage"
$gridColumns = 2
$gridRows = 2
$maxImageDimension = 4096

if (-not (Test-Path -LiteralPath $DemPath)) { throw "No se encuentra el DEM: $DemPath" }
if (-not (Test-Path -LiteralPath $WorldFilePath)) { throw "No se encuentra el world file: $WorldFilePath" }
if ($ResolutionMeters -le 0 -or $JpegQuality -lt 1 -or $JpegQuality -gt 100) { throw "Resolucion o calidad JPEG no valida." }

Add-Type -AssemblyName System.Drawing
$dem = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $DemPath))
try { $width = $dem.Width; $height = $dem.Height } finally { $dem.Dispose() }
$world = @(Get-Content -LiteralPath $WorldFilePath | ForEach-Object { [double]::Parse($_, [Globalization.CultureInfo]::InvariantCulture) })
if ($world.Count -lt 6) { throw "El TFW debe contener sus seis valores." }
$pixelX = $world[0]; $pixelY = [Math]::Abs($world[3])
if ([Math]::Abs($world[1]) -gt 1e-9 -or [Math]::Abs($world[2]) -gt 1e-9) { throw "El descargador requiere un TFW sin rotacion." }
$xmin = $world[4] - $pixelX / 2
$xmax = $xmin + $width * $pixelX
$ymax = $world[5] + $pixelY / 2
$ymin = $ymax - $height * $pixelY
$tileWidth = ($xmax - $xmin) / $gridColumns
$tileHeight = ($ymax - $ymin) / $gridRows
$pixelWidth = [int][Math]::Ceiling($tileWidth / $ResolutionMeters)
$pixelHeight = [int][Math]::Ceiling($tileHeight / $ResolutionMeters)
if ($pixelWidth -gt $maxImageDimension -or $pixelHeight -gt $maxImageDimension) { throw "Cada tesela excede el maximo de 4096 px. Reduzca ResolutionMeters." }

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stagingDirectory = Join-Path $OutputDirectory ".ortho_download_staging"
New-Item -ItemType Directory -Force -Path $stagingDirectory | Out-Null
$tiles = [System.Collections.Generic.List[object]]::new()
for ($row = 1; $row -le $gridRows; $row++) {
  for ($column = 1; $column -le $gridColumns; $column++) {
    $tileXmin = $xmin + ($column - 1) * $tileWidth
    $tileXmax = if ($column -eq $gridColumns) { $xmax } else { $xmin + $column * $tileWidth }
    $tileYmax = $ymax - ($row - 1) * $tileHeight
    $tileYmin = if ($row -eq $gridRows) { $ymin } else { $ymax - $row * $tileHeight }
    $filename = "ortho_r{0:D2}_c{1:D2}.tif" -f $row, $column
    $path = Join-Path $stagingDirectory $filename
    $query = "bbox=$tileXmin,$tileYmin,$tileXmax,$tileYmax&bboxSR=9377&imageSR=9377&size=$pixelWidth,$pixelHeight&bandIds=0,1,2&format=tiff&compression=JPEG&compressionQuality=$JpegQuality&f=image"
    $uri = "{0}?{1}" -f $service, $query
    Write-Host "Descargando $filename ($pixelWidth x $pixelHeight)..."
    Invoke-WebRequest -Uri $uri -OutFile $path -TimeoutSec 180
    $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $path))
    if ($bytes.Length -lt 8 -or -not (($bytes[0] -eq 0x49 -and $bytes[1] -eq 0x49) -or ($bytes[0] -eq 0x4d -and $bytes[1] -eq 0x4d))) {
      $sampleLength = [Math]::Min(600, $bytes.Length)
      $sample = [Text.Encoding]::UTF8.GetString($bytes, 0, $sampleLength)
      Remove-Item -LiteralPath $path -Force
      throw "El servicio no devolvio un TIFF valido para $filename. Respuesta: $sample"
    }
    $tile = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $path))
    try { $actualWidth = $tile.Width; $actualHeight = $tile.Height } finally { $tile.Dispose() }
    $tiles.Add([ordered]@{
      index = $tiles.Count + 1; row = $row; column = $column; filename = $filename
      bbox = [ordered]@{ xmin = $tileXmin; ymin = $tileYmin; xmax = $tileXmax; ymax = $tileYmax }
      bboxSR = 9377; imageSR = 9377; width = $actualWidth; height = $actualHeight
      resolutionMetersPerPixel = [Math]::Max(($tileXmax - $tileXmin) / $actualWidth, ($tileYmax - $tileYmin) / $actualHeight)
      format = "tiff-jpeg"
    })
  }
}

$manifest = [ordered]@{
  service = $service; crs = "EPSG:9377"
  grid = [ordered]@{ columns = $gridColumns; rows = $gridRows }
  sourceExtent = [ordered]@{ xmin = $xmin; ymin = $ymin; xmax = $xmax; ymax = $ymax }
  sourceResolutionMetersPerPixel = $ResolutionMeters
  format = "GeoTIFF with JPEG compression"
  compressionQuality = $JpegQuality
  tiles = @($tiles)
}
$manifestPath = Join-Path $stagingDirectory "tiles.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$stagedTiles = Get-ChildItem -LiteralPath $stagingDirectory -Filter "ortho_r*_c*.tif"
if ($stagedTiles.Count -ne $gridColumns * $gridRows) { throw "No se completaron todas las teselas de ortofoto." }
foreach ($stagedTile in $stagedTiles) { Move-Item -LiteralPath $stagedTile.FullName -Destination (Join-Path $OutputDirectory $stagedTile.Name) -Force }
Move-Item -LiteralPath $manifestPath -Destination (Join-Path $OutputDirectory "tiles.json") -Force
$null = Remove-Item -LiteralPath $stagingDirectory -Force -Recurse
$legacyJpegs = Get-ChildItem -LiteralPath $OutputDirectory -Filter "ortho_r*_c*.jpg" -ErrorAction SilentlyContinue
if ($legacyJpegs) { $legacyJpegs | Remove-Item -Force }
$totalBytes = (Get-ChildItem -LiteralPath $OutputDirectory -Filter "ortho_r*_c*.tif" | Measure-Object -Property Length -Sum).Sum
Write-Host "Manifiesto actualizado: $manifestPath"
Write-Host ("Cobertura: {0:N0} x {1:N0} m; GeoTIFF JPEG descargado: {2:N1} MB" -f ($xmax-$xmin), ($ymax-$ymin), ($totalBytes/1MB))
